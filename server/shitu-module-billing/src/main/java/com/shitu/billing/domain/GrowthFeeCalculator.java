package com.shitu.billing.domain;

import java.math.BigDecimal;

/**
 * 增长技术服务费（D-18，按公司算人数差）：
 * <pre>当日费用 = max(当日在岗人数 − 存量基数, 0) × 单价</pre>
 * 免费期内费用为 0。存量人员离职不会让增量人员变成免费，也不会额外收费 —— 只看人数差。
 */
public final class GrowthFeeCalculator {

    private GrowthFeeCalculator() {
    }

    public record Result(int employedCount, int stockBase, int incrementCount, BigDecimal unitPrice, BigDecimal fee) {
    }

    /**
     * @param employedCount 当日 00:00 快照中「已入职在岗」且当日可计费的人数（见 {@link BillableDays}）
     * @param stockBase     已锁定的存量基数；免费期内传任意值均可
     * @param inFreePeriod  是否处于三个月免费期
     */
    public static Result daily(int employedCount, int stockBase, boolean inFreePeriod, BillingRule rule) {
        if (employedCount < 0 || stockBase < 0) {
            throw new IllegalArgumentException("counts must be >= 0");
        }
        if (inFreePeriod) {
            return new Result(employedCount, stockBase, 0, rule.serviceUnitPrice(), Money.zero());
        }
        int increment = Math.max(employedCount - stockBase, 0);
        BigDecimal fee = Money.round(rule.serviceUnitPrice().multiply(BigDecimal.valueOf(increment)));
        return new Result(employedCount, stockBase, increment, rule.serviceUnitPrice(), fee);
    }
}
