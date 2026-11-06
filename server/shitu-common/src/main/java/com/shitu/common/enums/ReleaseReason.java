package com.shitu.common.enums;

/** 私域 → 公域的原因码（spec §02 release_reason）。 */
public enum ReleaseReason implements LabeledEnum {
    MANUAL("主动释放"),
    TIMEOUT_24H("24h 超时"),
    INTERVIEW_FAILED("面试未通过"),
    CONFIRM_TIMEOUT("确权超时"),
    NO_SHOW("爽约"),
    CANCELLED("取消报名"),
    BROKER_SLA_TIMEOUT("经纪人超时未处理"),
    RESIGNED("离职"),
    COMPANY_CLOSED("公司注销");

    private final String label;

    ReleaseReason(String label) {
        this.label = label;
    }

    @Override
    public String label() {
        return label;
    }
}
