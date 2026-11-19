-- 流转分成付款：平台把账单里的「流出应收」付给来源公司，并留下付款记录。
-- 应收与应付不轧差（J-10）：这笔付款和公司是否已付清自己的应付无关。

CREATE TABLE company_payee (
    company_id     VARCHAR(32)  NOT NULL PRIMARY KEY,
    account_name   VARCHAR(100) NOT NULL COMMENT '收款户名',
    bank_name      VARCHAR(100) NOT NULL COMMENT '开户行',
    account_no_enc VARCHAR(255) NOT NULL COMMENT '收款账号（加密）',
    account_tail   VARCHAR(8)   NOT NULL COMMENT '账号后四位，用于展示',
    updated_by     VARCHAR(32)  NOT NULL,
    updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) COMMENT '公司收款账户（老板维护；平台付流转分成时使用）';

CREATE TABLE bill_receivable_payout (
    id            BIGINT        NOT NULL AUTO_INCREMENT PRIMARY KEY,
    bill_id       VARCHAR(32)   NOT NULL,
    company_id    VARCHAR(32)   NOT NULL,
    amount        DECIMAL(12,2) NOT NULL COMMENT '等于账单的流出应收，一次付清',
    paid_date     DATE          NOT NULL,
    bank_ref      VARCHAR(64)   NULL COMMENT '银行流水号',
    voucher_key   VARCHAR(255)  NULL COMMENT '付款回单',
    remark        VARCHAR(255)  NULL,
    account_name  VARCHAR(100)  NOT NULL COMMENT '付款时的收款户名（快照）',
    bank_name     VARCHAR(100)  NOT NULL,
    account_tail  VARCHAR(8)    NOT NULL,
    paid_by       VARCHAR(32)   NOT NULL,
    created_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_brp_bill (bill_id),
    KEY idx_brp_company (company_id)
) COMMENT '流转分成付款记录（平台 → 来源公司，一张账单一条）';
