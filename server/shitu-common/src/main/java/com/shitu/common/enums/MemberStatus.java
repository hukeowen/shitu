package com.shitu.common.enums;

/** 租户成员 / 平台账号状态。 */
public enum MemberStatus implements LabeledEnum {
    NORMAL("正常"),
    DISABLED("已停用");

    private final String label;

    MemberStatus(String label) {
        this.label = label;
    }

    @Override
    public String label() {
        return label;
    }
}
