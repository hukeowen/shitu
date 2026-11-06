package com.shitu.common.enums;

/** 状态迁移的操作方。 */
public enum ActorRole implements LabeledEnum {
    USER("求职者"),
    SITE("驻场"),
    BROKER("人才经纪人"),
    PM("项目经理"),
    OWNER("劳务公司老板"),
    OPS("平台运营"),
    SYSTEM("系统");

    private final String label;

    ActorRole(String label) {
        this.label = label;
    }

    @Override
    public String label() {
        return label;
    }
}
