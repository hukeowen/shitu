package com.shitu.common.enums;

public enum CompanyStatus implements LabeledEnum {
    PENDING_AUDIT("待审核"),
    REJECTED("入驻驳回"),
    NORMAL("正常"),
    THROTTLED("限流"),
    BANNED("封禁"),
    DEREGISTERED("已注销"),
    BANKRUPT("已倒闭");

    private final String label;

    CompanyStatus(String label) {
        this.label = label;
    }

    @Override
    public String label() {
        return label;
    }

    /** 已注销 / 已倒闭：触发批量解绑，作为来源方不再参与流转分账（R-11）。 */
    public boolean isClosed() {
        return this == DEREGISTERED || this == BANKRUPT;
    }
}
