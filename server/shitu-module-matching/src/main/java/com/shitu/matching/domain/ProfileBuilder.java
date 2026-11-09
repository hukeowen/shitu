package com.shitu.matching.domain;

import com.shitu.common.enums.JobType;
import com.shitu.common.enums.ShiftType;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 答案 → 画像（C-302 / C-303）。题目来自题库当前生效版本，按 {@code profile_field} 识别含义，
 * 平台调整题目文案、选项文字、顺序都不影响画像生成；新增未知字段的题目会被忽略（只记录在答案里）。
 */
public final class ProfileBuilder {

    /** 选项定义（与 quiz_question.options JSON 一致）。value 可为字符串或数字；薪资题用 min / max。 */
    @com.fasterxml.jackson.annotation.JsonIgnoreProperties(ignoreUnknown = true)
    public record OptionDef(String code, String label, String sub, String value, BigDecimal min, BigDecimal max,
                            Boolean needRegion) {
    }

    public record QuestionDef(int seq, String profileField, String matchRole, List<OptionDef> options) {
    }

    /** 用户对某题的回答：选项编码；地域锁定题选「是」时附带城市。 */
    public record Answer(int seq, String code, String region) {
    }

    public static final class InvalidAnswerException extends RuntimeException {
        public InvalidAnswerException(String message) {
            super(message);
        }
    }

    private ProfileBuilder() {
    }

    /**
     * @param age 已实名时的年龄（用于硬过滤），否则为 null
     * @throws InvalidAnswerException 漏答、选项不存在、地域锁定未选城市
     */
    public static MatchProfile build(List<QuestionDef> questions, List<Answer> answers, Integer age,
                                     BigDecimal lng, BigDecimal lat) {
        Map<Integer, Answer> bySeq = new HashMap<>();
        for (Answer a : answers) {
            bySeq.put(a.seq(), a);
        }
        Map<String, OptionDef> chosen = new HashMap<>();
        Map<String, Answer> answerByField = new HashMap<>();
        List<Integer> missing = new ArrayList<>();
        for (QuestionDef q : questions) {
            Answer a = bySeq.get(q.seq());
            if (a == null) {
                missing.add(q.seq());
                continue;
            }
            OptionDef opt = q.options().stream().filter(o -> o.code().equals(a.code())).findFirst()
                    .orElseThrow(() -> new InvalidAnswerException("第 " + q.seq() + " 题选项不存在"));
            if (Boolean.TRUE.equals(opt.needRegion()) && (a.region() == null || a.region().isBlank())) {
                throw new InvalidAnswerException("请选择想去的城市");
            }
            chosen.put(q.profileField(), opt);
            answerByField.put(q.profileField(), a);
        }
        if (!missing.isEmpty()) {
            throw new InvalidAnswerException("还有 " + missing.size() + " 道题没有回答");
        }

        MatchProfile.FactoryWillingness factory = value(chosen, "accept_factory")
                .map(MatchProfile.FactoryWillingness::valueOf).orElse(MatchProfile.FactoryWillingness.YES);
        String lockedCity = value(chosen, "locked_region").filter("LOCKED"::equals)
                .map(v -> answerByField.get("locked_region").region().trim()).orElse(null);
        JobType jobType = value(chosen, "expect_job_type").filter(v -> !"ANY".equals(v)).map(JobType::valueOf).orElse(null);
        OptionDef salary = chosen.get("expect_salary");
        ShiftType shift = value(chosen, "shift_pref").map(ShiftType::valueOf).orElse(null);
        MatchProfile.DormRequirement dorm = value(chosen, "dorm_req").map(MatchProfile.DormRequirement::valueOf).orElse(null);
        int years = value(chosen, "work_years").map(Integer::parseInt).orElse(0);
        return new MatchProfile(factory, lockedCity, jobType, salary == null ? null : salary.min(),
                salary == null ? null : salary.max(), shift, dorm, years, age, lng, lat);
    }

    /**
     * 题库保存 / 发布前校验选项取值能被 {@link #build} 正确解析（否则要到 C 端答题时才报错）。
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
                case "shift_pref" -> ShiftType.valueOf(require(v));
                case "dorm_req" -> MatchProfile.DormRequirement.valueOf(require(v));
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
