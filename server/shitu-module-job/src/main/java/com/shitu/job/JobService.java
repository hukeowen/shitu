package com.shitu.job;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.shitu.common.api.PageResult;
import com.shitu.common.enums.JobStatus;
import com.shitu.common.enums.JobType;
import com.shitu.common.enums.ProjectStatus;
import com.shitu.common.enums.ShiftType;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.id.BizIdGenerator;
import com.shitu.framework.outbox.OutboxWriter;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.framework.web.Pages;
import com.shitu.job.mapper.JobAuditMapper;
import com.shitu.job.mapper.JobMapper;
import com.shitu.tenant.client.ClientService;
import com.shitu.tenant.company.CompanyService;
import com.shitu.tenant.project.Project;
import com.shitu.tenant.project.ProjectService;
import com.shitu.tenant.scope.DataScope;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 岗位（T-302 / T-303 / P-04）。
 * <pre>
 * 新建 / 编辑 ──→ PENDING_AUDIT ──平台通过──→ RECRUITING ⇄ PAUSED（暂停移出匹配池，恢复后挂岗天数重置）
 *                       └──驳回──→ REJECTED                └──→ OFFLINE（公司下架）/ FORCE_OFFLINE（平台强制下架）
 * </pre>
 * 编辑招聘中的岗位会重新进入审核（审核期间不参与匹配）；只改名额不需要审核。
 * 岗位必须挂在「已审核且在有效期内的合作合同」所覆盖的甲方下，提交和审核通过时各校验一次。
 */
@Service
public class JobService {

    private static final Set<JobStatus> EDITABLE = EnumSet.of(JobStatus.PENDING_AUDIT, JobStatus.REJECTED,
            JobStatus.RECRUITING, JobStatus.PAUSED, JobStatus.OFFLINE, JobStatus.FORCE_OFFLINE);
    private static final Set<JobStatus> OFFLINE_FROM = EnumSet.of(JobStatus.PENDING_AUDIT, JobStatus.REJECTED,
            JobStatus.RECRUITING, JobStatus.PAUSED);

    public record JobCommand(String projectId, String title, JobType jobType, Boolean factoryJob,
                             BigDecimal salaryMin, BigDecimal salaryMax, ShiftType shiftType,
                             Boolean dormProvided, Integer dormRoomSize, Boolean dormAircon, Boolean dormPrivateBath,
                             Boolean mealProvided, Integer minWorkYears, Integer ageMin, Integer ageMax,
                             String duties, String benefits, List<String> requiredDocuments, String notes,
                             String interviewAddress, String interviewTimeDesc, Integer quotaTotal) {
    }

    public record JobQuery(JobStatus status, String projectId, String keyword, String companyId,
                           Integer page, Integer pageSize) {
    }

    /** 租户视图：不含平台权重（R-14）。 */
    public record JobView(String jobId, String companyId, String companyName, String projectId, String projectName,
                          String city, String clientId, String clientName, String title, JobType jobType,
                          boolean factoryJob, BigDecimal salaryMin, BigDecimal salaryMax, ShiftType shiftType,
                          boolean dormProvided, Integer dormRoomSize, Boolean dormAircon, Boolean dormPrivateBath,
                          boolean mealProvided, int minWorkYears, int ageMin, int ageMax, String duties,
                          String benefits, List<String> requiredDocuments, String notes, String interviewAddress,
                          String interviewTimeDesc, int quotaTotal, int quotaRemaining, int quotaOccupied,
                          JobStatus status, String auditRemark, LocalDateTime submittedAt, LocalDateTime postedAt,
                          LocalDateTime lastInfoUpdateAt, LocalDateTime createdAt, List<String> allowedActions) {
    }

    public record AuditRecord(String action, String remark, String operatorId, LocalDateTime createdAt) {
    }

    private final JobMapper jobs;
    private final JobAuditMapper audits;
    private final ProjectService projects;
    private final ClientService clients;
    private final CompanyService companies;
    private final DataScope scope;
    private final BizIdGenerator ids;
    private final AuditLogger audit;
    private final OutboxWriter outbox;
    private final Clock clock;

    public JobService(JobMapper jobs, JobAuditMapper audits, ProjectService projects, ClientService clients,
                      CompanyService companies, DataScope scope, BizIdGenerator ids, AuditLogger audit,
                      OutboxWriter outbox, Clock clock) {
        this.jobs = jobs;
        this.audits = audits;
        this.projects = projects;
        this.clients = clients;
        this.companies = companies;
        this.scope = scope;
        this.ids = ids;
        this.audit = audit;
        this.outbox = outbox;
        this.clock = clock;
    }

    // ------------------------------------------------------------------ 公司后台（TENANT 模式）

    public PageResult<JobView> list(AuthPrincipal p, JobQuery q) {
        DataScope.Scope s = scope.of(p);
        if (!s.all() && s.projectIds().isEmpty()) {
            return new PageResult<>(List.of(), 0, 1, 20);
        }
        Page<Job> page = jobs.selectPage(Pages.of(q.page(), q.pageSize()), new LambdaQueryWrapper<Job>()
                .in(!s.all(), Job::getProjectId, s.projectIds())
                .eq(q.status() != null, Job::getJobStatus, q.status())
                .eq(q.projectId() != null && !q.projectId().isBlank(), Job::getProjectId, q.projectId())
                .and(q.keyword() != null && !q.keyword().isBlank(), w -> w.like(Job::getTitle, q.keyword())
                        .or().eq(Job::getJobId, q.keyword()))
                .orderByDesc(Job::getCreatedAt));
        return toPage(page, false);
    }

    public JobView get(AuthPrincipal p, String jobId) {
        Job j = mustGet(jobId);
        scope.checkProject(p, j.getProjectId());
        return views(List.of(j), false).get(0);
    }

    @Transactional
    public JobView create(AuthPrincipal p, JobCommand cmd) {
        validate(cmd);
        Project pr = projects.mustGet(cmd.projectId());
        scope.checkProject(p, pr.getProjectId());
        BizException.check(pr.getStatus() == ProjectStatus.ACTIVE, ErrorCode.TEN_ILLEGAL_STATUS, "项目已结束，不能发布岗位");
        checkContract(pr.getCompanyId(), pr.getClientId());
        LocalDateTime now = LocalDateTime.now(clock);
        Job j = new Job();
        j.setJobId(ids.dated("J", 3));
        j.setCompanyId(p.companyId());
        j.setProjectId(pr.getProjectId());
        j.setClientId(pr.getClientId());
        apply(j, cmd);
        j.setQuotaTotal(cmd.quotaTotal());
        j.setQuotaRemaining(cmd.quotaTotal());
        j.setJobStatus(JobStatus.PENDING_AUDIT);
        j.setSubmittedAt(now);
        j.setLastInfoUpdateAt(now);
        j.setCreatedBy(p.subjectId());
        j.setCreatedAt(now);
        jobs.insert(j);
        logAudit(j, "SUBMIT", null, p.subjectId());
        audit.log("JOB_CREATE", "JOB", j.getJobId(), Map.of("title", j.getTitle()));
        outbox.publish("JOB_SUBMITTED", "JOB", j.getJobId(), Map.of("companyId", j.getCompanyId()));
        return views(List.of(j), false).get(0);
    }

    /** 编辑岗位信息 → 重新审核。名额在这里也可以改，但不能少于已占用数。 */
    @Transactional
    public JobView update(AuthPrincipal p, String jobId, JobCommand cmd) {
        validate(cmd);
        Job j = mustGet(jobId);
        scope.checkProject(p, j.getProjectId());
        BizException.check(EDITABLE.contains(j.getJobStatus()), ErrorCode.JOB_ILLEGAL_STATUS);
        BizException.check(j.getProjectId().equals(cmd.projectId()), ErrorCode.SYS_BAD_REQUEST, "岗位不能更换所属项目");
        checkContract(j.getCompanyId(), j.getClientId());
        BizException.check(cmd.quotaTotal() >= j.occupied(), ErrorCode.JOB_QUOTA_INVALID,
                "名额不能少于已被报名占用的 " + j.occupied() + " 个");
        LocalDateTime now = LocalDateTime.now(clock);
        apply(j, cmd);
        j.setQuotaRemaining(cmd.quotaTotal() - j.occupied());
        j.setQuotaTotal(cmd.quotaTotal());
        j.setJobStatus(JobStatus.PENDING_AUDIT);
        j.setSubmittedAt(now);
        j.setLastInfoUpdateAt(now);
        BizException.check(jobs.updateById(j) == 1, ErrorCode.SYS_CONFLICT);
        logAudit(j, "SUBMIT", "编辑后重新提交", p.subjectId());
        audit.log("JOB_UPDATE", "JOB", jobId, Map.of("title", j.getTitle()));
        outbox.publish("JOB_SUBMITTED", "JOB", jobId, Map.of("companyId", j.getCompanyId(), "resubmit", true));
        return views(List.of(j), false).get(0);
    }

    /** 只调整名额，不重新审核。 */
    @Transactional
    public JobView adjustQuota(AuthPrincipal p, String jobId, int total) {
        BizException.check(total >= 1 && total <= 9999, ErrorCode.JOB_FIELD_INVALID, "名额为 1–9999");
        Job j = mustGet(jobId);
        scope.checkProject(p, j.getProjectId());
        BizException.check(EDITABLE.contains(j.getJobStatus()), ErrorCode.JOB_ILLEGAL_STATUS);
        int rows = jobs.adjustQuota(jobId, total, LocalDateTime.now(clock));
        BizException.check(rows == 1, ErrorCode.JOB_QUOTA_INVALID);
        audit.log("JOB_QUOTA_ADJUST", "JOB", jobId, Map.of("before", j.getQuotaTotal(), "after", total));
        return get(p, jobId);
    }

    @Transactional
    public JobView pause(AuthPrincipal p, String jobId) {
        Job j = transit(p, jobId, EnumSet.of(JobStatus.RECRUITING), JobStatus.PAUSED);
        audit.log("JOB_PAUSE", "JOB", jobId, null);
        outbox.publish("JOB_PAUSED", "JOB", jobId, Map.of("companyId", j.getCompanyId()));
        return views(List.of(j), false).get(0);
    }

    /** 恢复招聘：挂岗天数从恢复时刻重新计算（posted_at 重置）。 */
    @Transactional
    public JobView resume(AuthPrincipal p, String jobId) {
        Job peek = mustGet(jobId);
        checkContract(peek.getCompanyId(), peek.getClientId());
        Job j = transit(p, jobId, EnumSet.of(JobStatus.PAUSED), JobStatus.RECRUITING);
        audit.log("JOB_RESUME", "JOB", jobId, null);
        return views(List.of(j), false).get(0);
    }

    @Transactional
    public JobView offline(AuthPrincipal p, String jobId) {
        Job j = transit(p, jobId, OFFLINE_FROM, JobStatus.OFFLINE);
        audit.log("JOB_OFFLINE", "JOB", jobId, null);
        outbox.publish("JOB_OFFLINE", "JOB", jobId, Map.of("companyId", j.getCompanyId()));
        return views(List.of(j), false).get(0);
    }

    public List<AuditRecord> auditTrail(String jobId) {
        mustGet(jobId);
        return audits.selectList(new LambdaQueryWrapper<JobAudit>().eq(JobAudit::getJobId, jobId).orderByDesc(JobAudit::getId))
                .stream().map(a -> new AuditRecord(a.getAction(), a.getRemark(), a.getOperatorId(), a.getCreatedAt())).toList();
    }

    /** 项目下是否还有招聘中 / 暂停 / 待审核的岗位（结束项目前校验）。 */
    public boolean hasLiveJobs(String projectId) {
        return jobs.selectCount(new LambdaQueryWrapper<Job>().eq(Job::getProjectId, projectId)
                .in(Job::getJobStatus, JobStatus.PENDING_AUDIT, JobStatus.RECRUITING, JobStatus.PAUSED)) > 0;
    }

    // ------------------------------------------------------------------ 平台中台（OPS 模式）P-04

    public PageResult<JobView> listForOps(JobQuery q) {
        Page<Job> page = jobs.selectPage(Pages.of(q.page(), q.pageSize()), new LambdaQueryWrapper<Job>()
                .eq(q.status() != null, Job::getJobStatus, q.status())
                .eq(q.companyId() != null && !q.companyId().isBlank(), Job::getCompanyId, q.companyId())
                .and(q.keyword() != null && !q.keyword().isBlank(), w -> w.like(Job::getTitle, q.keyword())
                        .or().eq(Job::getJobId, q.keyword()))
                .orderByAsc(q.status() == JobStatus.PENDING_AUDIT, Job::getSubmittedAt)
                .orderByDesc(q.status() != JobStatus.PENDING_AUDIT, Job::getCreatedAt));
        return toPage(page, true);
    }

    public JobView getForOps(String jobId) {
        return views(List.of(mustGet(jobId)), true).get(0);
    }

    public BigDecimal matchWeightOf(String jobId) {
        return mustGet(jobId).getMatchWeight();
    }

    @Transactional
    public JobView approve(String jobId, String remark, String operatorId) {
        Job j = mustGet(jobId);
        BizException.check(j.getJobStatus() == JobStatus.PENDING_AUDIT, ErrorCode.JOB_ILLEGAL_STATUS);
        checkContract(j.getCompanyId(), j.getClientId());
        BizException.check(companies.isOperational(j.getCompanyId()), ErrorCode.TEN_COMPANY_NOT_ACTIVE);
        LocalDateTime now = LocalDateTime.now(clock);
        j.setJobStatus(JobStatus.RECRUITING);
        j.setAuditRemark(null);
        j.setPostedAt(now);
        BizException.check(jobs.updateById(j) == 1, ErrorCode.SYS_CONFLICT);
        logAudit(j, "APPROVE", remark, operatorId);
        audit.logForCompany(j.getCompanyId(), "JOB_APPROVE", "JOB", jobId, null);
        outbox.publish("JOB_APPROVED", "JOB", jobId, Map.of("companyId", j.getCompanyId(), "title", j.getTitle()));
        return views(List.of(j), true).get(0);
    }

    @Transactional
    public JobView reject(String jobId, String remark, String operatorId) {
        BizException.check(remark != null && !remark.isBlank(), ErrorCode.SYS_BAD_REQUEST, "请填写驳回说明");
        Job j = mustGet(jobId);
        BizException.check(j.getJobStatus() == JobStatus.PENDING_AUDIT, ErrorCode.JOB_ILLEGAL_STATUS);
        j.setJobStatus(JobStatus.REJECTED);
        j.setAuditRemark(remark.trim());
        BizException.check(jobs.updateById(j) == 1, ErrorCode.SYS_CONFLICT);
        logAudit(j, "REJECT", remark.trim(), operatorId);
        audit.logForCompany(j.getCompanyId(), "JOB_REJECT", "JOB", jobId, Map.of("remark", remark.trim()));
        outbox.publish("JOB_REJECTED", "JOB", jobId, Map.of("companyId", j.getCompanyId(), "remark", remark.trim()));
        return views(List.of(j), true).get(0);
    }

    @Transactional
    public JobView forceOffline(String jobId, String remark, String operatorId) {
        BizException.check(remark != null && !remark.isBlank(), ErrorCode.SYS_BAD_REQUEST, "请填写强制下架原因");
        Job j = mustGet(jobId);
        BizException.check(EnumSet.of(JobStatus.RECRUITING, JobStatus.PAUSED, JobStatus.PENDING_AUDIT).contains(j.getJobStatus()),
                ErrorCode.JOB_ILLEGAL_STATUS);
        j.setJobStatus(JobStatus.FORCE_OFFLINE);
        j.setAuditRemark(remark.trim());
        BizException.check(jobs.updateById(j) == 1, ErrorCode.SYS_CONFLICT);
        logAudit(j, "FORCE_OFFLINE", remark.trim(), operatorId);
        audit.logForCompany(j.getCompanyId(), "JOB_FORCE_OFFLINE", "JOB", jobId, Map.of("remark", remark.trim()));
        outbox.publish("JOB_FORCE_OFFLINE", "JOB", jobId, Map.of("companyId", j.getCompanyId(), "remark", remark.trim()));
        return views(List.of(j), true).get(0);
    }

    public long countByStatus(JobStatus status) {
        return jobs.selectCount(new LambdaQueryWrapper<Job>().eq(Job::getJobStatus, status));
    }

    // ------------------------------------------------------------------

    private Job transit(AuthPrincipal p, String jobId, Set<JobStatus> from, JobStatus to) {
        Job j = mustGet(jobId);
        scope.checkProject(p, j.getProjectId());
        BizException.check(from.contains(j.getJobStatus()), ErrorCode.JOB_ILLEGAL_STATUS);
        j.setJobStatus(to);
        if (to == JobStatus.RECRUITING) {
            j.setPostedAt(LocalDateTime.now(clock));
        }
        BizException.check(jobs.updateById(j) == 1, ErrorCode.SYS_CONFLICT);
        return j;
    }

    private Job mustGet(String jobId) {
        Job j = jobs.selectById(jobId);
        BizException.check(j != null, ErrorCode.SYS_NOT_FOUND, "岗位不存在");
        return j;
    }

    private void checkContract(String companyId, String clientId) {
        BizException.check(clients.hasEffectiveContract(companyId, clientId, LocalDate.now(clock)), ErrorCode.TEN_CONTRACT_REQUIRED);
    }

    private void logAudit(Job j, String action, String remark, String operatorId) {
        JobAudit a = new JobAudit();
        a.setCompanyId(j.getCompanyId());
        a.setJobId(j.getJobId());
        a.setAction(action);
        a.setRemark(remark);
        a.setOperatorId(operatorId);
        a.setCreatedAt(LocalDateTime.now(clock));
        audits.insert(a);
    }

    static void validate(JobCommand c) {
        req(c.projectId() != null && !c.projectId().isBlank(), "请选择项目");
        req(c.title() != null && !c.title().isBlank() && c.title().trim().length() <= 64, "请填写岗位名称（64 字以内）");
        req(c.jobType() != null, "请选择工种");
        req(c.shiftType() != null, "请选择班次");
        req(c.salaryMin() != null && c.salaryMax() != null && c.salaryMin().signum() > 0
                && c.salaryMin().compareTo(c.salaryMax()) <= 0 && c.salaryMax().compareTo(new BigDecimal("100000")) < 0,
                "月综合薪资范围不正确");
        int ageMin = c.ageMin() == null ? 18 : c.ageMin();
        int ageMax = c.ageMax() == null ? 45 : c.ageMax();
        req(ageMin >= 16 && ageMax <= 65 && ageMin <= ageMax, "年龄要求为 16–65 岁");
        req(c.minWorkYears() == null || (c.minWorkYears() >= 0 && c.minWorkYears() <= 3), "工作经验要求不正确");
        req(!Boolean.TRUE.equals(c.dormProvided()) || c.dormRoomSize() == null
                || (c.dormRoomSize() >= 1 && c.dormRoomSize() <= 20), "宿舍人数不正确");
        req(c.duties() != null && !c.duties().isBlank() && c.duties().length() <= 2000, "请填写岗位职责（2000 字以内）");
        req(c.interviewAddress() != null && !c.interviewAddress().isBlank(), "请填写面试地址");
        req(c.quotaTotal() != null && c.quotaTotal() >= 1 && c.quotaTotal() <= 9999, "招聘名额为 1–9999");
        req(c.requiredDocuments() == null || c.requiredDocuments().size() <= 10, "所需材料最多 10 项");
    }

    private static void req(boolean ok, String msg) {
        BizException.check(ok, ErrorCode.JOB_FIELD_INVALID, msg);
    }

    private static void apply(Job j, JobCommand c) {
        j.setTitle(c.title().trim());
        j.setJobType(c.jobType());
        j.setFactoryJob(c.factoryJob() == null || c.factoryJob());
        j.setSalaryMin(c.salaryMin());
        j.setSalaryMax(c.salaryMax());
        j.setShiftType(c.shiftType());
        boolean dorm = Boolean.TRUE.equals(c.dormProvided());
        j.setDormProvided(dorm);
        j.setDormRoomSize(dorm ? c.dormRoomSize() : null);
        j.setDormAircon(dorm ? c.dormAircon() : null);
        j.setDormPrivateBath(dorm ? c.dormPrivateBath() : null);
        j.setMealProvided(Boolean.TRUE.equals(c.mealProvided()));
        j.setMinWorkYears(c.minWorkYears() == null ? 0 : c.minWorkYears());
        j.setAgeMin(c.ageMin() == null ? 18 : c.ageMin());
        j.setAgeMax(c.ageMax() == null ? 45 : c.ageMax());
        j.setDuties(c.duties().trim());
        j.setBenefits(c.benefits());
        j.setRequiredDocuments(c.requiredDocuments());
        j.setNotes(c.notes());
        j.setInterviewAddress(c.interviewAddress().trim());
        j.setInterviewTimeDesc(c.interviewTimeDesc());
    }

    private PageResult<JobView> toPage(Page<Job> page, boolean ops) {
        return new PageResult<>(views(page.getRecords(), ops), page.getTotal(), page.getCurrent(), page.getSize());
    }

    private List<JobView> views(List<Job> list, boolean ops) {
        Map<String, String> projectNames = projects.namesOf(list.stream().map(Job::getProjectId).distinct().toList());
        Map<String, String> clientNames = clients.clientNames(list.stream().map(Job::getClientId).distinct().toList());
        Map<String, String> companyNames = ops ? companies.namesOf(list.stream().map(Job::getCompanyId).distinct().toList()) : Map.of();
        return list.stream().map(j -> {
            Project pr = projects.find(j.getProjectId());
            return new JobView(j.getJobId(), j.getCompanyId(), companyNames.get(j.getCompanyId()), j.getProjectId(),
                    projectNames.get(j.getProjectId()), pr == null ? null : pr.getCity(), j.getClientId(),
                    clientNames.get(j.getClientId()), j.getTitle(), j.getJobType(), Boolean.TRUE.equals(j.getFactoryJob()),
                    j.getSalaryMin(), j.getSalaryMax(), j.getShiftType(), Boolean.TRUE.equals(j.getDormProvided()),
                    j.getDormRoomSize(), j.getDormAircon(), j.getDormPrivateBath(), Boolean.TRUE.equals(j.getMealProvided()),
                    j.getMinWorkYears(), j.getAgeMin(), j.getAgeMax(), j.getDuties(), j.getBenefits(),
                    j.getRequiredDocuments(), j.getNotes(), j.getInterviewAddress(), j.getInterviewTimeDesc(),
                    j.getQuotaTotal(), j.getQuotaRemaining(), j.occupied(), j.getJobStatus(), j.getAuditRemark(),
                    j.getSubmittedAt(), j.getPostedAt(), j.getLastInfoUpdateAt(), j.getCreatedAt(),
                    ops ? opsActions(j.getJobStatus()) : tenantActions(j.getJobStatus()));
        }).toList();
    }

    /** 前端按 allowedActions 显示按钮，不自己推断（02-架构 §13）。 */
    static List<String> tenantActions(JobStatus s) {
        return switch (s) {
            case PENDING_AUDIT -> List.of("EDIT", "QUOTA", "OFFLINE");
            case REJECTED -> List.of("EDIT", "OFFLINE");
            case RECRUITING -> List.of("EDIT", "QUOTA", "PAUSE", "OFFLINE");
            case PAUSED -> List.of("EDIT", "QUOTA", "RESUME", "OFFLINE");
            case OFFLINE, FORCE_OFFLINE -> List.of("EDIT");
        };
    }

    static List<String> opsActions(JobStatus s) {
        return switch (s) {
            case PENDING_AUDIT -> List.of("APPROVE", "REJECT", "FORCE_OFFLINE");
            case RECRUITING, PAUSED -> List.of("FORCE_OFFLINE");
            default -> List.of();
        };
    }
}
