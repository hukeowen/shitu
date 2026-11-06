package com.shitu.matching.domain;

import com.shitu.common.enums.JobType;
import com.shitu.common.enums.ShiftType;
import com.shitu.matching.domain.ProfileBuilder.Answer;
import com.shitu.matching.domain.ProfileBuilder.OptionDef;
import com.shitu.matching.domain.ProfileBuilder.QuestionDef;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 题目结构与种子题库 v1 一致（V1_0_7__seed.sql）。 */
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
}
