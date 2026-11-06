package com.shitu.common.enums;

public enum JobStatus implements LabeledEnum {
    PENDING_AUDIT("待审核"),
    RECRUITING("招聘中"),
    PAUSED("暂停招聘"),
    OFFLINE("已下架"),
    FORCE_OFFLINE("强制下架");

    private final String label;

    JobStatus(String label) {
        this.label = label;
    }

    @Override
    public String label() {
        return label;
    }
}
