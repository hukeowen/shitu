-- =====================================================================
-- Sprint 5：平台中台配置（P-13 引擎参数 / P-14 实名复核 / P-16 通知模板）
-- =====================================================================
ALTER TABLE kyc_review
    ADD COLUMN reviewer_remark VARCHAR(500) NULL COMMENT '复核意见（remark 为申诉人填写的理由）' AFTER reviewer_id,
    ADD KEY idx_kr_user (user_id, review_type, status);

-- 模板可用变量：首次编辑时由系统根据原文案推断并锁定，之后文案只能使用这些变量（防止发出带 ${xxx} 的消息）
ALTER TABLE notify_template
    ADD COLUMN variables VARCHAR(255) NULL COMMENT '逗号分隔的可用变量' AFTER content;

INSERT INTO notify_template (template_code, channels, title, content, respect_quiet_hours) VALUES
('KYC_APPEAL_RESULT', 'INBOX,SMS', '实名申诉处理结果', '${result}', 0);
