package com.shitu.common.enums;

/** 平台运营账号角色（P-15）。 */
public enum OpsRole implements LabeledEnum {
    SUPER("超级管理员"),
    OPERATOR("运营"),
    FINANCE("财务"),
    RISK("风控");

    private final String label;

    OpsRole(String label) {
        this.label = label;
    }

    @Override
    public String label() {
        return label;
    }
}
