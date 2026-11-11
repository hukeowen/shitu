-- =====================================================================
-- 短信免打扰时段（P-16）：勾选了「遵守免打扰」的模板，夜间的短信延迟到早上再发（站内信不受影响）
-- =====================================================================
CREATE TABLE sms_deferred (
    id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    recipient_type VARCHAR(16)  NOT NULL,
    recipient_id   VARCHAR(32)  NOT NULL,
    template_code  VARCHAR(48)  NOT NULL,
    content        VARCHAR(500) NOT NULL,
    send_after     DATETIME(3)  NOT NULL,
    status         VARCHAR(16)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING / SENT',
    created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    sent_at        DATETIME(3)  NULL,
    KEY idx_sd_due (status, send_after)
) COMMENT '免打扰时段内延迟发送的通知短信';

INSERT INTO sys_param (param_key, param_value, value_type, description) VALUES
('sms.quiet_start', '22:00', 'TIME', 'P-16 短信免打扰开始时间'),
('sms.quiet_end',   '08:00', 'TIME', 'P-16 短信免打扰结束时间');

-- =====================================================================
-- 合同到期提醒（J-13 / C-503）：到期前 60 / 30 / 7 天提醒本人与项目经理，到期后状态置为「已到期」
-- =====================================================================
ALTER TABLE contract
    ADD COLUMN expiry_reminded SMALLINT NULL COMMENT '已提醒过的最小提前天数（60 / 30 / 7）' AFTER ended_at,
    ADD KEY idx_contract_expiry (status, term_end);

INSERT INTO notify_template (template_code, channels, title, content, respect_quiet_hours) VALUES
('CONTRACT_EXPIRING_SEEKER',  'INBOX',     '劳动合同即将到期', '你与${companyName}的劳动合同将在 ${days} 天后（${termEnd}）到期，续签事宜请联系驻场。', 1),
('CONTRACT_EXPIRING_MANAGER', 'INBOX',     '员工合同即将到期', '${seekerName} 的劳动合同将在 ${days} 天后（${termEnd}）到期，请安排续签或提前沟通。', 1),
('CONTRACT_EXPIRED_MANAGER',  'INBOX,SMS', '员工合同已到期',   '${seekerName} 的劳动合同已于 ${termEnd} 到期，请尽快续签或办理离职。', 1);
