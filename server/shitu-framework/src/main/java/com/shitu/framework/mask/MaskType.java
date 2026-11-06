package com.shitu.framework.mask;

/** 脱敏规则。 */
public enum MaskType {
    /** 138****2201 */
    PHONE {
        @Override
        public String apply(String v) {
            return v.length() < 7 ? "****" : v.substring(0, 3) + "****" + v.substring(v.length() - 4);
        }
    },
    /** 3205**********4517 */
    ID_CARD {
        @Override
        public String apply(String v) {
            return v.length() < 8 ? "****" : v.substring(0, 4) + "*".repeat(v.length() - 8) + v.substring(v.length() - 4);
        }
    },
    /** 张* / 欧阳** */
    NAME {
        @Override
        public String apply(String v) {
            return v.isEmpty() ? v : v.substring(0, 1) + "*".repeat(Math.max(1, v.length() - 1));
        }
    };

    public abstract String apply(String value);
}
