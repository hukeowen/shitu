package com.shitu.advance.domain;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * 发薪日抵扣（spec advance_deduct）：从实发工资中抵扣未还欠款；不足则部分抵扣，余额结转，不计息。
 * 离职时同样调用；离职后仍有余额 → 打平台失信标记（D-22）。
 */
public final class DebtDeduction {

    private DebtDeduction() {
    }

    public record Result(BigDecimal deducted, BigDecimal remainingDebt, BigDecimal netPayAfter) {
        public boolean fullyRepaid() {
            return remainingDebt.signum() == 0;
        }
    }

    public static Result deduct(BigDecimal debt, BigDecimal netPayBeforeDeduction) {
        if (debt.signum() < 0) {
            throw new IllegalArgumentException("debt must be >= 0");
        }
        BigDecimal pay = netPayBeforeDeduction.max(BigDecimal.ZERO);
        BigDecimal deducted = debt.min(pay).setScale(2, RoundingMode.HALF_UP);
        return new Result(deducted, debt.subtract(deducted).setScale(2, RoundingMode.HALF_UP),
                netPayBeforeDeduction.subtract(deducted).setScale(2, RoundingMode.HALF_UP));
    }
}
