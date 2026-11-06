package com.shitu.lifecycle.domain;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;

class IdCardsTest {

    /** 按 GB 11643 计算校验码，生成测试用的合法号码。 */
    static String withCheck(String first17) {
        int[] w = {7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2};
        char[] c = {'1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'};
        int sum = 0;
        for (int i = 0; i < 17; i++) {
            sum += (first17.charAt(i) - '0') * w[i];
        }
        return first17 + c[sum % 11];
    }

    @Test
    void 校验码_出生日期() {
        assertThat(IdCards.isValid("11010519491231002X")).isTrue();
        assertThat(IdCards.isValid("11010519491231002x")).isTrue();
        assertThat(IdCards.isValid("110105194912310021")).isFalse();
        assertThat(IdCards.isValid(withCheck("32058320260230123"))).as("2 月 30 日").isFalse();
        assertThat(IdCards.isValid("12345")).isFalse();
        assertThat(IdCards.isValid(null)).isFalse();
        assertThat(IdCards.birthDate("11010519491231002X")).contains(LocalDate.of(1949, 12, 31));
        assertThat(IdCards.gender("11010519491231002X")).contains("F");
    }

    @Test
    void 两次输入比对_忽略空格和小写x() {
        assertThat(IdCards.sameInput("11010519491231002X", " 110105 19491231 002x ")).isTrue();
        assertThat(IdCards.sameInput("11010519491231002X", "11010519491231003X")).isFalse();
        assertThat(IdCards.sameInput(null, null)).isFalse();
    }

    @Test
    void 年龄三档_生日当天满周岁() {
        LocalDate today = LocalDate.of(2026, 11, 6);
        assertThat(IdCards.ageVerdict(LocalDate.of(2010, 11, 7), today, 16, 18)).isEqualTo(IdCards.AgeVerdict.UNDERAGE_BLOCKED);
        assertThat(IdCards.ageVerdict(LocalDate.of(2010, 11, 6), today, 16, 18)).isEqualTo(IdCards.AgeVerdict.CANNOT_APPLY);
        assertThat(IdCards.ageVerdict(LocalDate.of(2008, 11, 7), today, 16, 18)).isEqualTo(IdCards.AgeVerdict.CANNOT_APPLY);
        assertThat(IdCards.ageVerdict(LocalDate.of(2008, 11, 6), today, 16, 18)).isEqualTo(IdCards.AgeVerdict.OK);
    }
}
