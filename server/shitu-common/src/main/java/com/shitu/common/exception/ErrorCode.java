package com.shitu.common.exception;

/**
 * 业务错误码，按模块分段：SYS 通用 / LC 生命周期 / APP 报名 / BIL 计费 / ADV 预支。
 * 前端按 code 做差异化处理，message 可直接展示给用户。
 */
public enum ErrorCode {
    OK("0", "成功"),
    SYS_BAD_REQUEST("SYS_4000", "请求参数错误"),
    SYS_UNAUTHORIZED("SYS_4010", "请先登录"),
    SYS_FORBIDDEN("SYS_4030", "无权执行该操作"),
    SYS_NOT_FOUND("SYS_4040", "数据不存在"),
    SYS_CONFLICT("SYS_4090", "数据已被修改，请刷新后重试"),
    SYS_IDEMPOTENT_REPLAY("SYS_4091", "请求正在处理或已处理"),
    SYS_INTERNAL("SYS_5000", "系统繁忙，请稍后再试"),

    LC_ILLEGAL_TRANSITION("LC_4001", "当前状态不允许该操作"),
    LC_ACTOR_NOT_ALLOWED("LC_4002", "该角色不能执行此操作"),
    LC_MATCH_LOCKED("LC_4003", "你已报名岗位，面试结果出来前不能重新匹配"),
    LC_REASON_REQUIRED("LC_4004", "必须填写原因"),
    LC_SOURCE_IMMUTABLE("LC_4005", "来源归属不可修改"),

    APP_QUOTA_FULL("APP_4001", "该岗位名额已满，请重新匹配"),
    APP_DUPLICATE("APP_4002", "你已有进行中的报名"),
    APP_ID_MISMATCH("APP_4003", "两次输入的身份证号码不一致，请重新输入"),
    APP_NOT_FROM_MATCH("APP_4004", "只能报名匹配结果中的岗位"),

    ADV_NOT_ELIGIBLE("ADV_4001", "暂不满足预支条件"),

    BIL_RULE_MISSING("BIL_5001", "未找到生效的计费规则");

    private final String code;
    private final String message;

    ErrorCode(String code, String message) {
        this.code = code;
        this.message = message;
    }

    public String code() {
        return code;
    }

    public String message() {
        return message;
    }
}
