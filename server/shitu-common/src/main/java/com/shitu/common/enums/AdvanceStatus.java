package com.shitu.common.enums;

/** 薪酬预支：双级审批（D-25）驻场初审 → 项目经理终审 → 拨款。 */
public enum AdvanceStatus implements LabeledEnum {
    SUBMITTED("已提交"),
    SITE_APPROVED("驻场初审通过"),
    PM_APPROVED("经理终审通过"),
    PAID("已拨款"),
    PARTIALLY_REPAID("部分抵扣"),
    REPAID("已抵扣"),
    REJECTED("已驳回");

    private final String label;

    AdvanceStatus(String label) {
        this.label = label;
    }

    @Override
    public String label() {
        return label;
    }
}
