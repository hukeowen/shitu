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
    SYS_TOO_MANY_REQUESTS("SYS_4290", "操作太频繁，请稍后再试"),

    AUTH_PHONE_INVALID("AUTH_4000", "请输入正确的 11 位手机号"),
    AUTH_CODE_INVALID("AUTH_4001", "验证码错误或已过期"),
    AUTH_CODE_TOO_FREQUENT("AUTH_4002", "验证码发送太频繁，请稍后再试"),
    AUTH_CODE_DAILY_LIMIT("AUTH_4003", "今日验证码次数已用完，请明天再试"),
    AUTH_CAPTCHA_REQUIRED("AUTH_4004", "请先完成图形验证"),
    AUTH_CAPTCHA_INVALID("AUTH_4005", "图形验证码错误，请重新输入"),
    AUTH_ACCOUNT_DISABLED("AUTH_4006", "账号已停用，请联系管理员"),
    AUTH_PASSWORD_INVALID("AUTH_4008", "用户名或密码错误"),
    AUTH_LOCKED("AUTH_4009", "密码错误次数过多，请 15 分钟后再试"),
    AUTH_PASSWORD_WEAK("AUTH_4010", "密码至少 8 位，且同时包含字母和数字"),
    AUTH_REFRESH_INVALID("AUTH_4011", "登录已失效，请重新登录"),
    AUTH_TICKET_INVALID("AUTH_4012", "入驻申请已过期，请重新验证手机号"),
    AUTH_PASSWORD_CHANGE_REQUIRED("AUTH_4013", "首次登录或密码被重置，请先修改密码"),

    TEN_COMPANY_EXISTS("TEN_4001", "该统一社会信用代码已入驻平台"),
    TEN_PHONE_TAKEN("TEN_4002", "该手机号已是平台上某家公司的成员"),
    TEN_COMPANY_NOT_ACTIVE("TEN_4003", "公司尚未通过入驻审核或已被限制"),
    TEN_CONTRACT_REQUIRED("TEN_4004", "该甲方没有审核通过且在有效期内的合作合同"),
    TEN_LAST_OWNER("TEN_4005", "公司至少要保留一名启用状态的老板"),
    TEN_PROJECT_SCOPE("TEN_4006", "只能操作你负责的项目"),
    TEN_ILLEGAL_STATUS("TEN_4007", "当前状态不允许该操作"),
    TEN_FILE_INVALID("TEN_4008", "文件格式或大小不符合要求"),

    JOB_ILLEGAL_STATUS("JOB_4001", "当前岗位状态不允许该操作"),
    JOB_QUOTA_INVALID("JOB_4002", "名额不能少于已被报名占用的数量"),
    JOB_FIELD_INVALID("JOB_4003", "岗位信息填写有误"),

    PLT_USERNAME_TAKEN("PLT_4001", "用户名已存在"),
    PLT_LAST_SUPER("PLT_4002", "至少保留一名启用状态的超级管理员"),

    LC_ILLEGAL_TRANSITION("LC_4001", "当前状态不允许该操作"),
    LC_ACTOR_NOT_ALLOWED("LC_4002", "该角色不能执行此操作"),
    LC_MATCH_LOCKED("LC_4003", "你已报名岗位，面试结果出来前不能重新匹配"),
    LC_REASON_REQUIRED("LC_4004", "必须填写原因"),
    LC_SOURCE_IMMUTABLE("LC_4005", "来源归属不可修改"),

    APP_QUOTA_FULL("APP_4001", "该岗位名额已满，请重新匹配"),
    APP_DUPLICATE("APP_4002", "你已有进行中的报名"),
    APP_ID_MISMATCH("APP_4003", "两次输入的身份证号码不一致，请重新输入"),
    APP_NOT_FROM_MATCH("APP_4004", "只能报名匹配结果中的岗位"),
    KYC_ID_INVALID("APP_4005", "身份证号码不正确，请核对后重新输入"),
    KYC_UNDERAGE("APP_4006", "未满 16 周岁，暂时不能使用求职服务"),
    KYC_ID_OCCUPIED("APP_4007", "该身份证已绑定其他账号，可以找回原账号或申诉换绑"),
    KYC_BLACKLISTED("APP_4008", "账号存在平台级失信记录，暂不能报名，可提交申诉"),
    KYC_VERIFY_FAILED("APP_4009", "姓名与身份证号码不一致，请核对后重试"),
    KYC_REQUIRED("APP_4010", "报名前请先完成实名认证"),
    APP_UNDERAGE("APP_4011", "未满 18 周岁，暂不能报名岗位"),
    APP_DISCLAIMER_REQUIRED("APP_4012", "报名前请先阅读并同意《求职告知书》"),
    KYC_ALREADY("APP_4013", "已完成实名认证，实名信息不可修改"),
    KYC_TOO_MANY("APP_4014", "今日实名认证次数已用完，请明天再试"),

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
