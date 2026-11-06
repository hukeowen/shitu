package com.shitu.common;

import java.time.ZoneId;

public final class Constants {
    /** 来源归属为平台时 source_company_id 的取值。 */
    public static final String PLATFORM = "PLATFORM";
    /** 全系统统一时区（spec E-12）。 */
    public static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");

    private Constants() {
    }
}
