package com.shitu.common.enums;

/**
 * 用户全局状态机主字段。
 * <p>按决策 D-08 只保留 6 个运行态：离职 / 各类释放统一回到 {@link #PUBLIC_SEEKING}，
 * 原因记录在 {@code last_release_reason}，不再设独立的 RESIGNED / UNFOLLOWED 状态。
 */
public enum UserStatus implements LabeledEnum {
    GUEST("游客"),
    PUBLIC_SEEKING("公域求职"),
    PRIVATE_PENDING("私域待匹配"),
    PENDING_INTERVIEW("待面试"),
    PENDING_CONFIRM("待确权"),
    EMPLOYED("已入职在岗");

    private final String label;

    UserStatus(String label) {
        this.label = label;
    }

    @Override
    public String label() {
        return label;
    }

    /** 报名锁定期：待面试 / 待确权，不可再匹配、不可再报名（R-03 / D-07）。 */
    public boolean isApplicationLocked() {
        return this == PENDING_INTERVIEW || this == PENDING_CONFIRM;
    }
}
