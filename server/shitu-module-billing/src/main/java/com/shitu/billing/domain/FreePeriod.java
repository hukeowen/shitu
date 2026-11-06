package com.shitu.billing.domain;

import java.time.LocalDate;

/**
 * 三个月免费期与存量基数锁定（文档 2.2，J-07）。
 * <p>免费期 = [入驻日, 入驻日 + N 个月)；期内导入的员工全部计入存量基数，期间不收增长服务费；
 * 到期首日锁定存量基数，此后增量开始计费。
 */
public final class FreePeriod {

    private FreePeriod() {
    }

    /** 免费期最后一天（含）。 */
    public static LocalDate lastFreeDay(LocalDate onboardDate, int freeMonths) {
        return onboardDate.plusMonths(freeMonths).minusDays(1);
    }

    public static boolean isInFreePeriod(LocalDate onboardDate, int freeMonths, LocalDate bizDate) {
        return !bizDate.isAfter(lastFreeDay(onboardDate, freeMonths));
    }

    /** 存量基数锁定日：免费期结束后的第一天。 */
    public static LocalDate lockDate(LocalDate onboardDate, int freeMonths) {
        return onboardDate.plusMonths(freeMonths);
    }
}
