package com.shitu.matching.domain;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.shitu.common.enums.JobType;
import com.shitu.common.enums.ShiftType;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 答案 → 画像（C-302 / C-303）。题目来自题库当前生效版本，按 {@code profile_field} 识别含义，
 * 平台调整题目文案、选项文字、顺序都不影响画像生成；新增未知字段的题目会被忽略（只记录在答案里）。
 * <p>题型（D-62 问卷改版）：
 * <ul>
 *   <li>JUDGE / CHOICE：单选，答案为选项编码；</li>
 *   <li>NUMBER：数字输入（年龄），范围 {@link QuestionConfig#min()}–{@link QuestionConfig#max()}；</li>
 *   <li>MATRIX：每行一个班次（选项的 value 为 {@link ShiftType}），固定三列 接受 / 不接受 / 看情况，
 *       选「看情况」可以补一句「什么情况下可以」（可不填，≤ 50 字，只记录给顾问看，不参与打分）。</li>
 * </ul>
 */
public final class ProfileBuilder {

    public static final String JUDGE = "JUDGE";
    public static final String CHOICE = "CHOICE";
    public static final String NUMBER = "NUMBER";
    public static final String MATRIX = "MATRIX";
    public static final Set<String> TYPES = Set.of(JUDGE, CHOICE, NUMBER, MATRIX);

    /** 矩阵题固定三列：接受 / 不接受 / 看情况。 */
    public static final List<String> MATRIX_COLUMNS = List.of("ACCEPT", "REJECT", "DEPENDS");
    public static final int NOTE_MAX = 50;
    /** 年龄题的取值范围（D-15 未满 16 岁不能注册）。 */
    public static final int AGE_MIN = 16;
    public static final int AGE_MAX = 65;

    /** 选项定义（与 quiz_question.options JSON 一致）。value 可为字符串或数字；薪资题用 min / max；矩阵题每个选项是一行。 */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record OptionDef(String code, String label, String sub, String value, BigDecimal min, BigDecimal max,
                            Boolean needRegion) {
    }

    /**
     * 题型参数（quiz_question.config JSON；单选题为 null）。
     *
     * @param min      数字题下限
     * @param max      数字题上限
     * @param unit     数字题单位（如「岁」）
     * @param followUp 矩阵题选「看情况」时的中性追问（如「什么情况下可以？」），null = 不追问
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record QuestionConfig(Integer min, Integer max, String unit, String followUp) {
    }

    public record QuestionDef(int seq, String questionType, String profileField, String matchRole, List<OptionDef> options,
                              QuestionConfig config) {
        /** 单选题（题库 v1 的写法）。 */
        public QuestionDef(int seq, String profileField, String matchRole, List<OptionDef> options) {
            this(seq, CHOICE, profileField, matchRole, options, null);
        }

        String type() {
            return questionType == null ? CHOICE : questionType;
        }
    }

    /**
     * 用户对某题的回答。单选题：选项编码（地域锁定题选「是」时附带城市）；数字题：number；
     * 矩阵题：matrix（行编码 → ACCEPT / REJECT / DEPENDS）与可选的 notes（行编码 → 补充说明）。
     * 旧会话（题库 v1）的答案只有 seq / code / region，照样能读出来。
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Answer(int seq, String code, String region, Integer number, Map<String, String> matrix,
                         Map<String, String> notes) {
        @JsonCreator
        public Answer {
        }

        public Answer(int seq, String code, String region) {
            this(seq, code, region, null, null, null);
        }

        public static Answer number(int seq, int n) {
            return new Answer(seq, null, null, n, null, null);
        }

        public static Answer matrix(int seq, Map<String, String> matrix, Map<String, String> notes) {
            return new Answer(seq, null, null, null, matrix, notes);
        }
    }

    public static final class InvalidAnswerException extends RuntimeException {
        public InvalidAnswerException(String message) {
            super(message);
        }
    }

    private ProfileBuilder() {
    }

    /**
     * @param age 已实名时的年龄（实名年龄优先于自报年龄），否则为 null
     * @throws InvalidAnswerException 漏答、选项不存在、地域锁定未选城市、数字超范围、矩阵有行没选、补充说明超长
     */
    public static MatchProfile build(List<QuestionDef> questions, List<Answer> answers, Integer age,
                                     BigDecimal lng, BigDecimal lat) {
        Map<Integer, Answer> bySeq = new HashMap<>();
        for (Answer a : answers) {
            if (a != null) {
                bySeq.put(a.seq(), a);
            }
        }
        Map<String, OptionDef> chosen = new HashMap<>();
        Map<String, Answer> answerByField = new HashMap<>();
        Integer answeredAge = null;
        Map<ShiftType, MatchProfile.ShiftTolerance> tolerance = null;
        Map<ShiftType, String> shiftNotes = null;
        List<Integer> missing = new ArrayList<>();
        for (QuestionDef q : questions) {
            Answer a = bySeq.get(q.seq());
            if (a == null || unanswered(q, a)) {
                missing.add(q.seq());
                continue;
            }
            switch (q.type()) {
                case NUMBER -> {
                    int min = q.config() != null && q.config().min() != null ? q.config().min() : AGE_MIN;
                    int max = q.config() != null && q.config().max() != null ? q.config().max() : AGE_MAX;
                    if (a.number() < min || a.number() > max) {
                        String unit = q.config() != null && q.config().unit() != null ? q.config().unit() : "";
                        throw new InvalidAnswerException("第 " + q.seq() + " 题请填 " + min + "–" + max + " " + unit + "之间的数");
                    }
                    if ("age".equals(q.profileField())) {
                        answeredAge = a.number();
                    }
                }
                case MATRIX -> {
                    Map<ShiftType, MatchProfile.ShiftTolerance> t = new EnumMap<>(ShiftType.class);
                    Map<ShiftType, String> n = new EnumMap<>(ShiftType.class);
                    for (OptionDef row : q.options()) {
                        String v = a.matrix().get(row.code());
                        if (v == null || !MATRIX_COLUMNS.contains(v)) {
                            throw new InvalidAnswerException("第 " + q.seq() + " 题「" + row.label() + "」还没选");
                        }
                        String note = a.notes() == null ? null : a.notes().get(row.code());
                        if (note != null && note.trim().length() > NOTE_MAX) {
                            throw new InvalidAnswerException("补充说明不超过 " + NOTE_MAX + " 个字");
                        }
                        if ("shift_matrix".equals(q.profileField())) {
                            ShiftType s = parseShift(row.value());
                            t.put(s, MatchProfile.ShiftTolerance.valueOf(v));
                            if ("DEPENDS".equals(v) && note != null && !note.isBlank()) {
                                n.put(s, note.trim());
                            }
                        }
                    }
                    if ("shift_matrix".equals(q.profileField())) {
                        tolerance = t;
                        shiftNotes = n;
                    }
                }
                default -> {
                    OptionDef opt = q.options().stream().filter(o -> o.code().equals(a.code())).findFirst()
                            .orElseThrow(() -> new InvalidAnswerException("第 " + q.seq() + " 题选项不存在"));
                    if (Boolean.TRUE.equals(opt.needRegion()) && (a.region() == null || a.region().isBlank())) {
                        throw new InvalidAnswerException("请选择想去的城市");
                    }
                    chosen.put(q.profileField(), opt);
                    answerByField.put(q.profileField(), a);
                }
            }
        }
        if (!missing.isEmpty()) {
            throw new InvalidAnswerException("还有 " + missing.size() + " 道题没有回答");
        }

        MatchProfile.FactoryWillingness factory = value(chosen, "accept_factory")
                .map(MatchProfile.FactoryWillingness::valueOf).orElse(MatchProfile.FactoryWillingness.YES);
        String lockedCity = value(chosen, "locked_region").filter("LOCKED"::equals)
                .map(v -> answerByField.get("locked_region").region().trim()).orElse(null);
        JobType jobType = value(chosen, "expect_job_type").filter(v -> !"ANY".equals(v)).map(JobType::valueOf).orElse(null);
        // 题库 v2 起不问期望工资（D-62）：salaryMin / salaryMax 为空，打分时按候选岗位的到手工资排位（MatchScorer）
        OptionDef salary = chosen.get("expect_salary");
        ShiftType shift = value(chosen, "shift_pref").map(ShiftType::valueOf).orElse(null);
        MatchProfile.DormRequirement dorm = value(chosen, "dorm_req").map(ProfileBuilder::parseDorm).orElse(null);
        int years = value(chosen, "work_years").map(Integer::parseInt).orElse(0);
        return new MatchProfile(factory, lockedCity, jobType, salary == null ? null : salary.min(),
                salary == null ? null : salary.max(), shift, dorm, years, age != null ? age : answeredAge, lng, lat,
                tolerance, shiftNotes);
    }

    private static boolean unanswered(QuestionDef q, Answer a) {
        return switch (q.type()) {
            case NUMBER -> a.number() == null;
            case MATRIX -> a.matrix() == null || a.matrix().isEmpty();
            default -> a.code() == null;
        };
    }

    /** 住宿：v2 选项取值 NEEDED / NOT_NEEDED，分别等同于 v1 的 REQUIRED / NONE。 */
    static MatchProfile.DormRequirement parseDorm(String v) {
        return switch (v) {
            case "NEEDED" -> MatchProfile.DormRequirement.REQUIRED;
            case "NOT_NEEDED" -> MatchProfile.DormRequirement.NONE;
            default -> MatchProfile.DormRequirement.valueOf(v);
        };
    }

    private static ShiftType parseShift(String v) {
        try {
            return ShiftType.valueOf(require(v));
        } catch (IllegalArgumentException e) {
            throw new InvalidAnswerException("题库配置有误：班次取值「" + v + "」不合法");
        }
    }

    /**
     * 题库保存 / 发布前校验整道题的题型与参数（数字范围、矩阵行）。
     * @return 错误描述；合法返回 null
     */
    public static String checkQuestion(String type, String field, List<OptionDef> options, QuestionConfig config) {
        String t = type == null ? CHOICE : type;
        if (!TYPES.contains(t)) {
            return "未知的题型：" + t;
        }
        if ("age".equals(field) && !NUMBER.equals(t)) {
            return "年龄题必须是数字题";
        }
        if ("shift_matrix".equals(field) && !MATRIX.equals(t)) {
            return "班次接受度题必须是矩阵题";
        }
        switch (t) {
            case NUMBER -> {
                if (config == null || config.min() == null || config.max() == null) {
                    return "数字题要填最小值和最大值";
                }
                if (config.min() > config.max()) {
                    return "最小值不能大于最大值";
                }
                if ("age".equals(field) && (config.min() < AGE_MIN || config.max() > AGE_MAX)) {
                    return "年龄范围只能在 " + AGE_MIN + "–" + AGE_MAX + " 岁之间";
                }
                if (config.unit() != null && config.unit().length() > 8) {
                    return "单位不超过 8 个字";
                }
            }
            case MATRIX -> {
                if (options == null || options.size() < 2 || options.size() > 8) {
                    return "矩阵题要有 2–8 行";
                }
                if (config != null && config.followUp() != null && config.followUp().length() > 30) {
                    return "追问不超过 30 个字";
                }
                if (!"shift_matrix".equals(field)) {
                    return "矩阵题目前只能用于班次接受度（shift_matrix）";
                }
                Set<String> values = new HashSet<>();
                for (OptionDef o : options) {
                    if (o.value() == null || !values.add(o.value())) {
                        return "班次重复或为空：" + o.label();
                    }
                }
            }
            default -> {
                // 单选题
            }
        }
        return null;
    }

    /**
     * 题库保存 / 发布前校验选项取值能被 {@link #build} 正确解析（否则要到 C 端答题时才报错）。
     * 矩阵题的每一行也按选项校验（班次取值）。
     * @return 错误描述；合法返回 null
     */
    public static String checkOption(String field, OptionDef o) {
        String v = o.value();
        try {
            switch (field) {
                case "accept_factory" -> MatchProfile.FactoryWillingness.valueOf(require(v));
                case "locked_region" -> {
                    if (!"LOCKED".equals(v) && !"ANY".equals(v)) {
                        return "地域锁定题的取值只能是 LOCKED 或 ANY";
                    }
                    if ("LOCKED".equals(v) && !Boolean.TRUE.equals(o.needRegion())) {
                        return "取值为 LOCKED 的选项必须勾选「需要选城市」";
                    }
                }
                case "expect_job_type" -> {
                    if (!"ANY".equals(require(v))) {
                        JobType.valueOf(v);
                    }
                }
                case "shift_pref", "shift_matrix" -> ShiftType.valueOf(require(v));
                case "dorm_req" -> parseDorm(require(v));
                case "work_years" -> {
                    if (Integer.parseInt(require(v)) < 0) {
                        return "工作年限不能为负数";
                    }
                }
                case "expect_salary" -> {
                    if (o.min() != null && o.max() != null && o.min().compareTo(o.max()) > 0) {
                        return "薪资下限不能高于上限";
                    }
                }
                default -> {
                    return null;
                }
            }
        } catch (IllegalArgumentException e) {
            return "选项「" + o.label() + "」的取值「" + v + "」不合法";
        }
        return null;
    }

    private static String require(String v) {
        if (v == null || v.isBlank()) {
            throw new IllegalArgumentException("blank");
        }
        return v;
    }

    private static Optional<String> value(Map<String, OptionDef> chosen, String field) {
        OptionDef o = chosen.get(field);
        return o == null || o.value() == null ? Optional.empty() : Optional.of(o.value());
    }
}
