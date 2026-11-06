package com.shitu.matching.domain;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

/** 岗位权重（D-29 / D-30，原型 P-13）。配置取种子数据 v1。 */
class JobWeightCalculatorTest {

    static EngineConfig cfg;

    @BeforeAll
    static void load() throws Exception {
        MatchScorerTest.loadSeedConfig();
        cfg = MatchScorerTest.cfg;
    }

    static BigDecimal w(long days, String conv, int credit, int penalty, int quota) {
        return JobWeightCalculator.weight(new JobWeightCalculator.Input(days, conv == null ? null : new BigDecimal(conv),
                credit, penalty, quota), cfg);
    }

    @ParameterizedTest(name = "挂岗 {0} 天 → 衰减 {1}")
    @CsvSource({"4, 1.000", "7, 1.000", "8, 0.800", "14, 0.800", "15, 0.500", "30, 0.500", "31, 0.200", "60, 0.200", "61, 0.000"})
    void 挂岗天数衰减(long days, String expected) {
        assertThat(w(days, null, 100, 0, 10)).isEqualByComparingTo(expected);
    }

    @Test
    void 新岗位前3天加成() {
        assertThat(w(0, null, 100, 0, 10)).isEqualByComparingTo("1.150");
        assertThat(w(3, null, 100, 0, 10)).isEqualByComparingTo("1.150");
    }

    @Test
    void 衰减与低转化取较小值_不相乘() {
        // 第 20 天：衰减 0.5，低转化 0.5 → 取 0.5（相乘会是 0.25）
        assertThat(w(20, "0.05", 100, 0, 10)).isEqualByComparingTo("0.500");
        // 第 10 天还不到 15 天，不触发低转化：0.8
        assertThat(w(10, "0.00", 100, 0, 10)).isEqualByComparingTo("0.800");
        // 转化率高于 10% 不降权
        assertThat(w(20, "0.30", 100, 0, 10)).isEqualByComparingTo("0.500");
        assertThat(w(9, "0.30", 100, 0, 10)).isEqualByComparingTo("0.800");
    }

    @Test
    void 诚信分与处罚系数() {
        assertThat(w(9, null, 59, 0, 10)).isEqualByComparingTo("0.160");
        assertThat(w(9, null, 29, 0, 10)).isEqualByComparingTo("0.000");
        assertThat(w(9, null, 100, 2, 10)).isEqualByComparingTo("0.400");
        assertThat(w(9, null, 100, 3, 10)).isEqualByComparingTo("0.000");
    }

    @Test
    void 名额快满降低曝光() {
        assertThat(w(9, null, 100, 0, 2)).isEqualByComparingTo("0.480");
        assertThat(w(9, null, 100, 0, 3)).isEqualByComparingTo("0.800");
    }
}
