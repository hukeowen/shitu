package com.shitu.billing.domain;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** 金额统一 2 位小数、四舍五入（HALF_UP）。 */
public final class Money {
    public static final int SCALE = 2;

    private Money() {
    }

    public static BigDecimal of(String v) {
        return new BigDecimal(v).setScale(SCALE, RoundingMode.HALF_UP);
    }

    public static BigDecimal round(BigDecimal v) {
        return v.setScale(SCALE, RoundingMode.HALF_UP);
    }

    public static BigDecimal zero() {
        return BigDecimal.ZERO.setScale(SCALE);
    }

    static void requireNonNegative(BigDecimal v, String name) {
        if (v == null || v.signum() < 0) {
            throw new IllegalArgumentException(name + " must be >= 0");
        }
    }
}
