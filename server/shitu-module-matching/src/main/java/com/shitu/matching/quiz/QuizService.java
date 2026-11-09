package com.shitu.matching.quiz;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.matching.domain.EngineConfig;
import com.shitu.matching.domain.ProfileBuilder;
import com.shitu.matching.mapper.EngineConfigRowMapper;
import com.shitu.matching.mapper.QuizQuestionMapper;
import com.shitu.matching.mapper.QuizVersionMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 题库（P-12）与引擎参数版本。C 端只读当前生效版本；平台中台：复制生效版本为草稿 → 编辑 → 发布（原生效版本归档），
 * 也可以把归档版本重新发布（回滚）。题库内容只影响答题界面和画像字段映射，不需要发版。
 */
@Service
public class QuizService {

    /** 画像只识别这些字段（ProfileBuilder）；题目必须覆盖进厂意愿和地域两道硬过滤题。 */
    static final Set<String> KNOWN_FIELDS = Set.of("accept_factory", "locked_region", "expect_job_type",
            "expect_salary", "shift_pref", "dorm_req", "work_years");

    public record QuestionView(int seq, String questionType, String stem, String hint, String profileField,
                               String matchRole, List<ProfileBuilder.OptionDef> options) {
        static QuestionView of(QuizQuestion q) {
            return new QuestionView(q.getSeq(), q.getQuestionType(), q.getStem(), q.getHint(), q.getProfileField(),
                    q.getMatchRole(), q.getOptions());
        }
    }

    public record QuizView(int versionId, String name, String status, LocalDateTime publishedAt, List<QuestionView> questions) {
    }

    public record ActiveEngine(int versionId, EngineConfig config) {
    }

    private final QuizVersionMapper versions;
    private final QuizQuestionMapper questions;
    private final EngineConfigRowMapper engines;
    private final ObjectMapper json;
    private final AuditLogger audit;
    private final Clock clock;

    public QuizService(QuizVersionMapper versions, QuizQuestionMapper questions, EngineConfigRowMapper engines,
                       ObjectMapper json, AuditLogger audit, Clock clock) {
        this.versions = versions;
        this.questions = questions;
        this.engines = engines;
        this.json = json;
        this.audit = audit;
        this.clock = clock;
    }

    /** 当前生效题库（C-302）。 */
    public QuizView active() {
        QuizVersion v = TenantContext.runAsSystem(() -> versions.selectOne(new LambdaQueryWrapper<QuizVersion>()
                .eq(QuizVersion::getStatus, "ACTIVE")));
        BizException.check(v != null, ErrorCode.SYS_INTERNAL, "题库未配置");
        return view(v);
    }

    public List<QuizQuestion> questionsOf(int versionId) {
        return TenantContext.runAsSystem(() -> questions.selectList(new LambdaQueryWrapper<QuizQuestion>()
                .eq(QuizQuestion::getVersionId, versionId).orderByAsc(QuizQuestion::getSeq)));
    }

    public ActiveEngine activeEngine() {
        EngineConfigRow r = TenantContext.runAsSystem(() -> engines.selectOne(new LambdaQueryWrapper<EngineConfigRow>()
                .eq(EngineConfigRow::getStatus, "ACTIVE")));
        BizException.check(r != null, ErrorCode.SYS_INTERNAL, "匹配引擎参数未配置");
        return new ActiveEngine(r.getVersionId(), parse(r.getConfig()));
    }

    public EngineConfig engine(int versionId) {
        EngineConfigRow r = TenantContext.runAsSystem(() -> engines.selectById(versionId));
        BizException.check(r != null, ErrorCode.SYS_NOT_FOUND);
        return parse(r.getConfig());
    }

    private EngineConfig parse(String config) {
        try {
            return json.readValue(config, EngineConfig.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("engine_config 解析失败", e);
        }
    }

    // ------------------------------------------------------------------ 平台中台 P-12

    public List<QuizView> list() {
        return versions.selectList(new LambdaQueryWrapper<QuizVersion>().orderByDesc(QuizVersion::getVersionId))
                .stream().map(this::view).toList();
    }

    public QuizView get(int versionId) {
        QuizVersion v = versions.selectById(versionId);
        BizException.check(v != null, ErrorCode.SYS_NOT_FOUND);
        return view(v);
    }

    /** 以当前生效版本为底复制出一个草稿（已有草稿时直接返回该草稿）。 */
    @Transactional
    public QuizView createDraft(String name) {
        QuizVersion draft = versions.selectOne(new LambdaQueryWrapper<QuizVersion>().eq(QuizVersion::getStatus, "DRAFT"));
        if (draft != null) {
            return view(draft);
        }
        QuizView base = active();
        QuizVersion max = versions.selectOne(new LambdaQueryWrapper<QuizVersion>().orderByDesc(QuizVersion::getVersionId).last("LIMIT 1"));
        QuizVersion v = new QuizVersion();
        v.setVersionId(max.getVersionId() + 1);
        v.setName(name == null || name.isBlank() ? "v" + v.getVersionId() + " 草稿" : name.trim());
        v.setStatus("DRAFT");
        v.setCreatedAt(LocalDateTime.now(clock));
        versions.insert(v);
        for (QuestionView q : base.questions()) {
            insertQuestion(v.getVersionId(), q);
        }
        audit.log("QUIZ_DRAFT_CREATE", "QUIZ_VERSION", String.valueOf(v.getVersionId()), Map.of("base", base.versionId()));
        return view(v);
    }

    /** 整体替换草稿的题目（≤ 7 题，硬过滤题前置）。 */
    @Transactional
    public QuizView saveDraft(int versionId, String name, List<QuestionView> qs) {
        QuizVersion v = versions.selectById(versionId);
        BizException.check(v != null, ErrorCode.SYS_NOT_FOUND);
        BizException.check("DRAFT".equals(v.getStatus()), ErrorCode.SYS_BAD_REQUEST, "只能编辑草稿版本");
        validate(qs);
        if (name != null && !name.isBlank()) {
            v.setName(name.trim());
            versions.updateById(v);
        }
        questions.delete(new LambdaQueryWrapper<QuizQuestion>().eq(QuizQuestion::getVersionId, versionId));
        int seq = 1;
        for (QuestionView q : qs) {
            insertQuestion(versionId, new QuestionView(seq++, q.questionType(), q.stem(), q.hint(), q.profileField(),
                    q.matchRole(), q.options()));
        }
        audit.log("QUIZ_DRAFT_SAVE", "QUIZ_VERSION", String.valueOf(versionId), null);
        return get(versionId);
    }

    /** 发布草稿或回滚到归档版本：原生效版本归档。 */
    @Transactional
    public QuizView publish(int versionId, String operatorId) {
        QuizVersion v = versions.selectById(versionId);
        BizException.check(v != null, ErrorCode.SYS_NOT_FOUND);
        BizException.check(!"ACTIVE".equals(v.getStatus()), ErrorCode.SYS_BAD_REQUEST, "该版本已是生效版本");
        validate(questionsOf(versionId).stream().map(QuestionView::of).toList());
        versions.update(null, new LambdaUpdateWrapper<QuizVersion>()
                .eq(QuizVersion::getStatus, "ACTIVE").set(QuizVersion::getStatus, "ARCHIVED"));
        versions.update(null, new LambdaUpdateWrapper<QuizVersion>()
                .eq(QuizVersion::getVersionId, versionId)
                .set(QuizVersion::getStatus, "ACTIVE")
                .set(QuizVersion::getPublishedBy, operatorId)
                .set(QuizVersion::getPublishedAt, LocalDateTime.now(clock)));
        audit.log("QUIZ_PUBLISH", "QUIZ_VERSION", String.valueOf(versionId), Map.of("from", v.getStatus()));
        return get(versionId);
    }

    static void validate(List<QuestionView> qs) {
        BizException.check(qs != null && !qs.isEmpty() && qs.size() <= 7, ErrorCode.SYS_BAD_REQUEST, "题目为 1–7 道");
        Set<String> fields = new HashSet<>();
        boolean softSeen = false;
        for (QuestionView q : qs) {
            BizException.check(q.stem() != null && !q.stem().isBlank() && q.stem().length() <= 100,
                    ErrorCode.SYS_BAD_REQUEST, "题干不能为空且不超过 100 字");
            BizException.check(KNOWN_FIELDS.contains(q.profileField()), ErrorCode.SYS_BAD_REQUEST,
                    "未知的画像字段：" + q.profileField());
            BizException.check(fields.add(q.profileField()), ErrorCode.SYS_BAD_REQUEST, "画像字段重复：" + q.profileField());
            BizException.check(q.options() != null && q.options().size() >= 2 && q.options().size() <= 8,
                    ErrorCode.SYS_BAD_REQUEST, "每题 2–8 个选项");
            Set<String> codes = new HashSet<>();
            q.options().forEach(o -> BizException.check(o.code() != null && codes.add(o.code()) && o.label() != null,
                    ErrorCode.SYS_BAD_REQUEST, "选项编码重复或缺少文字"));
            Set<String> labels = new HashSet<>();
            for (ProfileBuilder.OptionDef o : q.options()) {
                BizException.check(labels.add(o.label().trim()), ErrorCode.SYS_BAD_REQUEST, "选项文字重复：" + o.label());
                String err = ProfileBuilder.checkOption(q.profileField(), o);
                BizException.check(err == null, ErrorCode.SYS_BAD_REQUEST, "第 " + q.seq() + " 题：" + err);
            }
            boolean hard = "HARD_FILTER".equals(q.matchRole());
            BizException.check(hard || "SOFT_WEIGHT".equals(q.matchRole()), ErrorCode.SYS_BAD_REQUEST, "题目作用不正确");
            BizException.check(!(hard && softSeen), ErrorCode.SYS_BAD_REQUEST, "硬过滤题必须排在前面");
            softSeen |= !hard;
        }
        BizException.check(fields.contains("accept_factory") && fields.contains("locked_region"),
                ErrorCode.SYS_BAD_REQUEST, "必须包含「进厂意愿」与「地域锁定」两道硬过滤题");
    }

    private void insertQuestion(int versionId, QuestionView q) {
        QuizQuestion e = new QuizQuestion();
        e.setVersionId(versionId);
        e.setSeq(q.seq());
        e.setQuestionType(q.questionType() == null ? "CHOICE" : q.questionType());
        e.setStem(q.stem().trim());
        e.setHint(q.hint());
        e.setProfileField(q.profileField());
        e.setMatchRole(q.matchRole());
        e.setOptions(q.options());
        questions.insert(e);
    }

    private QuizView view(QuizVersion v) {
        return new QuizView(v.getVersionId(), v.getName(), v.getStatus(), v.getPublishedAt(),
                questionsOf(v.getVersionId()).stream().map(QuestionView::of).toList());
    }
}
