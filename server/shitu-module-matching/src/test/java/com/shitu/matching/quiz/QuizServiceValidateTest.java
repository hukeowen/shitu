package com.shitu.matching.quiz;

import com.shitu.common.exception.BizException;
import com.shitu.matching.domain.ProfileBuilder.OptionDef;
import com.shitu.matching.domain.ProfileBuilder.QuestionConfig;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 题库保存 / 发布校验：题库 v2（V1_7_7__quiz_v2.sql）的结构能通过，数字题 / 矩阵题的参数错误会被拦下。 */
class QuizServiceValidateTest {

    static OptionDef o(String code, String label, String value) {
        return new OptionDef(code, label, null, value, null, null, null);
    }

    static List<QuizService.QuestionView> v2() {
        List<QuizService.QuestionView> qs = new ArrayList<>();
        qs.add(new QuizService.QuestionView(1, "JUDGE", "你能接受进工厂上班吗？", null, "accept_factory", "HARD_FILTER",
                List.of(o("A", "能", "YES"), o("B", "试试", "MAYBE"), o("C", "不能", "NO"))));
        qs.add(new QuizService.QuestionView(2, "JUDGE", "是否只考虑某个城市？", null, "locked_region", "HARD_FILTER",
                List.of(new OptionDef("A", "是", null, "LOCKED", null, null, true), o("B", "不限", "ANY"))));
        qs.add(new QuizService.QuestionView(3, "CHOICE", "你想做哪一类工种？", null, "expect_job_type", "SOFT_WEIGHT",
                List.of(o("A", "电子", "ELECTRONICS"), o("F", "都可以", "ANY"))));
        qs.add(new QuizService.QuestionView(4, "NUMBER", "你今年多大？", null, "age", "SOFT_WEIGHT", List.of(),
                new QuestionConfig(16, 65, "岁", null)));
        qs.add(new QuizService.QuestionView(5, "MATRIX", "这几种班你能不能上？", null, "shift_matrix", "SOFT_WEIGHT",
                List.of(o("DAY", "白班", "DAY"), o("TWO_SHIFT", "两班倒", "TWO_SHIFT"), o("NIGHT", "夜班", "NIGHT"),
                        o("LONG_DAY", "长白班", "LONG_DAY")), new QuestionConfig(null, null, null, "什么情况下可以？")));
        qs.add(new QuizService.QuestionView(6, "CHOICE", "要不要厂里安排住？", null, "dorm_req", "SOFT_WEIGHT",
                List.of(o("A", "需要", "NEEDED"), o("B", "不需要", "NOT_NEEDED"))));
        qs.add(new QuizService.QuestionView(7, "CHOICE", "相关工作做过多久？", null, "work_years", "SOFT_WEIGHT",
                List.of(o("A", "没做过", "0"), o("B", "1 年以内", "1"))));
        return qs;
    }

    @Test
    void 题库v2结构通过校验() {
        assertThatCode(() -> QuizService.validate(v2())).doesNotThrowAnyException();
    }

    @Test
    void 数字题矩阵题参数错误被拦下() {
        List<QuizService.QuestionView> badAge = v2();
        badAge.set(3, new QuizService.QuestionView(4, "NUMBER", "你今年多大？", null, "age", "SOFT_WEIGHT", List.of(),
                new QuestionConfig(10, 70, "岁", null)));
        assertThatThrownBy(() -> QuizService.validate(badAge)).isInstanceOf(BizException.class).hasMessageContaining("16–65");

        List<QuizService.QuestionView> badShift = v2();
        badShift.set(4, new QuizService.QuestionView(5, "MATRIX", "班次？", null, "shift_matrix", "SOFT_WEIGHT",
                List.of(o("DAY", "白班", "DAY"), o("X", "周末班", "WEEKEND")), null));
        assertThatThrownBy(() -> QuizService.validate(badShift)).isInstanceOf(BizException.class).hasMessageContaining("不合法");

        List<QuizService.QuestionView> wrongType = v2();
        wrongType.set(3, new QuizService.QuestionView(4, "CHOICE", "你今年多大？", null, "age", "SOFT_WEIGHT",
                List.of(o("A", "18-25", "1"), o("B", "26-35", "2"))));
        assertThatThrownBy(() -> QuizService.validate(wrongType)).isInstanceOf(BizException.class).hasMessageContaining("数字题");
    }
}
