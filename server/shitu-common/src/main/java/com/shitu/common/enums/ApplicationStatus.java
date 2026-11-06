package com.shitu.common.enums;

/** 报名状态，对应 C 端「我的报备」标签（D-09：已去掉「待确认」）。 */
public enum ApplicationStatus implements LabeledEnum {
    PENDING_INTERVIEW("待面试"),
    PENDING_CONFIRM("待确权"),
    EMPLOYED("已入职"),
    CANCELLED("已取消"),
    TIMEOUT("已超时"),
    INTERVIEW_FAILED("面试未通过"),
    NO_SHOW("爽约");

    private final String label;

    ApplicationStatus(String label) {
        this.label = label;
    }

    @Override
    public String label() {
        return label;
    }

    public boolean isActive() {
        return this == PENDING_INTERVIEW || this == PENDING_CONFIRM;
    }
}
