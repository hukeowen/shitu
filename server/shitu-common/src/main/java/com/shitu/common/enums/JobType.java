package com.shitu.common.enums;

/** 工种（与题库 Q3 选项编码一致，匹配引擎按此软匹配）。 */
public enum JobType implements LabeledEnum {
    ELECTRONICS("电子组装 / SMT"),
    GENERAL("普工 / 流水线"),
    WAREHOUSE("仓储 / 分拣 / 物流"),
    MACHINING("注塑 / 机加工"),
    QC("质检 / 品管");

    private final String label;

    JobType(String label) {
        this.label = label;
    }

    @Override
    public String label() {
        return label;
    }
}
