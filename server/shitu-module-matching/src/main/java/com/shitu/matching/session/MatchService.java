package com.shitu.matching.session;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.shitu.common.enums.CompanyStatus;
import com.shitu.common.enums.JobStatus;
import com.shitu.common.enums.MatchScope;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.id.BizIdGenerator;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.job.Job;
import com.shitu.job.mapper.JobMapper;
import com.shitu.matching.domain.EngineConfig;
import com.shitu.matching.domain.JobCandidate;
import com.shitu.matching.domain.MatchProfile;
import com.shitu.matching.domain.MatchScorer;
import com.shitu.matching.domain.ProfileBuilder;
import com.shitu.matching.mapper.MatchResultMapper;
import com.shitu.matching.mapper.MatchSessionMapper;
import com.shitu.matching.quiz.QuizQuestion;
import com.shitu.matching.quiz.QuizService;
import com.shitu.tenant.company.Company;
import com.shitu.tenant.mapper.CompanyMapper;
import com.shitu.tenant.mapper.ProjectMapper;
import com.shitu.tenant.project.Project;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * AI 问薪（C-301~C-306）：答案 → 画像 → 范围内候选岗位 → 打分排序 → 落快照。
 * 「能不能开始匹配」「匹配次数」由生命周期模块判断与记录，这里只负责匹配本身。
 * <p>岗位只出现在匹配结果中（R-01）：岗位详情与报名都要求岗位在用户<b>最近一次</b>匹配的展示结果里。
 */
@Service
public class MatchService {

    private static final Set<CompanyStatus> MATCHABLE = EnumSet.of(CompanyStatus.NORMAL, CompanyStatus.THROTTLED);

    /** 结果卡片（C-304）：不含平台权重（R-14）。 */
    public record ResultCard(int rank, String jobId, String title, String companyName, String city, String address,
                             BigDecimal matchScore, BigDecimal salaryMin, BigDecimal salaryMax, String shiftType,
                             boolean dormProvided, Integer dormRoomSize, Boolean dormAircon, boolean mealProvided,
                             int quotaRemaining, String reason) {
    }

    public record MatchOutcome(String sessionId, MatchScope scope, boolean matched, List<ResultCard> results,
                               int engineVersion, int quizVersion) {
    }

    private final QuizService quiz;
    private final MatchSessionMapper sessions;
    private final MatchResultMapper results;
    private final JobMapper jobs;
    private final ProjectMapper projects;
    private final CompanyMapper companies;
    private final BizIdGenerator ids;
    private final ObjectMapper json;
    private final Clock clock;

    public MatchService(QuizService quiz, MatchSessionMapper sessions, MatchResultMapper results, JobMapper jobs,
                        ProjectMapper projects, CompanyMapper companies, BizIdGenerator ids, ObjectMapper json, Clock clock) {
        this.quiz = quiz;
        this.sessions = sessions;
        this.results = results;
        this.jobs = jobs;
        this.projects = projects;
        this.companies = companies;
        this.ids = ids;
        this.json = json;
        this.clock = clock;
    }

    /**
     * @param scope          OWN_COMPANY（私域，仅本公司岗位）或 ALL_PLATFORM（公域）
     * @param scopeCompanyId 私域时为当前归属公司
     * @param age            已实名的年龄，未实名为 null
     */
    @Transactional
    public MatchOutcome match(String userId, MatchScope scope, String scopeCompanyId, List<ProfileBuilder.Answer> answers,
                              Integer age, BigDecimal lng, BigDecimal lat) {
        BizException.check(scope == MatchScope.OWN_COMPANY || scope == MatchScope.ALL_PLATFORM, ErrorCode.LC_MATCH_LOCKED);
        return TenantContext.runAsSystem(() -> {
            QuizService.QuizView q = quiz.active();
            QuizService.ActiveEngine engine = quiz.activeEngine();
            List<ProfileBuilder.QuestionDef> defs = quiz.questionsOf(q.versionId()).stream().map(QuizQuestion::toDef).toList();
            MatchProfile profile;
            try {
                profile = ProfileBuilder.build(defs, answers, age, lng, lat);
            } catch (ProfileBuilder.InvalidAnswerException e) {
                throw new BizException(ErrorCode.SYS_BAD_REQUEST, e.getMessage());
            }
            Candidates c = candidates(scope == MatchScope.OWN_COMPANY ? scopeCompanyId : null);
            MatchScorer.Outcome outcome = MatchScorer.match(profile, c.list(), engine.config(), scope == MatchScope.ALL_PLATFORM);

            LocalDateTime now = LocalDateTime.now(clock);
            MatchSession s = new MatchSession();
            s.setSessionId(ids.dated("MS", 5));
            s.setUserId(userId);
            s.setQuizVersionId(q.versionId());
            s.setEngineVersionId(engine.versionId());
            s.setScope(scope.name());
            s.setScopeCompanyId(scope == MatchScope.OWN_COMPANY ? scopeCompanyId : null);
            s.setAnswers(write(answers));
            s.setProfile(write(profile));
            s.setStatus(outcome.anyDisplayed() ? "MATCHED" : "NO_MATCH");
            s.setStartedAt(now);
            s.setFinishedAt(now);
            sessions.insert(s);
            int rank = 1;
            for (MatchScorer.Scored r : outcome.results()) {
                MatchResult mr = new MatchResult();
                mr.setSessionId(s.getSessionId());
                mr.setRankNo(rank++);
                mr.setJobId(r.job().jobId());
                mr.setMatchScore(r.matchScore());
                mr.setJobWeight(r.job().jobWeight());
                mr.setSortScore(r.sortScore());
                mr.setFactorScores(write(r.factors()));
                mr.setReasonText(r.reason());
                mr.setDisplayed(r.displayed());
                results.insert(mr);
            }
            return new MatchOutcome(s.getSessionId(), scope, outcome.anyDisplayed(),
                    cards(outcome.displayed(), c), engine.versionId(), q.versionId());
        });
    }

    /** 最近一次匹配（结果页刷新、返回时恢复）。 */
    public Optional<MatchOutcome> latest(String userId) {
        return TenantContext.runAsSystem(() -> {
            MatchSession s = latestSession(userId);
            if (s == null) {
                return Optional.<MatchOutcome>empty();
            }
            List<MatchResult> rs = displayedResults(s.getSessionId());
            List<String> jobIds = rs.stream().map(MatchResult::getJobId).toList();
            Map<String, Job> byId = jobIds.isEmpty() ? Map.of()
                    : jobs.selectBatchIds(jobIds).stream().collect(Collectors.toMap(Job::getJobId, Function.identity()));
            Map<String, Project> pr = projectsOf(byId.values());
            Map<String, String> cn = companyNames(byId.values().stream().map(Job::getCompanyId).collect(Collectors.toSet()));
            List<ResultCard> cards = rs.stream().filter(r -> byId.containsKey(r.getJobId()))
                    .map(r -> card(r.getRankNo(), byId.get(r.getJobId()), pr, cn, r.getMatchScore(), r.getReasonText()))
                    .toList();
            return Optional.of(new MatchOutcome(s.getSessionId(), MatchScope.valueOf(s.getScope()),
                    "MATCHED".equals(s.getStatus()), cards, s.getEngineVersionId(), s.getQuizVersionId()));
        });
    }

    /**
     * 岗位是否在用户最近一次匹配的展示结果里（R-01：详情与报名的唯一入口）。
     *
     * @return 匹配会话 ID
     */
    public Optional<String> latestSessionContaining(String userId, String jobId) {
        return TenantContext.runAsSystem(() -> {
            MatchSession s = latestSession(userId);
            if (s == null) {
                return Optional.<String>empty();
            }
            boolean in = displayedResults(s.getSessionId()).stream().anyMatch(r -> r.getJobId().equals(jobId));
            return in ? Optional.of(s.getSessionId()) : Optional.<String>empty();
        });
    }

    /** 会话快照（回放 / 解释）：答案、画像、所用版本、各岗位因子得分。 */
    public record Snapshot(MatchSession session, List<MatchResult> results) {
    }

    public Snapshot snapshot(String sessionId) {
        return TenantContext.runAsSystem(() -> {
            MatchSession s = sessions.selectById(sessionId);
            BizException.check(s != null, ErrorCode.SYS_NOT_FOUND);
            return new Snapshot(s, results.selectList(new LambdaQueryWrapper<MatchResult>()
                    .eq(MatchResult::getSessionId, sessionId).orderByAsc(MatchResult::getRankNo)));
        });
    }

    public MatchProfile profileOf(MatchSession s) {
        try {
            return json.readValue(s.getProfile(), MatchProfile.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    public List<ProfileBuilder.Answer> answersOf(MatchSession s) {
        try {
            return json.readValue(s.getAnswers(), new TypeReference<>() {
            });
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    // ------------------------------------------------------------------ 候选岗位

    /** 候选岗位 + 其项目 / 公司信息。 */
    public record Candidates(List<JobCandidate> list, Map<String, Job> jobs, Map<String, Project> projects,
                             Map<String, String> companyNames) {
    }

    /** @param companyId 私域时限定本公司；null = 全平台 */
    public Candidates candidates(String companyId) {
        List<Job> list = jobs.selectList(new LambdaQueryWrapper<Job>()
                .eq(Job::getJobStatus, JobStatus.RECRUITING)
                .gt(Job::getQuotaRemaining, 0)
                .eq(companyId != null, Job::getCompanyId, companyId));
        Map<String, Project> pr = projectsOf(list);
        Set<String> companyIds = list.stream().map(Job::getCompanyId).collect(Collectors.toSet());
        Map<String, Company> co = companyIds.isEmpty() ? Map.of()
                : companies.selectBatchIds(companyIds).stream().collect(Collectors.toMap(Company::getCompanyId, Function.identity()));
        Map<String, String> names = new HashMap<>();
        co.values().forEach(c -> names.put(c.getCompanyId(), display(c)));
        List<JobCandidate> cands = list.stream().map(j -> {
            Project p = pr.get(j.getProjectId());
            Company c = co.get(j.getCompanyId());
            boolean blocked = c == null || !MATCHABLE.contains(c.getCompanyStatus()) || Boolean.TRUE.equals(c.getFeeRightsRevoked());
            return new JobCandidate(j.getJobId(), j.getCompanyId(), j.getTitle(), p == null ? null : p.getCity(),
                    p == null ? null : p.getLng(), p == null ? null : p.getLat(), j.getJobType(),
                    Boolean.TRUE.equals(j.getFactoryJob()), j.getSalaryMin(), j.getSalaryMax(), j.getShiftType(),
                    Boolean.TRUE.equals(j.getDormProvided()), j.getDormRoomSize(), j.getDormAircon(),
                    Boolean.TRUE.equals(j.getMealProvided()), j.getMinWorkYears(), j.getAgeMin(), j.getAgeMax(),
                    j.getQuotaRemaining(), j.getJobStatus() == JobStatus.RECRUITING, blocked,
                    j.getMatchWeight() == null ? BigDecimal.ONE : j.getMatchWeight());
        }).toList();
        return new Candidates(cands, list.stream().collect(Collectors.toMap(Job::getJobId, Function.identity())), pr, names);
    }

    // ------------------------------------------------------------------

    private MatchSession latestSession(String userId) {
        return sessions.selectOne(new LambdaQueryWrapper<MatchSession>().eq(MatchSession::getUserId, userId)
                .orderByDesc(MatchSession::getStartedAt).orderByDesc(MatchSession::getSessionId).last("LIMIT 1"));
    }

    private List<MatchResult> displayedResults(String sessionId) {
        return results.selectList(new LambdaQueryWrapper<MatchResult>()
                .eq(MatchResult::getSessionId, sessionId).eq(MatchResult::getDisplayed, true)
                .orderByAsc(MatchResult::getRankNo));
    }

    private Map<String, Project> projectsOf(java.util.Collection<Job> list) {
        Set<String> pids = list.stream().map(Job::getProjectId).collect(Collectors.toSet());
        return pids.isEmpty() ? Map.of()
                : projects.selectBatchIds(pids).stream().collect(Collectors.toMap(Project::getProjectId, Function.identity()));
    }

    private Map<String, String> companyNames(Set<String> ids) {
        Map<String, String> m = new HashMap<>();
        if (!ids.isEmpty()) {
            companies.selectBatchIds(ids).forEach(c -> m.put(c.getCompanyId(), display(c)));
        }
        return m;
    }

    private static String display(Company c) {
        return c.getShortName() != null && !c.getShortName().isBlank() ? c.getShortName() : c.getName();
    }

    private List<ResultCard> cards(List<MatchScorer.Scored> displayed, Candidates c) {
        List<ResultCard> out = new java.util.ArrayList<>();
        int rank = 1;
        for (MatchScorer.Scored s : displayed) {
            out.add(card(rank++, c.jobs().get(s.job().jobId()), c.projects(), c.companyNames(), s.matchScore(), s.reason()));
        }
        return out;
    }

    private static ResultCard card(int rank, Job j, Map<String, Project> pr, Map<String, String> cn, BigDecimal score,
                                   String reason) {
        Project p = pr.get(j.getProjectId());
        return new ResultCard(rank, j.getJobId(), j.getTitle(), cn.get(j.getCompanyId()), p == null ? null : p.getCity(),
                p == null ? null : p.getAddress(), score, j.getSalaryMin(), j.getSalaryMax(), j.getShiftType().name(),
                Boolean.TRUE.equals(j.getDormProvided()), j.getDormRoomSize(), j.getDormAircon(),
                Boolean.TRUE.equals(j.getMealProvided()), j.getQuotaRemaining(), reason);
    }

    private String write(Object o) {
        try {
            return json.writeValueAsString(o);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }
}
