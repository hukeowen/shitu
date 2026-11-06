-- =====================================================================
-- 计费与结算、薪酬预支、精简版工资
-- =====================================================================

CREATE TABLE billing_rule (
    version             INT           NOT NULL PRIMARY KEY,
    effective_from      DATE          NOT NULL,
    service_unit_price  DECIMAL(6,2)  NOT NULL,
    transfer_unit_price DECIMAL(6,2)  NOT NULL,
    supply_share        DECIMAL(4,2)  NOT NULL,
    free_months         TINYINT       NOT NULL,
    tier_json           JSON          NULL COMMENT 'V1.5 阶梯定价预留',
    created_by          VARCHAR(32)   NULL,
    created_at          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_br_effective (effective_from)
) COMMENT '计费规则（版本化，按 biz_date 选用生效版本）';

CREATE TABLE stock_base (
    company_id  VARCHAR(32) NOT NULL PRIMARY KEY,
    base_count  INT         NOT NULL,
    locked_at   DATETIME(3) NOT NULL,
    locked_by   VARCHAR(32) NOT NULL COMMENT 'SYSTEM 或人工锁定人',
    detail      JSON        NULL COMMENT '锁定时的统计口径快照'
) COMMENT '存量基数（免费期满锁定，锁定后不可变）';

CREATE TABLE billing_daily (
    id               BIGINT        NOT NULL AUTO_INCREMENT PRIMARY KEY,
    biz_date         DATE          NOT NULL,
    company_id       VARCHAR(32)   NOT NULL COMMENT '付费方（任职公司）',
    user_id          VARCHAR(32)   NOT NULL,
    employment_id    VARCHAR(32)   NOT NULL,
    fee_type         VARCHAR(16)   NOT NULL COMMENT 'GROWTH_SERVICE / TRANSFER',
    rule_version     INT           NOT NULL,
    unit_price       DECIMAL(6,2)  NOT NULL,
    payer_amount     DECIMAL(12,2) NOT NULL,
    supply_company_id VARCHAR(32)  NULL,
    supply_amount    DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    platform_amount  DECIMAL(12,2) NOT NULL,
    is_stock         TINYINT(1)    NOT NULL DEFAULT 0,
    created_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_bd_idem (biz_date, company_id, user_id, fee_type) COMMENT '幂等键：重跑不重复计费',
    KEY idx_bd_supply (supply_company_id, biz_date)
) COMMENT '每人每天计费明细。流转费以此为准；服务费仅审计，金额以 company_fee_daily 为准（D-18）';

CREATE TABLE company_fee_daily (
    biz_date           DATE          NOT NULL,
    company_id         VARCHAR(32)   NOT NULL,
    rule_version       INT           NOT NULL,
    in_free_period     TINYINT(1)    NOT NULL,
    employed_count     INT           NOT NULL,
    stock_base         INT           NOT NULL,
    increment_count    INT           NOT NULL,
    service_fee        DECIMAL(12,2) NOT NULL,
    transfer_payable   DECIMAL(12,2) NOT NULL COMMENT '作为接收方应付流转费',
    transfer_receivable DECIMAL(12,2) NOT NULL COMMENT '作为来源方应收 8 元部分',
    created_at         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (biz_date, company_id)
) COMMENT '公司每日计费汇总（增长服务费的计费依据）';

CREATE TABLE monthly_bill (
    bill_id            VARCHAR(32)   NOT NULL PRIMARY KEY,
    company_id         VARCHAR(32)   NOT NULL,
    bill_month         CHAR(7)       NOT NULL COMMENT 'YYYY-MM',
    service_fee        DECIMAL(12,2) NOT NULL,
    transfer_payable   DECIMAL(12,2) NOT NULL,
    transfer_receivable DECIMAL(12,2) NOT NULL,
    status             VARCHAR(16)   NOT NULL DEFAULT 'GENERATED' COMMENT 'GENERATED / ISSUED / DISPUTED / CONFIRMED / SETTLED',
    issued_at          DATETIME(3)   NULL,
    dispute_deadline   DATE          NULL COMMENT '下发后 5 个工作日（D-23）',
    settle_deadline    DATE          NULL COMMENT '次月 15 日',
    settled_at         DATETIME(3)   NULL,
    created_at         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    version            INT           NOT NULL DEFAULT 0,
    UNIQUE KEY uk_mb_company_month (company_id, bill_month)
) COMMENT '企业月账单（流入应付与流出应收分开列示，不轧差）';

CREATE TABLE bill_dispute (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id  VARCHAR(32)  NOT NULL,
    bill_id     VARCHAR(32)  NOT NULL,
    content     VARCHAR(1000) NOT NULL,
    attachments JSON         NULL,
    status      VARCHAR(16)  NOT NULL DEFAULT 'OPEN' COMMENT 'OPEN / ACCEPTED / REJECTED',
    raised_by   VARCHAR(32)  NOT NULL,
    reply       VARCHAR(1000) NULL,
    replied_by  VARCHAR(32)  NULL,
    created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    replied_at  DATETIME(3)  NULL,
    KEY idx_bdp_bill (bill_id)
) COMMENT '账单异议';

CREATE TABLE advance_request (
    advance_id     VARCHAR(32)   NOT NULL PRIMARY KEY,
    user_id        VARCHAR(32)   NOT NULL,
    company_id     VARCHAR(32)   NOT NULL,
    project_id     VARCHAR(32)   NOT NULL,
    employment_id  VARCHAR(32)   NOT NULL,
    amount         DECIMAL(12,2) NOT NULL,
    biz_month      CHAR(7)       NOT NULL COMMENT '占用哪个月的机会',
    status         VARCHAR(16)   NOT NULL DEFAULT 'SUBMITTED',
    repaid_amount  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    paid_at        DATETIME(3)   NULL,
    created_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    version        INT           NOT NULL DEFAULT 0,
    pending_user_id VARCHAR(32)  GENERATED ALWAYS AS (IF(status IN ('SUBMITTED','SITE_APPROVED','PM_APPROVED'), user_id, NULL)) STORED,
    UNIQUE KEY uk_adv_one_pending (pending_user_id) COMMENT '同一时间只有一笔在审批',
    KEY idx_adv_user_month (user_id, biz_month),
    KEY idx_adv_company_status (company_id, status)
) COMMENT '薪酬预支申请（D-25 双级审批）';

CREATE TABLE advance_approval (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id  VARCHAR(32)  NOT NULL,
    advance_id  VARCHAR(32)  NOT NULL,
    step        VARCHAR(16)  NOT NULL COMMENT 'SITE / PM / PAYOUT',
    decision    VARCHAR(16)  NOT NULL COMMENT 'APPROVE / REJECT',
    opinion     VARCHAR(255) NULL,
    operator_id VARCHAR(32)  NOT NULL,
    created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_aa_step (advance_id, step)
) COMMENT '预支审批节点记录';

CREATE TABLE advance_debt_log (
    id           BIGINT        NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id   VARCHAR(32)   NOT NULL COMMENT '拨款公司（D-22：欠款不跨公司承接）',
    user_id      VARCHAR(32)   NOT NULL,
    advance_id   VARCHAR(32)   NULL,
    payslip_id   VARCHAR(32)   NULL,
    change_type  VARCHAR(16)   NOT NULL COMMENT 'PAYOUT（+）/ DEDUCT（−）/ WRITE_OFF',
    amount       DECIMAL(12,2) NOT NULL,
    balance_after DECIMAL(12,2) NOT NULL,
    created_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_adl_user (user_id, created_at)
) COMMENT '预支欠款流水';

CREATE TABLE payroll_batch (
    batch_id     VARCHAR(32)   NOT NULL PRIMARY KEY,
    company_id   VARCHAR(32)   NOT NULL,
    project_id   VARCHAR(32)   NULL,
    pay_month    CHAR(7)       NOT NULL,
    file_key     VARCHAR(255)  NOT NULL,
    headcount    INT           NOT NULL DEFAULT 0,
    gross_total  DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    advance_deduct_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    net_total    DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    status       VARCHAR(16)   NOT NULL DEFAULT 'IMPORTED' COMMENT 'IMPORTED / CONFIRMED / PUBLISHED',
    operator_id  VARCHAR(32)   NOT NULL,
    created_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_pb_scope (company_id, project_id, pay_month)
) COMMENT '工资表导入批次（D-28：V1.0 只导入 + 抵扣 + 展示）';

CREATE TABLE payslip (
    payslip_id      VARCHAR(32)   NOT NULL PRIMARY KEY,
    company_id      VARCHAR(32)   NOT NULL,
    batch_id        VARCHAR(32)   NOT NULL,
    user_id         VARCHAR(32)   NOT NULL,
    employment_id   VARCHAR(32)   NOT NULL,
    pay_month       CHAR(7)       NOT NULL,
    gross_pay       DECIMAL(12,2) NOT NULL,
    social_insurance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    income_tax      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    other_deduct    DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    advance_deduct  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    net_pay         DECIMAL(12,2) NOT NULL,
    items           JSON          NULL COMMENT '工资条明细项',
    created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_ps_user_month (user_id, employment_id, pay_month)
) COMMENT '工资条';

CREATE TABLE payslip_appeal (
    id          BIGINT        NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id  VARCHAR(32)   NOT NULL,
    payslip_id  VARCHAR(32)   NOT NULL,
    user_id     VARCHAR(32)   NOT NULL,
    item_code   VARCHAR(32)   NULL,
    content     VARCHAR(500)  NOT NULL,
    status      VARCHAR(16)   NOT NULL DEFAULT 'OPEN' COMMENT 'OPEN / RESOLVED / REJECTED',
    reply       VARCHAR(500)  NULL,
    handled_by  VARCHAR(32)   NULL,
    created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    handled_at  DATETIME(3)   NULL,
    KEY idx_pa_payslip (payslip_id)
) COMMENT '工资申诉（C-702）';
