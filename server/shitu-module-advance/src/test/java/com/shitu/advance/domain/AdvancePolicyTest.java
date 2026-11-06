package com.shitu.advance.domain;

import com.shitu.common.enums.UserStatus;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

class AdvancePolicyTest {

    final AdvancePolicy p = AdvancePolicy.DEFAULT;

    AdvancePolicy.Applicant employed(int now, int prevMonthEnd, int used) {
        return new AdvancePolicy.Applicant(UserStatus.EMPLOYED, "C10023", now, prevMonthEnd, used, false, false);
    }

    @Test
    void 入职第6天不能预支_第7天解锁第一次() {
        assertThat(p.check(employed(6, 0, 0))).anyMatch(r -> r.contains("满 7 个在岗日"));
        assertThat(p.check(employed(7, 0, 0))).isEmpty();
    }

    @Test
    void 滚动累计_上月末在岗20天_本月第1天累计21天_立即获得1次() {
        // 上月：20/7 = 2 次（已过期）；本月到 21 天：21/7 = 3 → 本月获得 1 次
        assertThat(p.chancesGrantedThisMonth(20, 21)).isEqualTo(1);
        assertThat(p.check(employed(21, 20, 0))).isEmpty();
    }

    @Test
    void 未用机会月末清零_不结转() {
        // 上月末 28 天（上月获得的 4 次全部作废），本月才到 30 天：本月获得 0 次
        assertThat(p.chancesGrantedThisMonth(28, 30)).isZero();
        assertThat(p.check(employed(30, 28, 0))).singleElement().asString().contains("再在岗 5 天");
    }

    @Test
    void 每月最多4次() {
        // 一整个 31 天月在岗，从累计 0 → 31 天：获得 4 次
        assertThat(p.chancesGrantedThisMonth(0, 31)).isEqualTo(4);
        assertThat(p.remainingThisMonth(4, 3)).isEqualTo(1);
        assertThat(p.check(employed(31, 0, 4))).anyMatch(r -> r.contains("已达上限"));
    }

    @Test
    void 月上限封顶_即使理论获得更多() {
        assertThat(p.remainingThisMonth(5, 0)).isEqualTo(4);
    }

    @Test
    void 非在岗_无归属_黑名单_审批中_都不能申请() {
        var a = new AdvancePolicy.Applicant(UserStatus.PUBLIC_SEEKING, null, 10, 0, 0, true, true);
        assertThat(p.check(a)).hasSize(4);
    }

    @Test
    void 发薪日抵扣_工资足够_全额抵扣() {
        var r = DebtDeduction.deduct(new BigDecimal("1000.00"), new BigDecimal("5735.47"));
        assertThat(r.deducted()).isEqualByComparingTo("1000.00");
        assertThat(r.fullyRepaid()).isTrue();
        assertThat(r.netPayAfter()).isEqualByComparingTo("4735.47");
    }

    @Test
    void 发薪日抵扣_工资不足_部分抵扣并结转() {
        var r = DebtDeduction.deduct(new BigDecimal("1000.00"), new BigDecimal("300.00"));
        assertThat(r.deducted()).isEqualByComparingTo("300.00");
        assertThat(r.remainingDebt()).isEqualByComparingTo("700.00");
        assertThat(r.netPayAfter()).isEqualByComparingTo("0.00");
    }
}
