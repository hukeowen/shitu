package com.shitu.lifecycle.seeker;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.shitu.common.api.PageResult;
import com.shitu.common.enums.ActorRole;
import com.shitu.common.enums.ApplicationStatus;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.common.util.Masks;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.outbox.OutboxWriter;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.framework.web.Pages;
import com.shitu.job.Job;
import com.shitu.job.mapper.JobMapper;
import com.shitu.lifecycle.mapper.ApplicationMapper;
import com.shitu.lifecycle.mapper.InterviewNoticeMapper;
import com.shitu.lifecycle.mapper.ResponseWindowMapper;
import com.shitu.lifecycle.mapper.SeekerUserMapper;
import com.shitu.tenant.company.CompanyService;
import com.shitu.tenant.mapper.ProjectMapper;
import com.shitu.tenant.project.Project;
import com.shitu.tenant.scope.DataScope;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 报名单查询与驻场「知悉」（C-501 我的报备、M-01 工作台、M-02 待面试）。
 * 状态变化（面试结果、取消、爽约）统一走 {@link LifecycleService#transition}。
 */
@Service
public class ApplicationService {

    public record NoticeView(LocalDateTime interviewAt, String address, String routeTips, List<String> documents,
                             String contactName, String contactPhone, LocalDateTime pushedAt) {
    }

    /** C 端：我的报备。 */
    public record MyApplication(String applicationId, String jobId, String jobTitle, String companyName,
                                String projectName, String city, String address, ApplicationStatus status,
                                LocalDateTime createdAt, LocalDateTime endedAt, String endReason, NoticeView notice) {
    }

    /** 驻场 / 项目经理：待办报名。手机号按角色：驻场完整、其他角色隐藏（R-13）。 */
    public record SiteApplication(String applicationId, String userId, String seekerName, String phone, String jobId,
                                  String jobTitle, String projectId, String projectName, ApplicationStatus status,
                                  boolean fromPublic, LocalDateTime createdAt, LocalDateTime acknowledgedAt,
                                  LocalDateTime interviewAt, LocalDateTime responseDeadline, List<String> allowedActions,
                                  LocalDateTime arrivedAt, NoticeView notice, ContractBrief contract) {
    }

    /** 待确权阶段的最近一份劳动合同：status PENDING_SIGN / SIGNED / FAILED…；signUrl 仅待签署时返回。 */
    public record ContractBrief(String contractId, String status, String signUrl, LocalDateTime createdAt, LocalDateTime signedAt) {
    }

    /** 列表排序：CREATED_ASC（默认，先来先处理）/ CREATED_DESC / DEADLINE（24h 响应窗口最紧的在前）。 */
    public enum Sort { CREATED_ASC, CREATED_DESC, DEADLINE }

    public record Workbench(long pendingAck, long pendingInterview, long pendingConfirm, long windowsDueIn4h,
                            long privatePending) {
    }

    public record AcknowledgeCommand(LocalDateTime interviewAt, String address, String routeTips, List<String> documents,
                                     String contactName, String contactPhone) {
    }

    private final ApplicationMapper applications;
    private final InterviewNoticeMapper notices;
    private final ResponseWindowMapper windows;
    private final SeekerUserMapper users;
    private final JobMapper jobs;
    private final ProjectMapper projects;
    private final CompanyService companies;
    private final DataScope scope;
    private final FieldCipher cipher;
    private final OutboxWriter outbox;
    private final AuditLogger audit;
    private final org.springframework.jdbc.core.JdbcTemplate jdbc;
    private final Clock clock;

    public ApplicationService(ApplicationMapper applications, InterviewNoticeMapper notices, ResponseWindowMapper windows,
                              SeekerUserMapper users, JobMapper jobs, ProjectMapper projects, CompanyService companies,
                              DataScope scope, FieldCipher cipher, OutboxWriter outbox, AuditLogger audit,
                              org.springframework.jdbc.core.JdbcTemplate jdbc, Clock clock) {
        this.applications = applications;
        this.notices = notices;
        this.windows = windows;
        this.users = users;
        this.jobs = jobs;
        this.projects = projects;
        this.companies = companies;
        this.scope = scope;
        this.cipher = cipher;
        this.outbox = outbox;
        this.audit = audit;
        this.jdbc = jdbc;
        this.clock = clock;
    }

    // ------------------------------------------------------------------ C 端

    public List<MyApplication> mine(String userId, ApplicationStatus status) {
        return TenantContext.runAsSystem(() -> {
            List<Application> list = applications.selectList(new LambdaQueryWrapper<Application>()
                    .eq(Application::getUserId, userId)
                    .eq(status != null, Application::getStatus, status)
                    .orderByDesc(Application::getCreatedAt));
            Map<String, Job> js = jobsOf(list);
            Map<String, Project> ps = projectsOf(list);
            Map<String, String> cn = companies.namesOf(list.stream().map(Application::getCompanyId).collect(Collectors.toSet()));
            Map<String, InterviewNotice> ns = latestNotices(list.stream().map(Application::getApplicationId).toList());
            return list.stream().map(a -> {
                Job j = js.get(a.getJobId());
                Project p = ps.get(a.getProjectId());
                return new MyApplication(a.getApplicationId(), a.getJobId(), j == null ? null : j.getTitle(),
                        cn.get(a.getCompanyId()), p == null ? null : p.getName(), p == null ? null : p.getCity(),
                        a.getInterviewAddress(), a.getStatus(), a.getCreatedAt(), a.getEndedAt(), a.getEndReason(),
                        noticeView(ns.get(a.getApplicationId())));
            }).toList();
        });
    }

    // ------------------------------------------------------------------ 驻场 / 项目经理（TENANT 模式）

    public PageResult<SiteApplication> forTenant(AuthPrincipal p, ApplicationStatus status, Boolean unacknowledged,
                                                 String projectId, Integer page, Integer pageSize) {
        return forTenant(p, status, unacknowledged, projectId, page, pageSize, Sort.CREATED_ASC);
    }

    public PageResult<SiteApplication> forTenant(AuthPrincipal p, ApplicationStatus status, Boolean unacknowledged,
                                                 String projectId, Integer page, Integer pageSize, Sort sort) {
        DataScope.Scope s = scope.of(p);
        if (!s.all() && s.projectIds().isEmpty()) {
            return new PageResult<>(List.of(), 0, 1, 20);
        }
        LambdaQueryWrapper<Application> q = new LambdaQueryWrapper<Application>()
                .in(!s.all(), Application::getProjectId, s.projectIds())
                .eq(status != null, Application::getStatus, status)
                .isNull(Boolean.TRUE.equals(unacknowledged), Application::getAcknowledgedAt)
                .eq(projectId != null && !projectId.isBlank(), Application::getProjectId, projectId);
        switch (sort == null ? Sort.CREATED_ASC : sort) {
            case CREATED_DESC -> q.orderByDesc(Application::getCreatedAt);
            // 子查询同样经过租户拦截器，只看本公司的窗口；没有打开窗口的排在最后
            case DEADLINE -> q.last("ORDER BY (SELECT MIN(w.deadline) FROM response_window w WHERE w.user_id = application.user_id "
                    + "AND w.status = 'OPEN') IS NULL, (SELECT MIN(w.deadline) FROM response_window w WHERE w.user_id = application.user_id "
                    + "AND w.status = 'OPEN'), created_at");
            default -> q.orderByAsc(Application::getCreatedAt);
        }
        Page<Application> pg = applications.selectPage(Pages.of(page, pageSize), q);
        return new PageResult<>(toRows(p, pg.getRecords()), pg.getTotal(), pg.getCurrent(), pg.getSize());
    }

    private List<SiteApplication> toRows(AuthPrincipal p, List<Application> list) {
        Map<String, Job> js = jobsOf(list);
        Map<String, Project> ps = projectsOf(list);
        Set<String> userIds = list.stream().map(Application::getUserId).collect(Collectors.toSet());
        Map<String, SeekerUser> us = userIds.isEmpty() ? Map.of() : TenantContext.runAsSystem(() -> users.selectBatchIds(userIds))
                .stream().collect(Collectors.toMap(SeekerUser::getUserId, Function.identity()));
        Map<String, LocalDateTime> deadlines = deadlines(userIds);
        boolean site = p.hasRole(ActorRole.SITE.name());
        Map<String, InterviewNotice> ns = latestNotices(list.stream().map(Application::getApplicationId).toList());
        Map<String, ContractBrief> cs = latestContracts(list.stream()
                .filter(a -> a.getStatus() == ApplicationStatus.PENDING_CONFIRM || a.getStatus() == ApplicationStatus.EMPLOYED)
                .map(Application::getApplicationId).toList(), site || p.hasRole(ActorRole.PM.name()));
        return list.stream().map(a -> {
            SeekerUser u = us.get(a.getUserId());
            String name = u == null || u.getRealNameEnc() == null ? "未实名" : Masks.name(cipher.decrypt(u.getRealNameEnc()));
            String phone = u == null ? null : site ? cipher.decrypt(u.getPhoneEnc()) : null;
            Job j = js.get(a.getJobId());
            Project pr = ps.get(a.getProjectId());
            return new SiteApplication(a.getApplicationId(), a.getUserId(), name, phone, a.getJobId(),
                    j == null ? null : j.getTitle(), a.getProjectId(), pr == null ? null : pr.getName(), a.getStatus(),
                    a.getPreApplyBound() == null, a.getCreatedAt(), a.getAcknowledgedAt(), a.getInterviewAt(),
                    deadlines.get(a.getUserId()), actions(a, p), a.getArrivedAt(), noticeView(ns.get(a.getApplicationId())),
                    cs.get(a.getApplicationId()));
        }).toList();
    }

    private Map<String, ContractBrief> latestContracts(List<String> appIds, boolean withUrl) {
        Map<String, ContractBrief> m = new HashMap<>();
        if (appIds.isEmpty()) {
            return m;
        }
        jdbc.query("SELECT application_id, contract_id, status, sign_url, created_at, signed_at FROM contract WHERE application_id IN ("
                + String.join(",", appIds.stream().map(x -> "?").toList()) + ") ORDER BY created_at", rs -> {
            String st = rs.getString(3);
            m.put(rs.getString(1), new ContractBrief(rs.getString(2), st, withUrl && "PENDING_SIGN".equals(st) ? rs.getString(4) : null,
                    rs.getTimestamp(5).toLocalDateTime(), rs.getTimestamp(6) == null ? null : rs.getTimestamp(6).toLocalDateTime()));
        }, appIds.toArray());
        return m;
    }

    public Workbench workbench(AuthPrincipal p) {
        DataScope.Scope s = scope.of(p);
        if (!s.all() && s.projectIds().isEmpty()) {
            return new Workbench(0, 0, 0, 0, 0);
        }
        long pendingAck = applications.selectCount(base(s).eq(Application::getStatus, ApplicationStatus.PENDING_INTERVIEW)
                .isNull(Application::getAcknowledgedAt));
        long pendingInterview = applications.selectCount(base(s).eq(Application::getStatus, ApplicationStatus.PENDING_INTERVIEW));
        long pendingConfirm = applications.selectCount(base(s).eq(Application::getStatus, ApplicationStatus.PENDING_CONFIRM));
        LocalDateTime now = LocalDateTime.now(clock);
        // 窗口按公司统计（私域待匹配的用户还没有项目）；TENANT 模式自动限定本公司
        long due = windows.selectCount(new LambdaQueryWrapper<ResponseWindow>()
                .eq(ResponseWindow::getStatus, ResponseWindow.OPEN)
                .le(ResponseWindow::getDeadline, now.plusHours(4)));
        long privatePending = windows.selectCount(new LambdaQueryWrapper<ResponseWindow>()
                .eq(ResponseWindow::getStatus, ResponseWindow.OPEN)
                .eq(ResponseWindow::getStage, "PRIVATE_PENDING"));
        return new Workbench(pendingAck, pendingInterview, pendingConfirm, due, privatePending);
    }

    /** 私域待匹配用户（A-03）：扫本公司码注册、还没报名，24h 窗口内需要跟进（可一键转经纪人）。 */
    public record PrivatePendingRow(String userId, String seekerName, String phone, LocalDateTime registeredAt,
                                    LocalDateTime deadline, String channelCode, String channelMemberName, boolean inBrokerPool) {
    }

    public List<PrivatePendingRow> privatePending(AuthPrincipal p) {
        boolean site = p.hasRole(ActorRole.SITE.name());
        return jdbc.query("SELECT w.user_id, u.real_name_enc, u.phone_enc, u.registered_at, w.deadline, u.register_channel_code, m.name, "
                        + "(SELECT COUNT(*) FROM broker_case b WHERE b.user_id = w.user_id AND b.company_id = w.company_id "
                        + "  AND b.status IN ('OPEN','CONTACTED','RECOMMENDED')) "
                        + "FROM response_window w JOIN `user` u ON u.user_id = w.user_id "
                        + "LEFT JOIN channel_code c ON c.code = u.register_channel_code LEFT JOIN member m ON m.member_id = c.member_id "
                        + "WHERE w.company_id = ? AND w.status = 'OPEN' AND w.stage = 'PRIVATE_PENDING' ORDER BY w.deadline LIMIT 500",
                (rs, i) -> new PrivatePendingRow(rs.getString(1),
                        rs.getString(2) == null ? "未实名" : Masks.name(cipher.decrypt(rs.getString(2))),
                        site ? cipher.decrypt(rs.getString(3)) : Masks.phone(cipher.decrypt(rs.getString(3))),
                        rs.getTimestamp(4).toLocalDateTime(), rs.getTimestamp(5).toLocalDateTime(), rs.getString(6), rs.getString(7),
                        rs.getLong(8) > 0),
                p.companyId());
    }

    /**
     * 驻场「知悉」→ 推送面试信息（M-02 / C-408）。可以重复推送（改时间 / 地点），以最后一次为准。
     */
    @Transactional
    public SiteApplication acknowledge(AuthPrincipal p, String applicationId, AcknowledgeCommand cmd) {
        Application a = applications.selectById(applicationId);
        BizException.check(a != null, ErrorCode.SYS_NOT_FOUND);
        scope.checkProject(p, a.getProjectId());
        BizException.check(a.getStatus() == ApplicationStatus.PENDING_INTERVIEW, ErrorCode.LC_ILLEGAL_TRANSITION, "只有待面试的报名可以推送面试信息");
        BizException.check(cmd.interviewAt() != null && cmd.interviewAt().isAfter(LocalDateTime.now(clock).minusHours(1)),
                ErrorCode.SYS_BAD_REQUEST, "请选择面试时间");
        BizException.check(cmd.address() != null && !cmd.address().isBlank(), ErrorCode.SYS_BAD_REQUEST, "请填写面试地点");
        LocalDateTime now = LocalDateTime.now(clock);
        InterviewNotice n = new InterviewNotice();
        n.setCompanyId(a.getCompanyId());
        n.setApplicationId(applicationId);
        n.setInterviewAt(cmd.interviewAt());
        n.setAddress(cmd.address().trim());
        n.setRouteTips(cmd.routeTips());
        n.setDocuments(cmd.documents());
        n.setContactName(cmd.contactName() == null || cmd.contactName().isBlank() ? p.name() : cmd.contactName().trim());
        n.setContactPhoneEnc(cmd.contactPhone() == null || cmd.contactPhone().isBlank() ? null : cipher.encrypt(cmd.contactPhone().trim()));
        n.setPushedBy(p.subjectId());
        n.setPushedAt(now);
        notices.insert(n);
        applications.update(null, new LambdaUpdateWrapper<Application>()
                .eq(Application::getApplicationId, applicationId)
                .set(a.getAcknowledgedAt() == null, Application::getAcknowledgedAt, now)
                .set(a.getAcknowledgedAt() == null, Application::getAcknowledgedBy, p.subjectId())
                .set(Application::getInterviewAt, cmd.interviewAt())
                .set(Application::getInterviewAddress, cmd.address().trim())
                .setSql("version = version + 1"));
        Job j = jobs.selectById(a.getJobId());
        outbox.publish("INTERVIEW_INFO_PUSHED", "APPLICATION", applicationId, Map.of(
                "userId", a.getUserId(), "companyId", a.getCompanyId(), "jobTitle", j == null ? "" : j.getTitle(),
                "interviewAt", cmd.interviewAt().toString(), "address", cmd.address().trim(),
                "documents", cmd.documents() == null ? "" : String.join("、", cmd.documents())));
        audit.log("INTERVIEW_INFO_PUSH", "APPLICATION", applicationId, Map.of("interviewAt", cmd.interviewAt().toString()));
        return one(p, applicationId);
    }

    public SiteApplication one(AuthPrincipal p, String applicationId) {
        Application a = applications.selectById(applicationId);
        BizException.check(a != null, ErrorCode.SYS_NOT_FOUND);
        scope.checkProject(p, a.getProjectId());
        return toRows(p, List.of(a)).get(0);
    }

    public Application find(String applicationId) {
        return applications.selectById(applicationId);
    }

    /**
     * 后台操作按钮（前端只按这里显示，A-19 矩阵）：
     * 待面试：ACKNOWLEDGE / REPUSH（推送面试信息）、ARRIVE（到厂确认）、PASS / FAIL（面试结果）、NO_SHOW（爽约，仅驻场）、CANCEL；
     * 待确权：CONFIRM（确权并发起电子签）或 RESEND_CONTRACT（重发签约）、CANCEL。
     */
    List<String> actions(Application a, AuthPrincipal p) {
        boolean site = p.hasRole(ActorRole.SITE.name());
        boolean pm = p.hasRole(ActorRole.PM.name());
        if (!site && !pm) {
            return List.of();
        }
        List<String> out = new java.util.ArrayList<>();
        if (a.getStatus() == ApplicationStatus.PENDING_INTERVIEW) {
            out.add(a.getAcknowledgedAt() == null ? "ACKNOWLEDGE" : "REPUSH");
            if (a.getArrivedAt() == null) {
                out.add("ARRIVE");
            }
            out.add("PASS");
            out.add("FAIL");
            if (site) {
                out.add("NO_SHOW");
            }
            out.add("CANCEL");
        } else if (a.getStatus() == ApplicationStatus.PENDING_CONFIRM) {
            Long pending = jdbc.queryForObject("SELECT COUNT(*) FROM contract WHERE application_id = ? AND status = 'PENDING_SIGN'",
                    Long.class, a.getApplicationId());
            out.add(pending != null && pending > 0 ? "RESEND_CONTRACT" : "CONFIRM");
            out.add("CANCEL");
        }
        return out;
    }

    // ------------------------------------------------------------------

    private LambdaQueryWrapper<Application> base(DataScope.Scope s) {
        return new LambdaQueryWrapper<Application>().in(!s.all(), Application::getProjectId, s.projectIds());
    }

    private Map<String, LocalDateTime> deadlines(Collection<String> userIds) {
        Map<String, LocalDateTime> m = new HashMap<>();
        if (userIds.isEmpty()) {
            return m;
        }
        TenantContext.runAsSystem(() -> windows.selectList(new LambdaQueryWrapper<ResponseWindow>()
                        .in(ResponseWindow::getUserId, userIds).eq(ResponseWindow::getStatus, ResponseWindow.OPEN)))
                .forEach(w -> m.put(w.getUserId(), w.getDeadline()));
        return m;
    }

    private Map<String, Job> jobsOf(List<Application> list) {
        Set<String> ids = list.stream().map(Application::getJobId).collect(Collectors.toSet());
        return ids.isEmpty() ? Map.of() : TenantContext.runAsSystem(() -> jobs.selectBatchIds(ids)).stream()
                .collect(Collectors.toMap(Job::getJobId, Function.identity()));
    }

    private Map<String, Project> projectsOf(List<Application> list) {
        Set<String> ids = list.stream().map(Application::getProjectId).collect(Collectors.toSet());
        return ids.isEmpty() ? Map.of() : TenantContext.runAsSystem(() -> projects.selectBatchIds(ids)).stream()
                .collect(Collectors.toMap(Project::getProjectId, Function.identity()));
    }

    private Map<String, InterviewNotice> latestNotices(List<String> appIds) {
        Map<String, InterviewNotice> m = new HashMap<>();
        if (appIds.isEmpty()) {
            return m;
        }
        notices.selectList(new LambdaQueryWrapper<InterviewNotice>().in(InterviewNotice::getApplicationId, appIds)
                .orderByAsc(InterviewNotice::getId)).forEach(n -> m.put(n.getApplicationId(), n));
        return m;
    }

    private NoticeView noticeView(InterviewNotice n) {
        if (n == null) {
            return null;
        }
        return new NoticeView(n.getInterviewAt(), n.getAddress(), n.getRouteTips(), n.getDocuments(), n.getContactName(),
                n.getContactPhoneEnc() == null ? null : cipher.decrypt(n.getContactPhoneEnc()), n.getPushedAt());
    }

    static final Set<ApplicationStatus> ACTIVE = EnumSet.of(ApplicationStatus.PENDING_INTERVIEW, ApplicationStatus.PENDING_CONFIRM);
}
