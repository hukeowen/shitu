package com.shitu.common.enums;

/** 匹配范围：派生值，不落库。 */
public enum MatchScope implements LabeledEnum {
    NONE("不展示岗位"),
    ALL_PLATFORM("全平台"),
    OWN_COMPANY("仅本公司"),
    INTERNAL_TRANSFER_ONLY("仅本公司内部调岗"),
    LOCKED("不可匹配");

    private final String label;

    MatchScope(String label) {
        this.label = label;
    }

    @Override
    public String label() {
        return label;
    }
}
