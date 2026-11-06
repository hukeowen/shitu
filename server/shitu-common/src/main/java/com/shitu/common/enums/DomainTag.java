package com.shitu.common.enums;

/** 公私域标签：派生值，不落库（R-06）。 */
public enum DomainTag implements LabeledEnum {
    PUBLIC("公域"),
    PRIVATE("私域"),
    TEMP_PRIVATE("临时私域");

    private final String label;

    DomainTag(String label) {
        this.label = label;
    }

    @Override
    public String label() {
        return label;
    }
}
