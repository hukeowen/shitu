-- =====================================================================
-- 预支还款分摊：一次工资抵扣按先到先还拆到各笔预支（C-603 单笔进度页展示本笔的抵扣记录）
-- =====================================================================
CREATE TABLE advance_repayment (
    id              BIGINT        NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id      VARCHAR(32)   NOT NULL,
    user_id         VARCHAR(32)   NOT NULL,
    advance_id      VARCHAR(32)   NOT NULL,
    payslip_id      VARCHAR(32)   NOT NULL,
    amount          DECIMAL(10,2) NOT NULL,
    remaining_after DECIMAL(10,2) NOT NULL COMMENT '本笔抵扣后剩余未还',
    created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_ar_advance (advance_id),
    UNIQUE KEY uk_ar_slip (payslip_id, advance_id)
) COMMENT '预支还款分摊明细';
