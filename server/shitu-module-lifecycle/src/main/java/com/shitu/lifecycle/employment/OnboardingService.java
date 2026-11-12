package com.shitu.lifecycle.employment;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.shitu.common.Constants;
import com.shitu.common.enums.ActorRole;
import com.shitu.common.enums.ApplicationStatus;
import com.shitu.common.enums.ContractStatus;
import com.shitu.common.enums.UserStatus;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.id.BizIdGenerator;
import com.shitu.framework.outbox.OutboxWriter;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.integration.esign.ESignProvider;
import com.shitu.job.Job;
import com.shitu.job.mapper.JobMapper;
import com.shitu.lifecycle.domain.LifecycleEvent;
import com.shitu.lifecycle.domain.TransitionContext;
import com.shitu.lifecycle.mapper.ApplicationMapper;
import com.shitu.lifecycle.mapper.DutyAbsenceMapper;
import com.shitu.lifecycle.mapper.EmploymentChangeMapper;
import com.shitu.lifecycle.mapper.EmploymentMapper;
import com.shitu.lifecycle.mapper.LaborContractMapper;
import com.shitu.lifecycle.mapper.SeekerUserMapper;
import com.shitu.lifecycle.seeker.Application;
import com.shitu.lifecycle.seeker.LifecycleService;
import com.shitu.lifecycle.seeker.SeekerUser;
import com.shitu.tenant.company.CompanyService;
import com.shitu.tenant.mapper.ProjectMapper;
import com.shitu.tenant.project.Project;
import com.shitu.tenant.scope.DataScope;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 入职闭环（Sprint 3：M-05 ~ M-10、M-15、T-103、T-307）：
 * <pre>
 * 待面试 ──到厂确认──→ 录入面试结果 ──通过──→ 待确权（重置 24h）──确权（发起电子签）──→ 签署完成回调 ──→ 在岗（唯一统计节点，计费起点）
 *    │                         └─未通过─→ 回到报名前归属（D-31），名额 +1
 *    ├─爽约（驻场 / 项目经理）─→ 当日释放至公域，名额 +1
 *    └─后台取消（必填原因）─→ 回到报名前归属，名额 +1
 * </pre>
 * 签约回调以服务端为准、幂等：同一流程重复推送只入职一次（合同行加锁 + 任职唯一索引）。
 */
@Service
public class OnboardingService {

    public record ConfirmCommand(LocalDate startDate, String employeeNo, LocalDate termEnd) {
    }

    public record ContractView(String contractId, String contractNo, String title, String companyName, String jobTitle,
                               String projectName, LocalDate termStart, LocalDate termEnd, ContractStatus status,
                               String signUrl, LocalDateTime signedAt, LocalDateTime createdAt) {
    }

    private final LifecycleService lifecycle;
    private final ApplicationMapper applications;
    private final EmploymentMapper employments;
    private final LaborContractMapper contracts;
    private final EmploymentChangeMapper changes;
    private final DutyAbsenceMapper absences;
    private final SeekerUserMapper users;
    private final JobMapper jobs;
    private final ProjectMapper projects;
    private final CompanyService companies;
    private final DataScope scope;
    private final ESignProvider esign;
    private final FieldCipher cipher;
    private final BizIdGenerator ids;
    private final OutboxWriter outbox;
    private final AuditLogger audit;
    private final JdbcTemplate jdbc;
    private final Clock clock;

    public OnboardingService(LifecycleService lifecycle, ApplicationMapper applications, EmploymentMapper employments,
                             LaborContractMapper contracts, EmploymentChangeMapper changes, DutyAbsenceMapper absences,
                             SeekerUserMapper users, JobMapper jobs, ProjectMapper projects, CompanyService companies,
                             DataScope scope, ESignProvider esign, FieldCipher cipher, BizIdGenerator ids,
                             OutboxWriter outbox, AuditLogger audit, JdbcTemplate jdbc, Clock clock) {
        this.lifecycle = lifecycle;
        this.applications = applications;
        this.employments = employments;
        this.contracts = contracts;
        this.changes = changes;
        this.absences = absences;
        this.users = users;
        this.jobs = jobs;
        this.projects = projects;
        this.companies = companies;
        this.scope = scope;
        this.esign = esign;
        this.cipher = cipher;
        this.ids = ids;
        this.outbox = outbox;
        this.audit = audit;
        this.jdbc = jdbc;
        this.clock = clock;
    }

    // ================================================================== 面试与报名处置（TENANT 模式）

    /** 到厂确认（M-05 前半）：只记录到厂时间并通知求职者，不改变状态。 */
    @Transactional
    public void arrive(AuthPrincipal p, String applicationId) {
        Application a = activeApplication(p, applicationId, ApplicationStatus.PENDING_INTERVIEW);
        if (a.getArrivedAt() != null) {
            return;
        }
        applications.update(null, new LambdaUpdateWrapper<Application>().eq(Application::getApplicationId, applicationId)
                .set(Application::getArrivedAt, LocalDateTime.now(clock)).setSql("version = version + 1"));
        outbox.publish("ARRIVAL_CONFIRMED", "APPLICATION", applicationId, Map.of("userId", a.getUserId()));
        audit.log("ARRIVAL_CONFIRM", "APPLICATION", applicationId, null);
    }

    /** 面试结果（M-05）：通过 → 待确权并重置 24h；未通过 → 回到报名前归属（D-31），名额 +1。 */
    @Transactional
    public void interviewResult(AuthPrincipal p, String applicationId, boolean pass, String remark) {
        Application a = activeApplication(p, applicationId, ApplicationStatus.PENDING_INTERVIEW);
        BizException.check(pass || hasText(remark), ErrorCode.LC_REASON_REQUIRED, "请填写面试未通过的原因");
        if (pass && a.getArrivedAt() == null) {
            arrive(p, applicationId);
        }
        lifecycle.transition(a.getUserId(), pass ? LifecycleEvent.INTERVIEW_PASS : LifecycleEvent.INTERVIEW_FAIL,
                ctx(p, ActorRole.SITE, ActorRole.PM), p.subjectId(), remark);
        audit.log(pass ? "INTERVIEW_PASS" : "INTERVIEW_FAIL", "APPLICATION", applicationId,
                remark == null ? null : Map.of("remark", remark));
    }

    /** 爽约（M-08，驻场 / 项目经理，D-60）：当日释放至全平台公域，名额 +1。 */
    @Transactional
    public void markNoShow(AuthPrincipal p, String applicationId, String remark) {
        BizException.check(p.hasAnyRole(ActorRole.SITE.name(), ActorRole.PM.name()), ErrorCode.LC_ACTOR_NOT_ALLOWED, "只有驻场或项目经理可以标记爽约");
        Application a = activeApplication(p, applicationId, ApplicationStatus.PENDING_INTERVIEW);
        lifecycle.transition(a.getUserId(), LifecycleEvent.MARK_NO_SHOW, ctx(p, ActorRole.SITE, ActorRole.PM), p.subjectId(), remark);
        audit.log("NO_SHOW_MARK", "APPLICATION", applicationId, null);
    }

    /** 后台取消报名（M-10，必填原因；用户不能自己取消 R-04）。 */
    @Transactional
    public void cancel(AuthPrincipal p, String applicationId, String reason) {
        BizException.check(hasText(reason), ErrorCode.LC_REASON_REQUIRED, "请填写取消原因");
        Application a = applications.selectById(applicationId);
        BizException.check(a != null, ErrorCode.SYS_NOT_FOUND);
        scope.checkProject(p, a.getProjectId());
        BizException.check(a.getStatus() == ApplicationStatus.PENDING_INTERVIEW || a.getStatus() == ApplicationStatus.PENDING_CONFIRM,
                ErrorCode.LC_ILLEGAL_TRANSITION, "该报名已结束");
        voidPendingContracts(applicationId);
        lifecycle.transition(a.getUserId(), LifecycleEvent.CANCEL_APPLICATION, ctx(p, ActorRole.SITE, ActorRole.PM),
                p.subjectId(), reason.trim());
        audit.log("APPLICATION_CANCEL", "APPLICATION", applicationId, Map.of("reason", reason.trim()));
    }

    // ================================================================== 确权与电子签

    /**
     * 入职确权（M-06）：确认入职日期、工号 → 生成劳动合同 → 发起电子签，签署链接短信 + 站内信发给求职者。
     * 已有待签合同时作废旧流程重新发起（T-103 失败重发）。状态仍为待确权，签署完成回调后才变为在岗。
     */
    @Transactional
    public ContractView confirm(AuthPrincipal p, String applicationId, ConfirmCommand cmd) {
        BizException.check(p.hasAnyRole(ActorRole.SITE.name(), ActorRole.PM.name()), ErrorCode.LC_ACTOR_NOT_ALLOWED);
        Application a = activeApplication(p, applicationId, ApplicationStatus.PENDING_CONFIRM);
        LocalDate today = LocalDate.now(clock.withZone(Constants.ZONE));
        LocalDate start = cmd.startDate() == null ? today : cmd.startDate();
        BizException.check(!start.isBefore(today.minusDays(3)) && !start.isAfter(today.plusDays(30)),
                ErrorCode.SYS_BAD_REQUEST, "入职日期须在近 3 天到未来 30 天之间");
        LocalDate termEnd = cmd.termEnd() == null ? start.plusYears(1).minusDays(1) : cmd.termEnd();
        BizException.check(termEnd.isAfter(start), ErrorCode.SYS_BAD_REQUEST, "合同截止日期须晚于入职日期");
        voidPendingContracts(applicationId);

        SeekerUser u = TenantContext.runAsSystem(() -> users.selectById(a.getUserId()));
        BizException.check(u != null && u.getRealNameEnc() != null, ErrorCode.KYC_REQUIRED);
        Job job = jobs.selectById(a.getJobId());
        String companyName = companies.namesOf(List.of(a.getCompanyId())).get(a.getCompanyId());
        String contractNo = ids.dated("HT", 5);
        String title = "劳动合同 · " + (job == null ? "" : job.getTitle());
        ESignProvider.Flow flow = esign.createFlow(new ESignProvider.SignRequest(contractNo, title, "LABOR_V1",
                cipher.decrypt(u.getRealNameEnc()), cipher.decrypt(u.getIdCardEnc()), cipher.decrypt(u.getPhoneEnc()),
                companyName, start, termEnd));
        LaborContract c = new LaborContract();
        c.setContractId(ids.dated("LC", 5));
        c.setContractNo(contractNo);
        c.setUserId(a.getUserId());
        c.setCompanyId(a.getCompanyId());
        c.setApplicationId(applicationId);
        c.setTemplateCode("LABOR_V1");
        c.setTitle(title);
        c.setTermStart(start);
        c.setTermEnd(termEnd);
        c.setStatus(ContractStatus.PENDING_SIGN);
        c.setEsignFlowId(flow.flowId());
        c.setSignUrl(flow.signUrl());
        c.setEmployeeNo(cmd.employeeNo() == null || cmd.employeeNo().isBlank() ? null : cmd.employeeNo().trim());
        c.setCreatedAt(LocalDateTime.now(clock));
        contracts.insert(c);
        outbox.publish("CONTRACT_SIGN_REQUIRED", "CONTRACT", c.getContractId(), Map.of(
                "userId", a.getUserId(), "signUrl", flow.signUrl(), "contractId", c.getContractId()));
        audit.log("ONBOARD_CONFIRM", "APPLICATION", applicationId, Map.of("contractNo", contractNo, "startDate", start.toString()));
        return view(c, flow.signUrl());
    }

    /**
     * 电子签回调（M-07）：签署完成 → 合同生效、建任职、CONTRACT_SIGNED → 在岗、重置岗位衰减（D-29）、通知项目经理与老板。
     * 幂等：合同行加锁，已生效直接返回；重复推送、并发推送都只入职一次。
     *
     * @return true = 本次完成了入职
     */
    @Transactional
    public boolean onSigned(String flowId, String signedFileKey) {
        return TenantContext.runAsSystem(() -> {
            LaborContract c = contracts.selectOne(new LambdaQueryWrapper<LaborContract>()
                    .eq(LaborContract::getEsignFlowId, flowId).last("FOR UPDATE"));
            if (c == null || c.getStatus() != ContractStatus.PENDING_SIGN) {
                return false;
            }
            Application a = applications.selectById(c.getApplicationId());
            SeekerUser u = users.selectById(c.getUserId());
            if (a == null || u == null || a.getStatus() != ApplicationStatus.PENDING_CONFIRM
                    || u.getUserStatus() != UserStatus.PENDING_CONFIRM) {
                // 签约前报名已被取消 / 超时：合同作废，不入职
                contracts.update(null, new LambdaUpdateWrapper<LaborContract>().eq(LaborContract::getContractId, c.getContractId())
                        .set(LaborContract::getStatus, ContractStatus.VOIDED).set(LaborContract::getEndedAt, LocalDateTime.now(clock)));
                return false;
            }
            LocalDateTime now = LocalDateTime.now(clock);
            Employment e = new Employment();
            e.setEmploymentId(ids.dated("EM", 5));
            e.setUserId(u.getUserId());
            e.setCompanyId(c.getCompanyId());
            e.setProjectId(a.getProjectId());
            e.setJobId(a.getJobId());
            e.setApplicationId(a.getApplicationId());
            e.setEmployeeNo(c.getEmployeeNo());
            e.setStartDate(c.getTermStart());
            e.setSourceCompanyIdSnapshot(u.getSourceCompanyId());
            e.setIsTransfer(!c.getCompanyId().equals(u.getSourceCompanyId()));
            e.setIsStock(false);
            e.setOrigin(Employment.ORIGIN_PLATFORM);
            e.setContractId(c.getContractId());
            e.setCreatedAt(now);
            try {
                employments.insert(e);
            } catch (DuplicateKeyException ex) {
                throw new BizException(ErrorCode.LC_ILLEGAL_TRANSITION, "该求职者已有在职记录");
            }
            contracts.update(null, new LambdaUpdateWrapper<LaborContract>().eq(LaborContract::getContractId, c.getContractId())
                    .set(LaborContract::getStatus, ContractStatus.EFFECTIVE).set(LaborContract::getSignedAt, now)
                    .set(LaborContract::getEmploymentId, e.getEmploymentId())
                    .set(LaborContract::getSignedFileKey, signedFileKey));
            lifecycle.transition(u.getUserId(), LifecycleEvent.CONTRACT_SIGNED, TransitionContext.of(ActorRole.SYSTEM), null,
                    "电子签约完成");
            jdbc.update("UPDATE job SET decay_reset_at = ? WHERE job_id = ?", now, a.getJobId());
            Job job = jobs.selectById(a.getJobId());
            outbox.publish("CONTRACT_SIGNED", "EMPLOYMENT", e.getEmploymentId(), Map.of("userId", u.getUserId(),
                    "companyId", c.getCompanyId(), "projectId", a.getProjectId(), "jobTitle", job == null ? "" : job.getTitle(),
                    "isTransfer", e.getIsTransfer(), "source", u.getSourceCompanyId()));
            return true;
        });
    }

    /** 拒签 / 过期回调：合同作废，用户仍在待确权，可由驻场重新发起。 */
    @Transactional
    public void onSignFailed(String flowId, ContractStatus as) {
        TenantContext.runAsSystem(() -> contracts.update(null, new LambdaUpdateWrapper<LaborContract>()
                .eq(LaborContract::getEsignFlowId, flowId).eq(LaborContract::getStatus, ContractStatus.PENDING_SIGN)
                .set(LaborContract::getStatus, as).set(LaborContract::getEndedAt, LocalDateTime.now(clock))));
    }

    // ================================================================== 在岗管理

    /** 内部调岗（T-307 / E-07）：bound 与计费不中断，只换项目 / 岗位。 */
    @Transactional
    public void transfer(AuthPrincipal p, String employmentId, String toProjectId, String toJobId) {
        BizException.check(p.hasRole(ActorRole.PM.name()), ErrorCode.LC_ACTOR_NOT_ALLOWED, "只有项目经理可以调岗");
        Employment e = activeEmployment(employmentId);
        scope.checkProject(p, e.getProjectId());
        Project to = projects.selectById(toProjectId);
        BizException.check(to != null, ErrorCode.SYS_NOT_FOUND, "目标项目不存在");
        if (toJobId != null) {
            Job j = jobs.selectById(toJobId);
            BizException.check(j != null && j.getProjectId().equals(toProjectId), ErrorCode.SYS_BAD_REQUEST, "岗位不属于目标项目");
        }
        BizException.check(!toProjectId.equals(e.getProjectId()) || (toJobId != null && !toJobId.equals(e.getJobId())),
                ErrorCode.SYS_BAD_REQUEST, "调岗前后相同");
        lifecycle.transition(e.getUserId(), LifecycleEvent.INTERNAL_TRANSFER, ctx(p, ActorRole.PM), p.subjectId(), "内部调岗");
        EmploymentChange ch = new EmploymentChange();
        ch.setCompanyId(e.getCompanyId());
        ch.setEmploymentId(employmentId);
        ch.setChangeType("INTERNAL_TRANSFER");
        ch.setFromProject(e.getProjectId());
        ch.setToProject(toProjectId);
        ch.setFromJob(e.getJobId());
        ch.setToJob(toJobId);
        ch.setEffectiveDate(LocalDate.now(clock));
        ch.setOperatorId(p.subjectId());
        ch.setCreatedAt(LocalDateTime.now(clock));
        changes.insert(ch);
        employments.update(null, new LambdaUpdateWrapper<Employment>().eq(Employment::getEmploymentId, employmentId)
                .set(Employment::getProjectId, toProjectId).set(Employment::getJobId, toJobId));
        audit.log("INTERNAL_TRANSFER", "EMPLOYMENT", employmentId, Map.of("from", e.getProjectId(), "to", toProjectId));
    }

    /** 请假 / 旷工标记（M-15，驻场）：同一天只有一条，type 为 null 表示撤销。 */
    @Transactional
    public void markAbsence(AuthPrincipal p, String employmentId, LocalDate date, String type, String remark) {
        BizException.check(p.hasAnyRole(ActorRole.SITE.name(), ActorRole.PM.name()), ErrorCode.LC_ACTOR_NOT_ALLOWED);
        Employment e = activeEmployment(employmentId);
        scope.checkProject(p, e.getProjectId());
        LocalDate today = LocalDate.now(clock.withZone(Constants.ZONE));
        BizException.check(date != null && !date.isBefore(e.getStartDate()) && !date.isAfter(today)
                        && !date.isBefore(today.minusDays(31)),
                ErrorCode.SYS_BAD_REQUEST, "只能标记入职以来、近 31 天内的日期");
        absences.delete(new LambdaQueryWrapper<DutyAbsence>().eq(DutyAbsence::getEmploymentId, employmentId)
                .eq(DutyAbsence::getAbsenceDate, date));
        if (type != null) {
            BizException.check(DutyAbsence.LEAVE.equals(type) || DutyAbsence.ABSENT.equals(type), ErrorCode.SYS_BAD_REQUEST);
            DutyAbsence d = new DutyAbsence();
            d.setCompanyId(e.getCompanyId());
            d.setEmploymentId(employmentId);
            d.setAbsenceDate(date);
            d.setAbsenceType(type);
            d.setMarkedBy(p.subjectId());
            d.setRemark(remark);
            d.setCreatedAt(LocalDateTime.now(clock));
            absences.insert(d);
        }
        audit.log(type == null ? "ABSENCE_CLEAR" : "ABSENCE_MARK", "EMPLOYMENT", employmentId,
                Map.of("date", date.toString(), "type", type == null ? "" : type));
    }

    // ================================================================== 查询

    public List<ContractView> contractsOfUser(String userId) {
        return TenantContext.runAsSystem(() -> contracts.selectList(new LambdaQueryWrapper<LaborContract>()
                        .eq(LaborContract::getUserId, userId).orderByDesc(LaborContract::getCreatedAt)))
                .stream().map(c -> view(c, null)).toList();
    }

    /** 求职者打开签署链接（C 端「待签署」入口）。 */
    public Optional<ContractView> pendingContractOfUser(String userId) {
        return TenantContext.runAsSystem(() -> contracts.selectList(new LambdaQueryWrapper<LaborContract>()
                        .eq(LaborContract::getUserId, userId).eq(LaborContract::getStatus, ContractStatus.PENDING_SIGN)
                        .orderByDesc(LaborContract::getCreatedAt)))
                .stream().findFirst().map(c -> view(c, c.getSignUrl()));
    }

    public LaborContract contractByFlow(String flowId) {
        return TenantContext.runAsSystem(() -> contracts.selectOne(new LambdaQueryWrapper<LaborContract>()
                .eq(LaborContract::getEsignFlowId, flowId)));
    }

    // ------------------------------------------------------------------


    private void voidPendingContracts(String applicationId) {
        List<LaborContract> pending = contracts.selectList(new LambdaQueryWrapper<LaborContract>()
                .eq(LaborContract::getApplicationId, applicationId).eq(LaborContract::getStatus, ContractStatus.PENDING_SIGN));
        for (LaborContract c : pending) {
            esign.revoke(c.getEsignFlowId());
            contracts.update(null, new LambdaUpdateWrapper<LaborContract>().eq(LaborContract::getContractId, c.getContractId())
                    .set(LaborContract::getStatus, ContractStatus.VOIDED).set(LaborContract::getEndedAt, LocalDateTime.now(clock)));
        }
    }

    private Application activeApplication(AuthPrincipal p, String applicationId, ApplicationStatus expected) {
        Application a = applications.selectById(applicationId);
        BizException.check(a != null, ErrorCode.SYS_NOT_FOUND);
        scope.checkProject(p, a.getProjectId());
        BizException.check(a.getStatus() == expected, ErrorCode.LC_ILLEGAL_TRANSITION,
                "该报名当前不是「" + expected.label() + "」状态");
        return a;
    }

    private Employment activeEmployment(String employmentId) {
        Employment e = employments.selectById(employmentId);
        BizException.check(e != null, ErrorCode.SYS_NOT_FOUND);
        BizException.check(e.getEndDate() == null, ErrorCode.LC_ILLEGAL_TRANSITION, "该员工已离职");
        return e;
    }

    /** 操作人在状态机里的角色：按事件允许的角色优先级取当前账号拥有的第一个。 */
    private static TransitionContext ctx(AuthPrincipal p, ActorRole... preferred) {
        for (ActorRole r : preferred) {
            if (p.hasRole(r.name())) {
                return TransitionContext.tenant(r, p.companyId());
            }
        }
        throw new BizException(ErrorCode.LC_ACTOR_NOT_ALLOWED);
    }

    private static boolean hasText(String s) {
        return s != null && !s.isBlank();
    }

    private ContractView view(LaborContract c, String signUrl) {
        Application a = c.getApplicationId() == null ? null : TenantContext.runAsSystem(() -> applications.selectById(c.getApplicationId()));
        Job j = a == null ? null : TenantContext.runAsSystem(() -> jobs.selectById(a.getJobId()));
        Project pr = a == null ? null : TenantContext.runAsSystem(() -> projects.selectById(a.getProjectId()));
        return new ContractView(c.getContractId(), c.getContractNo(), c.getTitle(),
                companies.namesOf(List.of(c.getCompanyId())).get(c.getCompanyId()), j == null ? null : j.getTitle(),
                pr == null ? null : pr.getName(), c.getTermStart(), c.getTermEnd(), c.getStatus(), signUrl,
                c.getSignedAt(), c.getCreatedAt());
    }
}
