package com.shitu.common.enums;

/** 班次（与题库 Q5 选项编码一致）。 */
public enum ShiftType implements LabeledEnum {
    DAY("白班"),
    NIGHT("夜班"),
    TWO_SHIFT("两班倒"),
    LONG_DAY("长白班");

    private final String label;

    ShiftType(String label) {
        this.label = label;
    }

    @Override
    public String label() {
        return label;
    }
}
