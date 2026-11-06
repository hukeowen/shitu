package com.shitu.common.enums;

/** 劳务公司与甲方合作合同的备案审核状态（P-04）。 */
public enum ClientContractStatus implements LabeledEnum {
    PENDING("待审核"),
    APPROVED("已通过"),
    REJECTED("已驳回");

    private final String label;

    ClientContractStatus(String label) {
        this.label = label;
    }

    @Override
    public String label() {
        return label;
    }
}
