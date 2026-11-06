package com.shitu.common.enums;

/** 注册渠道（文档节点二），决定 source / bound 的初始值。 */
public enum ChannelType implements LabeledEnum {
    COMPANY_QR("劳务公司二维码/分享链接", true),
    EMPLOYEE_SHARE("已入职员工二维码/分享链接", false),
    ORGANIC("自主搜索", false),
    BRAND_AD("品牌广告", false),
    ROSTER_IMPORT("花名册导入", true);

    private final String label;
    private final boolean bindsCompany;

    ChannelType(String label, boolean bindsCompany) {
        this.label = label;
        this.bindsCompany = bindsCompany;
    }

    @Override
    public String label() {
        return label;
    }

    /** true = 注册即写入 source/bound 为该公司（私域）；false = source=PLATFORM（公域）。 */
    public boolean bindsCompany() {
        return bindsCompany;
    }
}
