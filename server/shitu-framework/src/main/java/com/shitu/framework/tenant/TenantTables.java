package com.shitu.framework.tenant;

import java.util.Set;

/**
 * 全部数据表的租户分类（02-架构 §11）。新增表必须登记在这里，否则单元测试失败、
 * 且租户请求访问该表会被拦截器拒绝（fail-closed）。
 */
public final class TenantTables {

    /** 租户表：带 company_id，租户请求自动追加 {@code company_id = 当前公司}。 */
    public static final Set<String> TENANT = Set.of(
            "company", "member", "member_project", "client_contract", "project", "channel_code",
            "job", "job_audit",
            "application", "interview_notice", "response_window",
            "employment", "employment_change_log", "duty_absence", "contract", "resign_request",
            "roster_batch", "roster_row",
            "broker_case", "ai_report", "broker_recommendation", "kb_entry", "kb_query_log",
            "stock_base", "billing_daily", "company_fee_daily", "monthly_bill", "bill_dispute",
            "advance_request", "advance_approval", "advance_debt_log", "advance_repayment", "payroll_batch", "payslip", "payslip_appeal",
            "incident");

    /**
     * 共享表：跨租户数据（求职者是平台用户，不属于某一家公司），不自动过滤。
     * 租户请求访问时必须由业务层做「关系」数据范围校验（当前绑定 / 有报名 / 有任职）。
     */
    public static final Set<String> SHARED = Set.of(
            "user", "user_resume", "user_status_log", "disclaimer_consent",
            "client_company", "quiz_version", "quiz_question", "engine_config",
            "match_session", "match_result", "notification", "notify_template",
            "billing_rule", "holiday", "sys_param");

    /** 平台专属表：租户请求一律禁止访问（含降权数据，R-14）。 */
    public static final Set<String> PLATFORM_ONLY = Set.of(
            "ops_admin", "audit_log", "shedlock", "outbox_event", "channel_visit", "sms_log",
            "biz_sequence", "auth_session",
            "follow_up_reminder", "esign_callback_log",
            "kyc_record", "kyc_review", "blacklist", "feedback",
            "job_weight_daily", "complaint", "credit_score_log", "risk_event", "penalty",
            "flyway_schema_history");

    public static final String TENANT_COLUMN = "company_id";

    private TenantTables() {
    }

    public static String normalize(String table) {
        return table.replace("`", "").toLowerCase();
    }
}
