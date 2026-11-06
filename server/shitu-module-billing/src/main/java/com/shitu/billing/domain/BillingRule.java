package com.shitu.billing.domain;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Objects;

/**
 * 计费规则（版本化，按生效日选用）。V1.0 增长服务费统一单价，阶梯定价属 V1.5（R-10）。
 *
 * @param version          规则版本号
 * @param effectiveFrom    生效日（含）
 * @param serviceUnitPrice 增长技术服务费单价，元/人/天，V1.0 = 0.10
 * @param transferUnitPrice 人才流转费单价，元/人/天 = 10.00
 * @param supplyShare      供给方分成比例 = 0.80
 * @param freeMonths       新入驻免费期月数 = 3
 */
public record BillingRule(int version, LocalDate effectiveFrom, BigDecimal serviceUnitPrice,
                          BigDecimal transferUnitPrice, BigDecimal supplyShare, int freeMonths) {

    public static final BillingRule V1 = new BillingRule(1, LocalDate.of(2026, 1, 1),
            new BigDecimal("0.10"), new BigDecimal("10.00"), new BigDecimal("0.80"), 3);

    public BillingRule {
        Objects.requireNonNull(effectiveFrom);
        Money.requireNonNegative(serviceUnitPrice, "serviceUnitPrice");
        Money.requireNonNegative(transferUnitPrice, "transferUnitPrice");
        if (supplyShare.signum() < 0 || supplyShare.compareTo(BigDecimal.ONE) > 0) {
            throw new IllegalArgumentException("supplyShare must be within [0,1]");
        }
        if (freeMonths < 0) {
            throw new IllegalArgumentException("freeMonths must be >= 0");
        }
    }
}
