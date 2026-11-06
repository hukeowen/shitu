package com.shitu.common.enums;

public enum FeeType implements LabeledEnum {
    GROWTH_SERVICE("增长技术服务费"),
    TRANSFER("人才流转费");

    private final String label;

    FeeType(String label) {
        this.label = label;
    }

    @Override
    public String label() {
        return label;
    }
}
