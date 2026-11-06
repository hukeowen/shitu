package com.shitu.app.seeker;

import com.shitu.common.enums.DomainTag;
import com.shitu.common.enums.MatchScope;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.outbox.OutboxWriter;
import com.shitu.framework.param.SysParams;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.job.Job;
import com.shitu.job.mapper.JobMapper;
import com.shitu.lifecycle.domain.DomainRules;
import com.shitu.lifecycle.domain.IdCards;
import com.shitu.lifecycle.seeker.DisclaimerService;
import com.shitu.lifecycle.seeker.KycService;
import com.shitu.lifecycle.seeker.LifecycleService;
import com.shitu.lifecycle.seeker.SeekerUser;
import com.shitu.matching.domain.ProfileBuilder;
import com.shitu.matching.session.MatchService;
import com.shitu.tenant.company.CompanyService;
import com.shitu.tenant.mapper.ProjectMapper;
import com.shitu.tenant.project.Project;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * C 端求职主流程编排：AI 问薪（C-301~306）→ 岗位详情（C-401，仅限匹配结果）→ 告知书（C-403）→ 实名（C-404~406）→ 报名（C-407）。
 */
@Service
public class SeekerJourneyFacade {

    /** 岗位详情（不含平台权重 R-14）。 */
    public record JobDetail(String jobId, String title, String companyName, String projectName, String city,
                            String address, String jobType, String shiftType, BigDecimal salaryMin, BigDecimal salaryMax,
                            boolean dormProvided, Integer dormRoomSize, Boolean dormAircon, Boolean dormPrivateBath,
                            boolean mealProvided, int minWorkYears, int ageMin, int ageMax, String duties,
                            String benefits, List<String> requiredDocuments, String notes, String interviewAddress,
                            String interviewTimeDesc, int quotaRemaining, BigDecimal lng, BigDecimal lat,
                            boolean canApply, String cannotApplyReason) {
    }

    public record ApplyResult(String applicationId, String jobTitle, String companyName, String interviewAddress,
                              LocalDateTime responseDeadline) {
    }

    private final LifecycleService lifecycle;
    private final MatchService matching;
    private final KycService kyc;
    private final DisclaimerService disclaimer;
    private final JobMapper jobs;
    private final ProjectMapper projects;
    private final CompanyService companies;
    private final OutboxWriter outbox;
    private final SysParams params;
    private final com.shitu.circulation.BrokerService brokers;
    private final Clock clock;

    public SeekerJourneyFacade(LifecycleService lifecycle, MatchService matching, KycService kyc, DisclaimerService disclaimer,
                               JobMapper jobs, ProjectMapper projects, CompanyService companies, OutboxWriter outbox,
                               SysParams params, com.shitu.circulation.BrokerService brokers, Clock clock) {
        this.lifecycle = lifecycle;
        this.matching = matching;
        this.kyc = kyc;
        this.disclaimer = disclaimer;
        this.jobs = jobs;
        this.projects = projects;
        this.companies = companies;
        this.outbox = outbox;
        this.params = params;
        this.brokers = brokers;
        this.clock = clock;
    }

    // ------------------------------------------------------------------ 问薪

    /**
     * 提交答案 → 匹配。报名锁定期（待面试 / 待确权）拒绝（R-03）；私域只匹配本公司（C-301）。
     * 匹配度不足：私域用户转入本公司人才经纪人流转池（C-305 / D-10）；公域用户提示调整条件重新匹配（D-38）。
     */
    @Transactional
    public MatchService.MatchOutcome match(String userId, List<ProfileBuilder.Answer> answers, BigDecimal lng, BigDecimal lat) {
        SeekerUser u = user(userId);
        BizException.check(DomainRules.canStartMatching(u.snapshot()), ErrorCode.LC_MATCH_LOCKED);
        MatchScope scope = DomainRules.matchScope(u.snapshot());
        Integer age = u.getBirthDate() == null ? null : IdCards.age(u.getBirthDate(), LocalDate.now(clock));
        MatchService.MatchOutcome out = matching.match(userId, scope, u.getBoundCompanyId(), answers, age, lng, lat);
        int count = lifecycle.recordMatch(userId);
        boolean isPrivate = DomainRules.domainTag(u.snapshot()) != DomainTag.PUBLIC && u.getBoundCompanyId() != null;
        if (!out.matched() && isPrivate) {
            brokers.open(userId, u.getBoundCompanyId(), "LOW_MATCH", out.sessionId(), null);
        } else if (isPrivate && count >= params.getInt("matching.rematch_alert_count", 3)) {
            // D-11：同一求职周期累计匹配 N 次仍未报名 → 转人才经纪人流转池并提醒驻场介入（T-201）
            brokers.open(userId, u.getBoundCompanyId(), "REMATCH_LIMIT", out.sessionId(), null);
            outbox.publish("REMATCH_LIMIT_REACHED", "USER", userId, Map.of("userId", userId,
                    "companyId", u.getBoundCompanyId(), "count", count));
        }
        return out;
    }

    public java.util.Optional<MatchService.MatchOutcome> latest(String userId) {
        return matching.latest(userId);
    }

    /** 岗位详情：只能从最近一次匹配结果进入（C-401 / R-01）。 */
    public JobDetail job(String userId, String jobId) {
        BizException.check(matching.latestSessionContaining(userId, jobId).isPresent()
                || brokers.recommendedCase(userId, jobId).isPresent(), ErrorCode.APP_NOT_FROM_MATCH);
        Job j = TenantContext.runAsSystem(() -> jobs.selectById(jobId));
        BizException.check(j != null, ErrorCode.SYS_NOT_FOUND);
        Project p = TenantContext.runAsSystem(() -> projects.selectById(j.getProjectId()));
        String company = companies.namesOf(List.of(j.getCompanyId())).get(j.getCompanyId());
        String reason = cannotApplyReason(user(userId), j);
        return new JobDetail(j.getJobId(), j.getTitle(), company, p == null ? null : p.getName(),
                p == null ? null : p.getCity(), p == null ? null : p.getAddress(), j.getJobType().name(),
                j.getShiftType().name(), j.getSalaryMin(), j.getSalaryMax(), Boolean.TRUE.equals(j.getDormProvided()),
                j.getDormRoomSize(), j.getDormAircon(), j.getDormPrivateBath(), Boolean.TRUE.equals(j.getMealProvided()),
                j.getMinWorkYears(), j.getAgeMin(), j.getAgeMax(), j.getDuties(), j.getBenefits(), j.getRequiredDocuments(),
                j.getNotes(), j.getInterviewAddress(), j.getInterviewTimeDesc(), j.getQuotaRemaining(),
                p == null ? null : p.getLng(), p == null ? null : p.getLat(), reason == null, reason);
    }

    // ------------------------------------------------------------------ 报名

    /**
     * 报名（C-407）。前置条件逐项校验，报名本身（锁用户、原子扣名额、建单、改归属、重开 24h）在生命周期服务的一个事务里完成。
     */
    public ApplyResult apply(String userId, String jobId) {
        // 合法入口两个：最近一次匹配结果（R-01），或经纪人推荐给本人的岗位（T-203）
        String sessionId = matching.latestSessionContaining(userId, jobId).orElse(null);
        Long brokerCaseId = sessionId == null ? brokers.recommendedCase(userId, jobId).orElse(null) : null;
        BizException.check(sessionId != null || brokerCaseId != null, ErrorCode.APP_NOT_FROM_MATCH);
        SeekerUser u = user(userId);
        BizException.check(disclaimer.hasAgreed(userId), ErrorCode.APP_DISCLAIMER_REQUIRED);
        BizException.check("VERIFIED".equals(u.getKycStatus()), ErrorCode.KYC_REQUIRED);
        BizException.check(!Boolean.TRUE.equals(u.getBlacklistFlag()), ErrorCode.KYC_BLACKLISTED);
        BizException.check(u.getBirthDate() != null && IdCards.age(u.getBirthDate(), LocalDate.now(clock)) >= kyc.minAgeApply(),
                ErrorCode.APP_UNDERAGE);
        Job j = TenantContext.runAsSystem(() -> jobs.selectById(jobId));
        BizException.check(j != null, ErrorCode.SYS_NOT_FOUND);
        Integer age = IdCards.age(u.getBirthDate(), LocalDate.now(clock));
        BizException.check(age >= j.getAgeMin() && age <= j.getAgeMax(), ErrorCode.APP_NOT_FROM_MATCH,
                "该岗位要求年龄 " + j.getAgeMin() + "–" + j.getAgeMax() + " 岁");
        LifecycleService.TransitionResult r = lifecycle.apply(new LifecycleService.ApplyCommand(userId, jobId,
                j.getCompanyId(), j.getProjectId(), j.getTitle(), j.getInterviewAddress(), sessionId, brokerCaseId));
        // 报名成功（无论来自匹配还是经纪人推荐）即结束该用户的流转工单
        brokers.closeAfterApply(userId);
        String company = companies.namesOf(List.of(j.getCompanyId())).get(j.getCompanyId());
        LocalDateTime deadline = lifecycle.openWindowOf(userId).map(w -> w.getDeadline()).orElse(null);
        return new ApplyResult(r.applicationId(), j.getTitle(), company, j.getInterviewAddress(), deadline);
    }

    /** 详情页「报名」按钮是否可用及原因（前端据此引导去实名 / 告知书）。 */
    private String cannotApplyReason(SeekerUser u, Job j) {
        if (!DomainRules.canStartMatching(u.snapshot())) {
            return "你已有进行中的报名";
        }
        if (j.getQuotaRemaining() <= 0) {
            return "名额已满";
        }
        if ("VERIFIED".equals(u.getKycStatus()) && u.getBirthDate() != null) {
            int age = IdCards.age(u.getBirthDate(), LocalDate.now(clock));
            if (age < kyc.minAgeApply()) {
                return "未满 18 周岁不能报名";
            }
            if (age < j.getAgeMin() || age > j.getAgeMax()) {
                return "该岗位要求年龄 " + j.getAgeMin() + "–" + j.getAgeMax() + " 岁";
            }
        }
        return null;
    }

    private SeekerUser user(String userId) {
        return lifecycle.find(userId).orElseThrow(() -> new BizException(ErrorCode.SYS_UNAUTHORIZED));
    }

}
