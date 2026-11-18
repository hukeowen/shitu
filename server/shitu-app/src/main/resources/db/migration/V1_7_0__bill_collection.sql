-- 账单收款闭环：公司上传付款凭证 → 平台确认到账；到期前提醒、逾期催款、逾期自动限流。

CREATE TABLE bill_payment (
    id            BIGINT        NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id    VARCHAR(32)   NOT NULL,
    bill_id       VARCHAR(32)   NOT NULL,
    amount        DECIMAL(12,2) NOT NULL COMMENT '付款金额，须等于账单应付',
    paid_date     DATE          NOT NULL COMMENT '付款日期（公司填写）',
    payer_name    VARCHAR(100)  NOT NULL COMMENT '付款户名',
    bank_ref      VARCHAR(64)   NULL COMMENT '银行流水号 / 回单号',
    voucher_key   VARCHAR(255)  NOT NULL COMMENT '付款凭证文件',
    remark        VARCHAR(255)  NULL,
    status        VARCHAR(16)   NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING 待确认 / CONFIRMED 已到账 / REJECTED 已退回',
    submitted_by  VARCHAR(32)   NOT NULL,
    created_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    reviewed_by   VARCHAR(32)   NULL,
    reviewed_at   DATETIME(3)   NULL,
    review_remark VARCHAR(255)  NULL COMMENT '退回原因 / 到账备注',
    KEY idx_bp_bill (bill_id),
    KEY idx_bp_status (status)
) COMMENT '账单付款凭证（公司提交，平台核对到账后账单置为已结算）';

ALTER TABLE monthly_bill
    ADD COLUMN last_reminded_on DATE NULL COMMENT '最近一次催款日期' AFTER settled_at,
    ADD COLUMN remind_count     INT  NOT NULL DEFAULT 0 COMMENT '已催款次数（含到期前提醒）' AFTER last_reminded_on;

ALTER TABLE company
    ADD COLUMN auto_throttled_bill VARCHAR(32) NULL COMMENT '因哪张账单逾期被系统自动限流；结清后自动恢复' AFTER status_remark;

INSERT INTO sys_param (param_key, param_value, value_type, description) VALUES
('bill.payee_name',                  '（请填写平台收款户名）', 'STRING', '账单收款户名，显示在公司后台的付款说明里'),
('bill.payee_bank',                  '（请填写开户行）',       'STRING', '账单收款开户行'),
('bill.payee_account',               '（请填写收款账号）',     'STRING', '账单收款账号'),
('bill.remind_before_days',          '3',  'INT', '结算截止前几天提醒公司付款（0 = 不提醒）'),
('bill.overdue_remind_interval_days','3',  'INT', '账单逾期后每隔几天催款一次'),
('bill.overdue_throttle_days',       '7',  'INT', '账单逾期满几天自动限流该公司，结清后自动恢复（0 = 不自动限流）');

INSERT INTO notify_template (template_code, channels, title, content, variables, respect_quiet_hours) VALUES
('BILL_NOTICE', 'INBOX,SMS', '账单通知', '${content}', 'content', 1);
