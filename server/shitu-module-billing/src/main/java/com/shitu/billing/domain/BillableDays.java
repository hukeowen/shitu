package com.shitu.billing.domain;

import java.time.LocalDate;
import java.time.YearMonth;

/**
 * 计费日切（D-20 / spec E-03）：按每日 00:00 的在岗快照计费 —— 入职当日不计、离职当日不计。
 * <p>即 biz_date 当天计费 ⇔ {@code startDate < bizDate && (endDate == null || endDate > bizDate)}。
 */
public final class BillableDays {

    private BillableDays() {
    }

    public static boolean isBillable(LocalDate startDate, LocalDate endDate, LocalDate bizDate) {
        if (!startDate.isBefore(bizDate)) {
            return false;
        }
        return endDate == null || endDate.isAfter(bizDate);
    }

    /** 某任职在某自然月内的计费天数（E-04：按自然日累计，不做整月折算）。 */
    public static int countInMonth(LocalDate startDate, LocalDate endDate, YearMonth month) {
        int n = 0;
        for (LocalDate d = month.atDay(1); !d.isAfter(month.atEndOfMonth()); d = d.plusDays(1)) {
            if (isBillable(startDate, endDate, d)) {
                n++;
            }
        }
        return n;
    }
}
