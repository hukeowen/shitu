package com.shitu.billing.domain;

import com.shitu.common.Constants;
import com.shitu.billing.domain.TransferFeeSplitter.SourceEligibility;
import com.shitu.billing.domain.TransferFeeSplitter.Split;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 计费黄金用例：固定输入 → 固定金额。任何一条失败都禁止合并（03-开发计划 §5）。
 */
class BillingGoldenCasesTest {

    static final BillingRule R = BillingRule.V1;
    static final String A = "C10023";
    static final String B = "C20001";

    static LocalDate d(String s) {
        return LocalDate.parse(s);
    }

    static BigDecimal m(String s) {
        return Money.of(s);
    }

    @Nested
    @DisplayName("日切 D-20：入职当日不计、离职当日不计")
    class DayBoundary {
        @ParameterizedTest(name = "入职{0} 离职{1} 计费日{2} → {3}")
        @CsvSource({
                "2026-07-10, ,           2026-07-10, false",   // 入职当日
                "2026-07-10, ,           2026-07-11, true",    // 次日起计
                "2026-07-10, 2026-07-20, 2026-07-19, true",
                "2026-07-10, 2026-07-20, 2026-07-20, false",   // 离职当日
                "2026-07-10, 2026-07-10, 2026-07-10, false",   // 当日入当日离
                "2026-07-10, 2026-07-11, 2026-07-11, false",   // 入职次日离职：0 天
                "2026-07-10, ,           2026-07-09, false"    // 入职前
        })
        void isBillable(LocalDate start, LocalDate end, LocalDate biz, boolean expected) {
            assertThat(BillableDays.isBillable(start, end, biz)).isEqualTo(expected);
        }

        @Test
        void 跨月任职按自然日累计_E04() {
            // 7-20 入职，8-05 离职：7 月计 21~31 = 11 天，8 月计 1~4 = 4 天
            assertThat(BillableDays.countInMonth(d("2026-07-20"), d("2026-08-05"), YearMonth.of(2026, 7))).isEqualTo(11);
            assertThat(BillableDays.countInMonth(d("2026-07-20"), d("2026-08-05"), YearMonth.of(2026, 8))).isEqualTo(4);
        }

        @Test
        void 闰年二月() {
            assertThat(BillableDays.countInMonth(d("2028-01-01"), null, YearMonth.of(2028, 2))).isEqualTo(29);
        }
    }

    @Nested
    @DisplayName("免费期与存量基数锁定")
    class Free {
        @Test
        void 四月一日入驻_免费到六月三十日_七月一日锁定() {
            assertThat(FreePeriod.lastFreeDay(d("2025-04-01"), 3)).isEqualTo(d("2025-06-30"));
            assertThat(FreePeriod.lockDate(d("2025-04-01"), 3)).isEqualTo(d("2025-07-01"));
            assertThat(FreePeriod.isInFreePeriod(d("2025-04-01"), 3, d("2025-06-30"))).isTrue();
            assertThat(FreePeriod.isInFreePeriod(d("2025-04-01"), 3, d("2025-07-01"))).isFalse();
        }

        @Test
        void 月末入驻_按月加法_十一月三十日入驻免费到次年二月最后一天前一天() {
            // 2025-11-30 + 3 个月 = 2026-02-28 → 最后免费日 2026-02-27
            assertThat(FreePeriod.lastFreeDay(d("2025-11-30"), 3)).isEqualTo(d("2026-02-27"));
        }
    }

    @Nested
    @DisplayName("增长技术服务费 D-18")
    class Growth {
        @Test
        void 免费期内为零() {
            assertThat(GrowthFeeCalculator.daily(500, 0, true, R).fee()).isEqualTo(m("0"));
        }

        @Test
        void 基础用例_在岗838_存量180_增量658_日费65点80() {
            GrowthFeeCalculator.Result r = GrowthFeeCalculator.daily(838, 180, false, R);
            assertThat(r.incrementCount()).isEqualTo(658);
            assertThat(r.fee()).isEqualTo(m("65.80"));
        }

        @Test
        void 在岗少于存量_不出现负数() {
            assertThat(GrowthFeeCalculator.daily(150, 180, false, R).fee()).isEqualTo(m("0"));
        }

        @Test
        void 存量走50新招70_按人数差只计20人() {
            // 核验报告 B-2 的例子：当前在岗 180 - 50 + 70 = 200
            GrowthFeeCalculator.Result r = GrowthFeeCalculator.daily(200, 180, false, R);
            assertThat(r.incrementCount()).isEqualTo(20);
            assertThat(r.fee()).isEqualTo(m("2.00"));
        }

        @Test
        void 存量员工离职后回流_基数不变_人数差口径自然成立_E06() {
            assertThat(GrowthFeeCalculator.daily(180, 180, false, R).fee()).isEqualTo(m("0"));
        }
    }

    @Nested
    @DisplayName("人才流转费分账 D-19 / D-24")
    class Transfer {
        @Test
        void 首次入职来源公司_不是流转() {
            assertThat(TransferFeeSplitter.daily(A, SourceEligibility.ELIGIBLE, A, R)).isEmpty();
        }

        @Test
        void A公司的人入职B公司_B付10_A得8_平台2() {
            Split s = TransferFeeSplitter.daily(A, SourceEligibility.ELIGIBLE, B, R).orElseThrow();
            assertThat(s.payerCompanyId()).isEqualTo(B);
            assertThat(s.payerAmount()).isEqualTo(m("10.00"));
            assertThat(s.supplyCompanyId()).isEqualTo(A);
            assertThat(s.supplyAmount()).isEqualTo(m("8.00"));
            assertThat(s.platformAmount()).isEqualTo(m("2.00"));
        }

        @Test
        void 公域来源入职B公司_10元全归平台_文档2点4() {
            Split s = TransferFeeSplitter.daily(Constants.PLATFORM, SourceEligibility.ELIGIBLE, B, R).orElseThrow();
            assertThat(s.supplyCompanyId()).isNull();
            assertThat(s.supplyAmount()).isEqualTo(m("0"));
            assertThat(s.platformAmount()).isEqualTo(m("10.00"));
        }

        @Test
        void 来源公司已注销_平台继承() {
            Split s = TransferFeeSplitter.daily(A, SourceEligibility.CLOSED, B, R).orElseThrow();
            assertThat(s.platformAmount()).isEqualTo(m("10.00"));
            assertThat(s.supplyAmount()).isEqualTo(m("0"));
        }

        @Test
        void 来源公司被取消收费服务权限_D24_平台收全额() {
            Split s = TransferFeeSplitter.daily(A, SourceEligibility.REVOKED, B, R).orElseThrow();
            assertThat(s.platformAmount()).isEqualTo(m("10.00"));
        }

        @Test
        void 资金流向总览三个场景_文档2点4() {
            BigDecimal service = R.serviceUnitPrice();
            // 私域用户首次入职 A：0.10
            assertThat(service.add(TransferFeeSplitter.daily(A, SourceEligibility.ELIGIBLE, A, R)
                    .map(Split::platformAmount).orElse(Money.zero()))).isEqualByComparingTo("0.10");
            // 私域用户从 A 流转到 B：0.10 + 2.00
            assertThat(service.add(TransferFeeSplitter.daily(A, SourceEligibility.ELIGIBLE, B, R)
                    .orElseThrow().platformAmount())).isEqualByComparingTo("2.10");
            // 公域用户入职 B：0.10 + 10.00
            assertThat(service.add(TransferFeeSplitter.daily(Constants.PLATFORM, SourceEligibility.ELIGIBLE, B, R)
                    .orElseThrow().platformAmount())).isEqualByComparingTo("10.10");
        }

        @Test
        void 九十天流转收入_接收方900_供给方720() {
            Split s = TransferFeeSplitter.daily(A, SourceEligibility.ELIGIBLE, B, R).orElseThrow();
            assertThat(s.payerAmount().multiply(BigDecimal.valueOf(90))).isEqualByComparingTo("900");
            assertThat(s.supplyAmount().multiply(BigDecimal.valueOf(90))).isEqualByComparingTo("720");
        }
    }

    @Nested
    @DisplayName("跨月、跨年与多段任职")
    class Spans {
        @Test
        void 整月在职_按当月自然日() {
            assertThat(BillableDays.countInMonth(d("2026-06-15"), null, YearMonth.of(2026, 7))).isEqualTo(31);
            assertThat(BillableDays.countInMonth(d("2026-06-15"), null, YearMonth.of(2026, 9))).isEqualTo(30);
        }

        @Test
        void 跨年任职_十二月与一月分别累计() {
            // 12-20 入职，次年 1-10 离职：12 月计 21~31 = 11 天，1 月计 1~9 = 9 天
            assertThat(BillableDays.countInMonth(d("2026-12-20"), d("2027-01-10"), YearMonth.of(2026, 12))).isEqualTo(11);
            assertThat(BillableDays.countInMonth(d("2026-12-20"), d("2027-01-10"), YearMonth.of(2027, 1))).isEqualTo(9);
        }

        @Test
        void 当月入职当月离职_首尾两天都不计() {
            assertThat(BillableDays.countInMonth(d("2026-07-10"), d("2026-07-20"), YearMonth.of(2026, 7))).isEqualTo(9);
        }

        @Test
        void 月末最后一天入职_当月零天_次月整月() {
            assertThat(BillableDays.countInMonth(d("2026-07-31"), null, YearMonth.of(2026, 7))).isZero();
            assertThat(BillableDays.countInMonth(d("2026-07-31"), null, YearMonth.of(2026, 8))).isEqualTo(31);
        }

        @Test
        void 月初一日离职_当月零天() {
            assertThat(BillableDays.countInMonth(d("2026-07-20"), d("2026-08-01"), YearMonth.of(2026, 8))).isZero();
            assertThat(BillableDays.countInMonth(d("2026-07-20"), d("2026-08-01"), YearMonth.of(2026, 7))).isEqualTo(11);
        }

        @Test
        void 任职与账单月不重叠_零天() {
            assertThat(BillableDays.countInMonth(d("2026-05-01"), d("2026-06-10"), YearMonth.of(2026, 7))).isZero();
            assertThat(BillableDays.countInMonth(d("2026-08-05"), null, YearMonth.of(2026, 7))).isZero();
        }

        @Test
        void 离职后再入职_两段任职分别计_中间空档不计() {
            // 第一段 7-01 ~ 7-10 计 2~9 = 8 天；第二段 7-15 起计 16~31 = 16 天
            int first = BillableDays.countInMonth(d("2026-07-01"), d("2026-07-10"), YearMonth.of(2026, 7));
            int second = BillableDays.countInMonth(d("2026-07-15"), null, YearMonth.of(2026, 7));
            assertThat(first).isEqualTo(8);
            assertThat(second).isEqualTo(16);
            assertThat(BillableDays.isBillable(d("2026-07-01"), d("2026-07-10"), d("2026-07-12"))).isFalse();
        }
    }

    @Nested
    @DisplayName("免费期边界")
    class FreeEdges {
        @Test
        void 入驻当天就在免费期内() {
            assertThat(FreePeriod.isInFreePeriod(d("2025-04-01"), 3, d("2025-04-01"))).isTrue();
        }

        @Test
        void 一月三十一日入驻_四月没有三十一日_免费到四月二十九日() {
            assertThat(FreePeriod.lastFreeDay(d("2026-01-31"), 3)).isEqualTo(d("2026-04-29"));
            assertThat(FreePeriod.lockDate(d("2026-01-31"), 3)).isEqualTo(d("2026-04-30"));
        }

        @Test
        void 闰年_十一月三十日入驻_免费到二月二十八日() {
            assertThat(FreePeriod.lastFreeDay(d("2027-11-30"), 3)).isEqualTo(d("2028-02-28"));
            assertThat(FreePeriod.lockDate(d("2027-11-30"), 3)).isEqualTo(d("2028-02-29"));
        }

        @Test
        void 免费期最后一天为零_次日开始计费() {
            LocalDate join = d("2025-04-01");
            assertThat(GrowthFeeCalculator.daily(300, 180, FreePeriod.isInFreePeriod(join, 3, d("2025-06-30")), R).fee()).isEqualTo(m("0"));
            assertThat(GrowthFeeCalculator.daily(300, 180, FreePeriod.isInFreePeriod(join, 3, d("2025-07-01")), R).fee()).isEqualTo(m("12.00"));
        }
    }

    @Nested
    @DisplayName("增长技术服务费的边界与月累计")
    class GrowthEdges {
        @Test
        void 只多一个人_一毛钱() {
            assertThat(GrowthFeeCalculator.daily(181, 180, false, R).fee()).isEqualTo(m("0.10"));
        }

        @Test
        void 没有存量_在岗全部计费() {
            GrowthFeeCalculator.Result r = GrowthFeeCalculator.daily(100, 0, false, R);
            assertThat(r.incrementCount()).isEqualTo(100);
            assertThat(r.fee()).isEqualTo(m("10.00"));
        }

        @Test
        void 没人在岗_零() {
            assertThat(GrowthFeeCalculator.daily(0, 0, false, R).fee()).isEqualTo(m("0"));
        }

        @Test
        void 整月累计_增量658人_三十一天_2039点80() {
            BigDecimal day = GrowthFeeCalculator.daily(838, 180, false, R).fee();
            assertThat(day.multiply(BigDecimal.valueOf(31))).isEqualByComparingTo("2039.80");
        }

        @Test
        void 存量走光再招满_在岗等于存量_仍为零() {
            // 存量 180 人全部离职，又新招 180 人：按人数差口径不收费（D-18）
            assertThat(GrowthFeeCalculator.daily(180, 180, false, R).incrementCount()).isZero();
        }
    }

    @Nested
    @DisplayName("流转费的跨月、回流与来源资格变化")
    class TransferSpans {
        @Test
        void 跨月流转_七月110_八月40_来源方88与32() {
            Split s = TransferFeeSplitter.daily(A, SourceEligibility.ELIGIBLE, B, R).orElseThrow();
            int july = BillableDays.countInMonth(d("2026-07-20"), d("2026-08-05"), YearMonth.of(2026, 7));
            int aug = BillableDays.countInMonth(d("2026-07-20"), d("2026-08-05"), YearMonth.of(2026, 8));
            assertThat(s.payerAmount().multiply(BigDecimal.valueOf(july))).isEqualByComparingTo("110");
            assertThat(s.payerAmount().multiply(BigDecimal.valueOf(aug))).isEqualByComparingTo("40");
            assertThat(s.supplyAmount().multiply(BigDecimal.valueOf(july))).isEqualByComparingTo("88");
            assertThat(s.supplyAmount().multiply(BigDecimal.valueOf(aug))).isEqualByComparingTo("32");
            assertThat(s.platformAmount().multiply(BigDecimal.valueOf(july + aug))).isEqualByComparingTo("30");
        }

        @Test
        void 流转出去的人回到来源公司_不再产生流转费() {
            assertThat(TransferFeeSplitter.daily(A, SourceEligibility.ELIGIBLE, B, R)).isPresent();
            assertThat(TransferFeeSplitter.daily(A, SourceEligibility.ELIGIBLE, A, R)).isEmpty();
        }

        @Test
        void 从B再流转到第三家公司_付费方换人_来源方不变() {
            Split s = TransferFeeSplitter.daily(A, SourceEligibility.ELIGIBLE, "C30001", R).orElseThrow();
            assertThat(s.payerCompanyId()).isEqualTo("C30001");
            assertThat(s.supplyCompanyId()).isEqualTo(A);
            assertThat(s.supplyAmount()).isEqualTo(m("8.00"));
        }

        @Test
        void 来源公司月中被取消权限_付费方金额不变_分成改归平台() {
            // 前 10 天来源方正常，后 5 天被取消收费服务权限（D-24）
            Split ok = TransferFeeSplitter.daily(A, SourceEligibility.ELIGIBLE, B, R).orElseThrow();
            Split revoked = TransferFeeSplitter.daily(A, SourceEligibility.REVOKED, B, R).orElseThrow();
            BigDecimal payer = ok.payerAmount().multiply(BigDecimal.TEN).add(revoked.payerAmount().multiply(BigDecimal.valueOf(5)));
            BigDecimal supply = ok.supplyAmount().multiply(BigDecimal.TEN).add(revoked.supplyAmount().multiply(BigDecimal.valueOf(5)));
            BigDecimal platform = ok.platformAmount().multiply(BigDecimal.TEN).add(revoked.platformAmount().multiply(BigDecimal.valueOf(5)));
            assertThat(payer).isEqualByComparingTo("150");
            assertThat(supply).isEqualByComparingTo("80");
            assertThat(platform).isEqualByComparingTo("70");
        }

        @Test
        void 任何来源资格下_付费方金额等于来源方加平台() {
            for (String source : new String[]{A, Constants.PLATFORM}) {
                for (SourceEligibility e : SourceEligibility.values()) {
                    Split s = TransferFeeSplitter.daily(source, e, B, R).orElseThrow();
                    assertThat(s.supplyAmount().add(s.platformAmount())).as(source + " / " + e).isEqualByComparingTo(s.payerAmount());
                    assertThat(s.payerAmount()).as("付费方固定 10 元").isEqualTo(m("10.00"));
                }
            }
        }
    }
}
