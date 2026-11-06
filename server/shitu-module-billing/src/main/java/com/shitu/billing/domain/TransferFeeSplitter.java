package com.shitu.billing.domain;

import com.shitu.common.Constants;

import java.math.BigDecimal;
import java.util.Objects;
import java.util.Optional;

/**
 * 人才流转费分账（R-11 / D-19 / D-24）：接收方（当前任职公司）付 10 元/人/天。
 * <ul>
 *   <li>来源 = 任职公司：不是流转，不收流转费；</li>
 *   <li>来源 = 平台，或来源公司已注销 / 倒闭，或来源公司被取消收费服务权限：10 元全归平台；</li>
 *   <li>其他：来源公司 8 元，平台 2 元。</li>
 * </ul>
 */
public final class TransferFeeSplitter {

    private TransferFeeSplitter() {
    }

    /** 来源公司的分账资格。 */
    public enum SourceEligibility {
        /** 正常参与分账。 */
        ELIGIBLE,
        /** 已注销 / 已倒闭：平台继承权益。 */
        CLOSED,
        /** 诚信分 &lt; 30 或 3 级处罚：永久取消收费服务权限（D-24）。 */
        REVOKED
    }

    public record Split(String payerCompanyId, BigDecimal payerAmount, String supplyCompanyId,
                        BigDecimal supplyAmount, BigDecimal platformAmount) {
    }

    public static boolean isTransfer(String sourceCompanyId, String employerCompanyId) {
        return !Objects.equals(sourceCompanyId, employerCompanyId);
    }

    public static Optional<Split> daily(String sourceCompanyId, SourceEligibility sourceEligibility,
                                        String employerCompanyId, BillingRule rule) {
        Objects.requireNonNull(sourceCompanyId, "sourceCompanyId");
        Objects.requireNonNull(employerCompanyId, "employerCompanyId");
        if (!isTransfer(sourceCompanyId, employerCompanyId)) {
            return Optional.empty();
        }
        BigDecimal total = Money.round(rule.transferUnitPrice());
        boolean platformTakesAll = Constants.PLATFORM.equals(sourceCompanyId)
                || sourceEligibility != SourceEligibility.ELIGIBLE;
        if (platformTakesAll) {
            return Optional.of(new Split(employerCompanyId, total, null, Money.zero(), total));
        }
        BigDecimal supply = Money.round(total.multiply(rule.supplyShare()));
        return Optional.of(new Split(employerCompanyId, total, sourceCompanyId, supply, total.subtract(supply)));
    }
}
