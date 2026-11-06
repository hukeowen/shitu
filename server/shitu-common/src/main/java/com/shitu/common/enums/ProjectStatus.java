package com.shitu.common.enums;

/** 项目状态。 */
public enum ProjectStatus implements LabeledEnum {
    ACTIVE("进行中"),
    CLOSED("已结束");

    private final String label;

    ProjectStatus(String label) {
        this.label = label;
    }

    @Override
    public String label() {
        return label;
    }
}
