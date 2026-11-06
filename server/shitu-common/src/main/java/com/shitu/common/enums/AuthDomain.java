package com.shitu.common.enums;

/**
 * 三套账号域（02-架构 §11.3）：互不相通，JWT 的 aud 区分，路由前缀 /api/v1/{seeker|tenant|ops} 分别校验。
 */
public enum AuthDomain implements LabeledEnum {
    SEEKER("求职者", "seeker"),
    TENANT("劳务公司", "tenant"),
    OPS("平台运营", "ops");

    private final String label;
    private final String audience;

    AuthDomain(String label, String audience) {
        this.label = label;
        this.audience = audience;
    }

    @Override
    public String label() {
        return label;
    }

    /** JWT aud 与 URL 前缀。 */
    public String audience() {
        return audience;
    }

    public static AuthDomain ofAudience(String aud) {
        for (AuthDomain d : values()) {
            if (d.audience.equals(aud)) {
                return d;
            }
        }
        throw new IllegalArgumentException("unknown audience " + aud);
    }
}
