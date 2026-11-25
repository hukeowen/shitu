package com.shitu.matching.domain;

import com.shitu.common.enums.JobType;
import com.shitu.common.enums.ShiftType;
import com.shitu.matching.domain.ProfileBuilder.Answer;
import com.shitu.matching.domain.ProfileBuilder.OptionDef;
import com.shitu.matching.domain.ProfileBuilder.QuestionDef;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 题目结构与种子题库 v1（V1_0_7__seed.sql）、v2（V1_7_7__quiz_v2.sql）一致。 */
class ProfileBuilderTest {

    static OptionDef o(String code, String value) {
        return new OptionDef(code, code, null, value, null, null, null);
    }

    static final List<QuestionDef> V1 = List.of(
            new QuestionDef(1, "accept_factory", "HARD_FILTER", List.of(o("A", "YES"), o("B", "MAYBE"), o("C", "NO"))),
            new QuestionDef(2, "locked_region", "HARD_FILTER", List.of(
                    new OptionDef("A", "是", null, "LOCKED", null, null, true), o("B", "ANY"))),
            new QuestionDef(3, "expect_job_type", "SOFT_WEIGHT", List.of(o("A", "ELECTRONICS"), o("B", "GENERAL"),
                    o("C", "WAREHOUSE"), o("D", "MACHINING"), o("E", "QC"), o("F", "ANY"))),
            new QuestionDef(4, "expect_salary", "SOFT_WEIGHT", List.of(
                    new OptionDef("A", "4500-5500", null, null, BigDecimal.valueOf(4500), BigDecimal.valueOf(5500), null),
                    new OptionDef("B", "5500-6500", null, null, BigDecimal.valueOf(5500), BigDecimal.valueOf(6500), null))),
            new QuestionDef(5, "shift_pref", "SOFT_WEIGHT", List.of(o("A", "DAY"), o("B", "TWO_SHIFT"), o("C", "NIGHT"), o("D", "LONG_DAY"))),
            new QuestionDef(6, "dorm_req", "SOFT_WEIGHT", List.of(o("A", "REQUIRED"), o("B", "SMALL_ROOM"), o("C", "AIRCON"), o("D", "NONE"))),
            new QuestionDef(7, "work_years", "SOFT_WEIGHT", List.of(o("A", "0"), o("B", "1"), o("C", "2"), o("D", "3"))));

    @Test
    void 七题答案生成画像() {
        MatchProfile p = ProfileBuilder.build(V1, List.of(new Answer(1, "A", null), new Answer(2, "A", "苏州"),
                new Answer(3, "A", null), new Answer(4, "B", null), new Answer(5, "D", null), new Answer(6, "B", null),
                new Answer(7, "C", null)), 25, null, null);
        assertThat(p.factory()).isEqualTo(MatchProfile.FactoryWillingness.YES);
        assertThat(p.lockedCity()).isEqualTo("苏州");
        assertThat(p.jobType()).isEqualTo(JobType.ELECTRONICS);
        assertThat(p.salaryMin()).isEqualByComparingTo("5500");
        assertThat(p.salaryMax()).isEqualByComparingTo("6500");
        assertThat(p.shift()).isEqualTo(ShiftType.LONG_DAY);
        assertThat(p.dorm()).isEqualTo(MatchProfile.DormRequirement.SMALL_ROOM);
        assertThat(p.workYears()).isEqualTo(2);
        assertThat(p.age()).isEqualTo(25);
    }

    @Test
    void 不限地域_工种都可以() {
        MatchProfile p = ProfileBuilder.build(V1, List.of(new Answer(1, "C", null), new Answer(2, "B", null),
                new Answer(3, "F", null), new Answer(4, "A", null), new Answer(5, "A", null), new Answer(6, "D", null),
                new Answer(7, "A", null)), null, null, null);
        assertThat(p.factory()).isEqualTo(MatchProfile.FactoryWillingness.NO);
        assertThat(p.lockedCity()).isNull();
        assertThat(p.jobType()).isNull();
        assertThat(p.workYears()).isZero();
    }

    @Test
    void 漏答_选项不存在_锁定地域未选城市_都拒绝() {
        assertThatThrownBy(() -> ProfileBuilder.build(V1, List.of(new Answer(1, "A", null)), null, null, null))
                .hasMessageContaining("6 道题没有回答");
        assertThatThrownBy(() -> ProfileBuilder.build(V1, List.of(new Answer(1, "Z", null)), null, null, null))
                .hasMessageContaining("选项不存在");
        assertThatThrownBy(() -> ProfileBuilder.build(V1, List.of(new Answer(1, "A", null), new Answer(2, "A", " ")),
                null, null, null)).hasMessageContaining("城市");
    }

    // ------------------------------------------------------------------ 题库 v2（D-62）

    static OptionDef row(String code) {
        return new OptionDef(code, code, null, code, null, null, null);
    }

    static final List<QuestionDef> V2 = List.of(V1.get(0), V1.get(1), V1.get(2),
            new QuestionDef(4, ProfileBuilder.NUMBER, "age", "SOFT_WEIGHT", List.of(),
                    new ProfileBuilder.QuestionConfig(16, 65, "岁", null)),
            new QuestionDef(5, ProfileBuilder.MATRIX, "shift_matrix", "SOFT_WEIGHT",
                    List.of(row("DAY"), row("TWO_SHIFT"), row("NIGHT"), row("LONG_DAY")),
                    new ProfileBuilder.QuestionConfig(null, null, null, "什么情况下可以？")),
            new QuestionDef(6, "dorm_req", "SOFT_WEIGHT", List.of(o("A", "NEEDED"), o("B", "NOT_NEEDED"))),
            V1.get(6));

    static List<Answer> v2Answers(Integer age, Map<String, String> matrix, Map<String, String> notes) {
        return List.of(new Answer(1, "A", null), new Answer(2, "B", null), new Answer(3, "A", null),
                age == null ? new Answer(4, null, null) : Answer.number(4, age), Answer.matrix(5, matrix, notes),
                new Answer(6, "A", null), new Answer(7, "B", null));
    }

    static final Map<String, String> MATRIX = Map.of("DAY", "ACCEPT", "TWO_SHIFT", "DEPENDS", "NIGHT", "REJECT", "LONG_DAY", "ACCEPT");

    @Test
    void v2_年龄_班次三态_住宿_不问工资() {
        MatchProfile p = ProfileBuilder.build(V2, v2Answers(32, MATRIX, Map.of("TWO_SHIFT", " 夜班补贴高就行 ", "DAY", "忽略")),
                null, null, null);
        assertThat(p.age()).as("未实名用自报年龄").isEqualTo(32);
        assertThat(p.salaryMin()).isNull();
        assertThat(p.salaryByRank()).isTrue();
        assertThat(p.shift()).isNull();
        assertThat(p.shiftTolerance()).containsEntry(ShiftType.DAY, MatchProfile.ShiftTolerance.ACCEPT)
                .containsEntry(ShiftType.TWO_SHIFT, MatchProfile.ShiftTolerance.DEPENDS)
                .containsEntry(ShiftType.NIGHT, MatchProfile.ShiftTolerance.REJECT)
                .containsEntry(ShiftType.LONG_DAY, MatchProfile.ShiftTolerance.ACCEPT);
        assertThat(p.shiftNotes()).as("只记「看情况」行的补充，去掉首尾空格").containsExactlyEntriesOf(Map.of(ShiftType.TWO_SHIFT, "夜班补贴高就行"));
        assertThat(p.dorm()).as("需要住 = 必须包住").isEqualTo(MatchProfile.DormRequirement.REQUIRED);
        assertThat(p.workYears()).isEqualTo(1);
    }

    @Test
    void v2_实名年龄优先于自报年龄() {
        assertThat(ProfileBuilder.build(V2, v2Answers(40, MATRIX, null), 27, null, null).age()).isEqualTo(27);
    }

    @Test
    void v2_年龄超范围_矩阵漏行_补充超长_都拒绝() {
        assertThatThrownBy(() -> ProfileBuilder.build(V2, v2Answers(15, MATRIX, null), null, null, null))
                .hasMessageContaining("16–65");
        assertThatThrownBy(() -> ProfileBuilder.build(V2, v2Answers(66, MATRIX, null), null, null, null))
                .hasMessageContaining("16–65");
        assertThatThrownBy(() -> ProfileBuilder.build(V2, v2Answers(null, MATRIX, null), null, null, null))
                .hasMessageContaining("1 道题没有回答");
        assertThatThrownBy(() -> ProfileBuilder.build(V2, v2Answers(30, Map.of("DAY", "ACCEPT", "NIGHT", "REJECT"), null),
                null, null, null)).hasMessageContaining("还没选");
        assertThatThrownBy(() -> ProfileBuilder.build(V2, v2Answers(30, Map.of("DAY", "ACCEPT", "NIGHT", "MAYBE",
                "TWO_SHIFT", "ACCEPT", "LONG_DAY", "ACCEPT"), null), null, null, null)).hasMessageContaining("还没选");
        assertThatThrownBy(() -> ProfileBuilder.build(V2, v2Answers(30, MATRIX, Map.of("TWO_SHIFT", "很".repeat(51))),
                null, null, null)).hasMessageContaining("50");
    }

    @Test
    void 题型参数校验() {
        assertThat(ProfileBuilder.checkQuestion("NUMBER", "age", List.of(), new ProfileBuilder.QuestionConfig(16, 65, "岁", null))).isNull();
        assertThat(ProfileBuilder.checkQuestion("NUMBER", "age", List.of(), new ProfileBuilder.QuestionConfig(10, 65, "岁", null)))
                .contains("16–65");
        assertThat(ProfileBuilder.checkQuestion("NUMBER", "age", List.of(), null)).contains("最小值");
        assertThat(ProfileBuilder.checkQuestion("CHOICE", "age", List.of(), null)).contains("数字题");
        assertThat(ProfileBuilder.checkQuestion("MATRIX", "shift_matrix", List.of(row("DAY"), row("NIGHT")), null)).isNull();
        assertThat(ProfileBuilder.checkQuestion("MATRIX", "shift_matrix", List.of(row("DAY"), row("DAY")), null)).contains("重复");
        assertThat(ProfileBuilder.checkQuestion("MATRIX", "shift_matrix", List.of(row("DAY")), null)).contains("2–8");
        assertThat(ProfileBuilder.checkQuestion("FOO", "dorm_req", List.of(), null)).contains("未知的题型");
        assertThat(ProfileBuilder.checkOption("shift_matrix", row("WEEKEND"))).contains("不合法");
        assertThat(ProfileBuilder.checkOption("dorm_req", o("A", "NOT_NEEDED"))).isNull();
    }

    @Test
    void v1_旧会话答案JSON照常读取() throws Exception {
        var json = new com.fasterxml.jackson.databind.ObjectMapper();
        List<Answer> old = json.readValue("[{\"seq\":1,\"code\":\"A\"},{\"seq\":2,\"code\":\"A\",\"region\":\"苏州\"}]",
                new com.fasterxml.jackson.core.type.TypeReference<>() {
                });
        assertThat(old.get(1)).isEqualTo(new Answer(2, "A", "苏州"));
        String written = json.writeValueAsString(Answer.matrix(5, Map.of("DAY", "ACCEPT"), null));
        assertThat(written).doesNotContain("code").contains("matrix");
        MatchProfile v1 = json.readValue("{\"factory\":\"YES\",\"lockedCity\":null,\"jobType\":\"ELECTRONICS\",\"salaryMin\":5500,"
                + "\"salaryMax\":6500,\"shift\":\"LONG_DAY\",\"dorm\":\"SMALL_ROOM\",\"workYears\":2,\"age\":25}", MatchProfile.class);
        assertThat(v1.salaryByRank()).isFalse();
        assertThat(v1.shiftTolerance()).isNull();
        MatchProfile v2 = ProfileBuilder.build(V2, v2Answers(32, MATRIX, Map.of("TWO_SHIFT", "包住就行")), null, null, null);
        assertThat(json.readValue(json.writeValueAsString(v2), MatchProfile.class)).isEqualTo(v2);
    }
}
