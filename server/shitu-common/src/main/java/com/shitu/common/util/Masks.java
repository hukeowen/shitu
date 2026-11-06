package com.shitu.common.util;

/** 展示用脱敏（与 framework 的 @Mask 序列化规则一致，供不经过 Jackson 的场景使用，如日志、导出）。 */
public final class Masks {

    private Masks() {
    }

    /** 138****2201 */
    public static String phone(String phone) {
        if (phone == null || phone.length() < 7) {
            return phone;
        }
        return phone.substring(0, 3) + "****" + phone.substring(phone.length() - 4);
    }

    /** 张* / 欧阳** */
    public static String name(String name) {
        if (name == null || name.isEmpty()) {
            return name;
        }
        return name.charAt(0) + "*".repeat(Math.max(1, name.length() - 1));
    }

    public static boolean isMobile(String phone) {
        return phone != null && phone.matches("^1[3-9]\\d{9}$");
    }
}
