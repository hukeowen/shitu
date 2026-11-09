package com.shitu.circulation;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.shitu.circulation.mapper.AiReportMapper;
import com.shitu.circulation.mapper.BrokerCaseMapper;
import com.shitu.circulation.mapper.BrokerRecommendationMapper;
import com.shitu.common.enums.ActorRole;
import com.shitu.common.enums.JobStatus;
import com.shitu.common.enums.UserStatus;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.common.util.Masks;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.outbox.OutboxWriter;
import com.shitu.framework.param.SysParams;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.job.Job;
import com.shitu.job.mapper.JobMapper;
import com.shitu.lifecycle.domain.LifecycleEvent;
import com.shitu.lifecycle.domain.TransitionContext;
import com.shitu.lifecycle.seeker.LifecycleService;
import com.shitu.lifecycle.seeker.SeekerUser;
import com.shitu.matching.domain.MatchProfile;
import com.shitu.matching.domain.MatchScorer;
import com.shitu.matching.quiz.QuizService;
import com.shitu.matching.session.MatchService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 人才经纪人流转池（T-201 ~ T-204，M-09，D-10 / D-13）。
 * <pre>
 * 入池：匹配度不足（LOW_MATCH）、本求职周期匹配满 N 次（REMATCH_LIMIT）、驻场一键流转（SITE_TRANSFER）
 * SLA：2 小时内联系（超时提醒驻场与项目经理）；24 小时内出结果，否则 BROKER_SLA_TIMEOUT 自动释放至公域
 * 处理：生成 AI 分析报告 → 推荐岗位（用户在 C 端确认后走正常实名 + 告知书报名）→ 或主动释放（必填原因）
 * </pre>
 * 经纪人是公司内部角色，可以跨项目，不能跨公司；看完整画像、联系方式脱敏（A-19）。
 */
@Service
public class BrokerService {

    public record CaseRow(long id, String userId, String seekerName, String phoneMasked, String triggerType, String status,
                          String fromMemberId, LocalDateTime contactDueAt, LocalDateTime resolveDueAt,
                          LocalDateTime contactedAt, LocalDateTime createdAt, int matchCount, String profileSummary,
                          List<String> allowedActions, String fromMemberName, String brokerName) {
    }

    public record Recommendation(String jobId, String title, BigDecimal matchScore, String reason) {
    }

    public record Report(long id, long caseId, String summary, List<Recommendation> recommendations, String generator,
                         LocalDateTime createdAt) {
    }

    /** C 端：经纪人推荐给我的岗位。 */
    public record MyRecommendation(long id, String jobId, String jobTitle, String companyName, String note, String decision,
                                   LocalDateTime createdAt) {
    }

    private final BrokerCaseMapper cases;
    private final BrokerRecommendationMapper recommendations;
    private final AiReportMapper reports;
    private final LifecycleService lifecycle;
    private final MatchService matching;
    private final QuizService quiz;
    private final JobMapper jobs;
    private final com.shitu.tenant.company.CompanyService companies;
    private final FieldCipher cipher;
    private final SysParams params;
    private final OutboxWriter outbox;
    private final AuditLogger audit;
    private final ObjectMapper json;
    private final org.springframework.transaction.support.TransactionTemplate tx;
    private final Clock clock;
    private final org.springframework.jdbc.core.JdbcTemplate jdbc;

    public BrokerService(BrokerCaseMapper cases, BrokerRecommendationMapper recommendations, AiReportMapper reports,
                         LifecycleService lifecycle, MatchService matching, QuizService quiz, JobMapper jobs,
                         com.shitu.tenant.company.CompanyService companies,
                         FieldCipher cipher, SysParams params, OutboxWriter outbox, AuditLogger audit, ObjectMapper json,
                         org.springframework.transaction.support.TransactionTemplate tx,
                         org.springframework.jdbc.core.JdbcTemplate jdbc,
                         Clock clock) {
        this.jdbc = jdbc;
        this.cases = cases;
        this.recommendations = recommendations;
        this.reports = reports;
        this.lifecycle = lifecycle;
        this.matching = matching;
        this.quiz = quiz;
        this.jobs = jobs;
        this.companies = companies;
        this.cipher = cipher;
        this.params = params;
        this.outbox = outbox;
        this.audit = audit;
        this.json = json;
        this.tx = tx;
        this.clock = clock;
    }

    // ================================================================== 入池

    /** 开工单（幂等：已有未结工单直接返回）。以 SYSTEM 模式写，调用方保证 companyId 为用户当前归属。 */
    @Transactional
    public long open(String userId, String companyId, String trigger, String matchSessionId, String fromMemberId) {
        return TenantContext.runAsSystem(() -> {
            BrokerCase exist = cases.selectOne(new LambdaQueryWrapper<BrokerCase>().eq(BrokerCase::getUserId, userId)
                    .eq(BrokerCase::getCompanyId, companyId).in(BrokerCase::getStatus, BrokerCase.OPEN_STATES).last("LIMIT 1"));
            if (exist != null) {
                return exist.getId();
            }
            LocalDateTime now = LocalDateTime.now(clock);
            BrokerCase c = new BrokerCase();
            c.setUserId(userId);
            c.setCompanyId(companyId);
            c.setTriggerType(trigger);
            c.setMatchSessionId(matchSessionId);
            c.setFromMemberId(fromMemberId);
            c.setStatus("OPEN");
            c.setContactDueAt(now.plus(Duration.parse(params.getString("broker.contact_sla", "PT2H"))));
            c.setResolveDueAt(now.plus(Duration.parse(params.getString("broker.resolve_sla", "PT24H"))));
            c.setCreatedAt(now);
            cases.insert(c);
            outbox.publish("BROKER_CASE_CREATED", "USER", userId, Map.of("userId", userId, "companyId", companyId,
                    "trigger", trigger, "caseId", c.getId()));
            return c.getId();
        });
    }

    /** M-09：驻场 / 项目经理一键流转（仅私域待匹配的本公司用户）。 */
    @Transactional
    public long transferFromSite(AuthPrincipal p, String userId) {
        BizException.check(p.hasAnyRole(ActorRole.SITE.name(), ActorRole.PM.name()), ErrorCode.LC_ACTOR_NOT_ALLOWED);
        SeekerUser u = lifecycle.find(userId).orElseThrow(() -> new BizException(ErrorCode.SYS_NOT_FOUND));
        BizException.check(p.companyId().equals(u.getBoundCompanyId()), ErrorCode.SYS_NOT_FOUND);
        BizException.check(u.getUserStatus() == UserStatus.PRIVATE_PENDING, ErrorCode.LC_ILLEGAL_TRANSITION,
                "只有私域待匹配的用户可以流转至经纪人（有进行中的报名请先取消）");
        long id = open(userId, p.companyId(), "SITE_TRANSFER", null, p.subjectId());
        audit.log("BROKER_TRANSFER", "USER", userId, Map.of("caseId", id));
        return id;
    }

    // ================================================================== 经纪人处理（TENANT 模式）

    public List<CaseRow> pool(AuthPrincipal p, String status) {
        List<BrokerCase> list = cases.selectList(new LambdaQueryWrapper<BrokerCase>()
                .in(status == null, BrokerCase::getStatus, BrokerCase.OPEN_STATES)
                .eq(status != null, BrokerCase::getStatus, status)
                .orderByAsc(BrokerCase::getResolveDueAt).last("LIMIT 200"));
        return list.stream().map(c -> row(c, p)).toList();
    }

    @Transactional
    public CaseRow contact(AuthPrincipal p, long caseId) {
        BrokerCase c = openCase(caseId);
        if (c.getContactedAt() == null) {
            cases.update(null, new LambdaUpdateWrapper<BrokerCase>().eq(BrokerCase::getId, caseId)
                    .set(BrokerCase::getContactedAt, LocalDateTime.now(clock)).set(BrokerCase::getBrokerId, p.subjectId())
                    .set("OPEN".equals(c.getStatus()), BrokerCase::getStatus, "CONTACTED"));
            audit.log("BROKER_CONTACT", "BROKER_CASE", String.valueOf(caseId), null);
        }
        return row(cases.selectById(caseId), p);
    }

    /** T-202：用户画像摘要 + 本公司全部招聘中岗位中最合适的 3 个（不受 80% 展示阈值限制）。 */
    @Transactional
    public Report generateReport(AuthPrincipal p, long caseId) {
        BrokerCase c = openCase(caseId);
        MatchProfile profile = latestProfile(c.getUserId());
        var cfg = quiz.activeEngine().config();
        var cands = TenantContext.runAsSystem(() -> matching.candidates(c.getCompanyId()));
        List<MatchScorer.Scored> top = MatchScorer.match(profile, cands.list(), cfg, false).results();
        boolean relaxed = false;
        if (top.isEmpty()) {
            // 按用户原条件一个都过不了硬过滤：放宽进厂意愿与地域锁定，给经纪人可以去沟通的备选（T-202 从本公司全部岗位中选）
            MatchProfile loose = new MatchProfile(MatchProfile.FactoryWillingness.YES, null, profile.jobType(),
                    profile.salaryMin(), profile.salaryMax(), profile.shift(), profile.dorm(), profile.workYears(),
                    profile.age(), profile.lng(), profile.lat());
            top = MatchScorer.match(loose, cands.list(), cfg, false).results();
            relaxed = !top.isEmpty();
        }
        List<Recommendation> recs = top.stream().map(s -> new Recommendation(s.job().jobId(), s.job().title(), s.matchScore(),
                s.reason())).toList();
        AiReport r = new AiReport();
        r.setCompanyId(c.getCompanyId());
        r.setBrokerCaseId(caseId);
        r.setSummary(ProfileSummary.of(profile, matchCount(c.getUserId()), c.getTriggerType())
                + (relaxed ? "。本公司没有完全符合进厂 / 地域要求的岗位，以下推荐已放宽这两项条件，需与用户沟通确认" : ""));
        r.setRecommendations(write(recs));
        r.setGenerator("TEMPLATE");
        r.setCreatedAt(LocalDateTime.now(clock));
        reports.insert(r);
        return report(r);
    }

    public Optional<Report> latestReport(long caseId) {
        openOrAny(caseId);
        return Optional.ofNullable(reports.selectOne(new LambdaQueryWrapper<AiReport>().eq(AiReport::getBrokerCaseId, caseId)
                .orderByDesc(AiReport::getId).last("LIMIT 1"))).map(this::report);
    }

    /** T-203：推荐岗位给用户（站内信 + 短信提醒用户打开 C 端确认）。 */
    @Transactional
    public CaseRow recommend(AuthPrincipal p, long caseId, String jobId, String note) {
        BizException.check(p.hasRole(ActorRole.BROKER.name()), ErrorCode.LC_ACTOR_NOT_ALLOWED, "二次推荐由人才经纪人操作");
        BrokerCase c = openCase(caseId);
        Job j = jobs.selectById(jobId);
        BizException.check(j != null && j.getJobStatus() == JobStatus.RECRUITING && j.getQuotaRemaining() > 0,
                ErrorCode.APP_QUOTA_FULL, "该岗位不在招聘中或名额已满");
        BrokerRecommendation r = new BrokerRecommendation();
        r.setCompanyId(c.getCompanyId());
        r.setBrokerCaseId(caseId);
        r.setJobId(jobId);
        r.setBrokerId(p.subjectId());
        r.setNote(note);
        r.setUserDecision("PENDING");
        r.setCreatedAt(LocalDateTime.now(clock));
        recommendations.insert(r);
        cases.update(null, new LambdaUpdateWrapper<BrokerCase>().eq(BrokerCase::getId, caseId)
                .set(BrokerCase::getStatus, "RECOMMENDED").set(BrokerCase::getBrokerId, p.subjectId())
                .set(c.getContactedAt() == null, BrokerCase::getContactedAt, LocalDateTime.now(clock)));
        outbox.publish("BROKER_RECOMMENDED", "USER", c.getUserId(), Map.of("userId", c.getUserId(), "jobTitle", j.getTitle()));
        audit.log("BROKER_RECOMMEND", "BROKER_CASE", String.valueOf(caseId), Map.of("jobId", jobId));
        return row(cases.selectById(caseId), p);
    }

    /** T-204：主动释放至公域（必填原因；bound 清空、source 保留；通知用户）。 */
    @Transactional
    public void release(AuthPrincipal p, long caseId, String reason) {
        BizException.check(reason != null && !reason.isBlank(), ErrorCode.LC_REASON_REQUIRED, "请选择或填写释放原因");
        BrokerCase c = openCase(caseId);
        ActorRole role = p.hasRole(ActorRole.BROKER.name()) ? ActorRole.BROKER
                : p.hasRole(ActorRole.SITE.name()) ? ActorRole.SITE : null;
        BizException.check(role != null, ErrorCode.LC_ACTOR_NOT_ALLOWED, "只有经纪人或驻场可以释放");
        lifecycle.transition(c.getUserId(), LifecycleEvent.RELEASE_MANUAL, TransitionContext.tenant(role, p.companyId()),
                p.subjectId(), reason.trim());
        close(caseId, "RELEASED");
        audit.log("USER_RELEASE", "BROKER_CASE", String.valueOf(caseId), Map.of("reason", reason.trim()));
    }

    // ================================================================== C 端

    public List<MyRecommendation> myRecommendations(String userId) {
        return TenantContext.runAsSystem(() -> {
            List<BrokerCase> my = cases.selectList(new LambdaQueryWrapper<BrokerCase>().eq(BrokerCase::getUserId, userId)
                    .in(BrokerCase::getStatus, BrokerCase.OPEN_STATES));
            if (my.isEmpty()) {
                return List.<MyRecommendation>of();
            }
            return recommendations.selectList(new LambdaQueryWrapper<BrokerRecommendation>()
                            .in(BrokerRecommendation::getBrokerCaseId, my.stream().map(BrokerCase::getId).toList())
                            .orderByDesc(BrokerRecommendation::getId))
                    .stream().map(r -> {
                        Job j = jobs.selectById(r.getJobId());
                        return new MyRecommendation(r.getId(), r.getJobId(), j == null ? null : j.getTitle(),
                                companies.namesOf(List.of(r.getCompanyId())).get(r.getCompanyId()), r.getNote(),
                                r.getUserDecision(), r.getCreatedAt());
                    }).toList();
        });
    }

    /** 用户对推荐的岗位是否有待确认 / 已接受的推荐（报名的第二个合法入口，T-203）。 */
    public Optional<Long> recommendedCase(String userId, String jobId) {
        return TenantContext.runAsSystem(() -> {
            List<BrokerCase> my = cases.selectList(new LambdaQueryWrapper<BrokerCase>().eq(BrokerCase::getUserId, userId)
                    .in(BrokerCase::getStatus, BrokerCase.OPEN_STATES));
            if (my.isEmpty()) {
                return Optional.<Long>empty();
            }
            BrokerRecommendation r = recommendations.selectOne(new LambdaQueryWrapper<BrokerRecommendation>()
                    .in(BrokerRecommendation::getBrokerCaseId, my.stream().map(BrokerCase::getId).toList())
                    .eq(BrokerRecommendation::getJobId, jobId).ne(BrokerRecommendation::getUserDecision, "DECLINED")
                    .orderByDesc(BrokerRecommendation::getId).last("LIMIT 1"));
            return Optional.ofNullable(r).map(BrokerRecommendation::getBrokerCaseId);
        });
    }

    @Transactional
    public void decide(String userId, long recommendationId, boolean accept) {
        TenantContext.runAsSystem(() -> {
            BrokerRecommendation r = recommendations.selectById(recommendationId);
            BrokerCase c = r == null ? null : cases.selectById(r.getBrokerCaseId());
            BizException.check(c != null && c.getUserId().equals(userId), ErrorCode.SYS_NOT_FOUND);
            recommendations.update(null, new LambdaUpdateWrapper<BrokerRecommendation>().eq(BrokerRecommendation::getId, recommendationId)
                    .set(BrokerRecommendation::getUserDecision, accept ? "ACCEPTED" : "DECLINED")
                    .set(BrokerRecommendation::getDecidedAt, LocalDateTime.now(clock)));
            return null;
        });
    }

    /** 报名成功后结束该用户的未结工单（来自匹配或经纪人推荐都算转化）。 */
    @Transactional
    public void closeAfterApply(String userId) {
        TenantContext.runAsSystem(() -> {
            cases.selectList(new LambdaQueryWrapper<BrokerCase>().eq(BrokerCase::getUserId, userId)
                    .in(BrokerCase::getStatus, BrokerCase.OPEN_STATES)).forEach(c -> close(c.getId(), "APPLIED"));
            return null;
        });
    }

    // ================================================================== SLA（D-10）

    /** @return [联系超时提醒数, 超时释放数] */
    public int[] enforceSla() {
        return TenantContext.runAsSystem(() -> {
            LocalDateTime now = LocalDateTime.now(clock);
            int reminded = 0;
            int released = 0;
            for (BrokerCase c : cases.selectList(new LambdaQueryWrapper<BrokerCase>().eq(BrokerCase::getStatus, "OPEN")
                    .isNull(BrokerCase::getContactedAt).le(BrokerCase::getContactDueAt, now).isNull(BrokerCase::getContactRemindedAt))) {
                tx.executeWithoutResult(s -> {
                    cases.update(null, new LambdaUpdateWrapper<BrokerCase>().eq(BrokerCase::getId, c.getId()).set(BrokerCase::getContactRemindedAt, now));
                    outbox.publish("BROKER_CONTACT_OVERDUE", "BROKER_CASE", String.valueOf(c.getId()),
                            Map.of("userId", c.getUserId(), "companyId", c.getCompanyId()));
                });
                reminded++;
            }
            for (BrokerCase c : cases.selectList(new LambdaQueryWrapper<BrokerCase>().in(BrokerCase::getStatus, BrokerCase.OPEN_STATES)
                    .le(BrokerCase::getResolveDueAt, now))) {
                SeekerUser u = lifecycle.find(c.getUserId()).orElse(null);
                if (u != null && u.getUserStatus() == UserStatus.PRIVATE_PENDING && c.getCompanyId().equals(u.getBoundCompanyId())) {
                    try {
                        tx.executeWithoutResult(s -> {
                            lifecycle.transition(c.getUserId(), LifecycleEvent.BROKER_SLA_TIMEOUT, TransitionContext.of(ActorRole.SYSTEM),
                                    null, "经纪人 24 小时内未出结果，自动释放");
                            close(c.getId(), "RELEASED");
                        });
                        released++;
                        continue;
                    } catch (BizException e) {
                        // 并发下状态已变化
                    }
                }
                close(c.getId(), "CLOSED");
            }
            return new int[]{reminded, released};
        });
    }

    // ------------------------------------------------------------------

    private void close(long caseId, String status) {
        cases.update(null, new LambdaUpdateWrapper<BrokerCase>().eq(BrokerCase::getId, caseId)
                .in(BrokerCase::getStatus, BrokerCase.OPEN_STATES)
                .set(BrokerCase::getStatus, status).set(BrokerCase::getClosedAt, LocalDateTime.now(clock)));
    }

    private BrokerCase openCase(long caseId) {
        BrokerCase c = openOrAny(caseId);
        BizException.check(BrokerCase.OPEN_STATES.contains(c.getStatus()), ErrorCode.LC_ILLEGAL_TRANSITION, "工单已结束");
        return c;
    }

    /** TENANT 模式下 selectById 自动限定本公司，跨公司返回 404。 */
    private BrokerCase openOrAny(long caseId) {
        BrokerCase c = cases.selectById(caseId);
        BizException.check(c != null, ErrorCode.SYS_NOT_FOUND);
        return c;
    }

    private MatchProfile latestProfile(String userId) {
        return matching.latest(userId)
                .map(o -> matching.profileOf(matching.snapshot(o.sessionId()).session()))
                .orElse(new MatchProfile(MatchProfile.FactoryWillingness.YES, null, null, null, null, null, null, 0, null, null, null));
    }

    private int matchCount(String userId) {
        return lifecycle.find(userId).map(SeekerUser::getMatchCycleCount).orElse(0);
    }

    private CaseRow row(BrokerCase c, AuthPrincipal p) {
        SeekerUser u = lifecycle.find(c.getUserId()).orElse(null);
        String name = u == null || u.getRealNameEnc() == null ? "未实名" : Masks.name(cipher.decrypt(u.getRealNameEnc()));
        String phone = u == null ? null : Masks.phone(cipher.decrypt(u.getPhoneEnc()));
        boolean broker = p.hasRole(ActorRole.BROKER.name());
        boolean site = p.hasRole(ActorRole.SITE.name());
        List<String> actions = !BrokerCase.OPEN_STATES.contains(c.getStatus()) ? List.of()
                : broker ? List.of("CONTACT", "REPORT", "RECOMMEND", "RELEASE")
                : site ? List.of("RELEASE") : List.of();
        return new CaseRow(c.getId(), c.getUserId(), name, phone, c.getTriggerType(), c.getStatus(), c.getFromMemberId(),
                c.getContactDueAt(), c.getResolveDueAt(), c.getContactedAt(), c.getCreatedAt(), matchCount(c.getUserId()),
                ProfileSummary.of(latestProfile(c.getUserId()), matchCount(c.getUserId()), c.getTriggerType()), actions,
                memberName(c.getFromMemberId()), memberName(c.getBrokerId()));
    }

    private String memberName(String memberId) {
        if (memberId == null) {
            return null;
        }
        List<String> n = jdbc.queryForList("SELECT name FROM member WHERE member_id = ?", String.class, memberId);
        return n.isEmpty() ? null : n.get(0);
    }

    /** 流转池各状态数量（本公司）。 */
    public java.util.Map<String, Long> counts(AuthPrincipal p) {
        java.util.Map<String, Long> m = new java.util.LinkedHashMap<>();
        jdbc.query("SELECT status, COUNT(*) FROM broker_case WHERE company_id = ? GROUP BY status",
                rs -> { m.put(rs.getString(1), rs.getLong(2)); }, p.companyId());
        return m;
    }

    private Report report(AiReport r) {
        try {
            List<Recommendation> recs = json.readValue(r.getRecommendations(),
                    json.getTypeFactory().constructCollectionType(List.class, Recommendation.class));
            return new Report(r.getId(), r.getBrokerCaseId(), r.getSummary(), recs, r.getGenerator(), r.getCreatedAt());
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private String write(Object o) {
        try {
            return json.writeValueAsString(o);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }
}
