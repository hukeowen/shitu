package com.shitu.common.enums;

public enum ContractStatus implements LabeledEnum {
    PENDING_SIGN("待签署"),
    EFFECTIVE("生效中"),
    EXPIRED("已到期"),
    DISSOLVED("已解除"),
    TERMINATED("已终止"),
    VOIDED("已作废");

    private final String label;

    ContractStatus(String label) {
        this.label = label;
    }

    @Override
    public String label() {
        return label;
    }
}
