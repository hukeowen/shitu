-- =====================================================================
-- Sprint 4：人才经纪人流转池
-- =====================================================================

ALTER TABLE broker_case
    ADD COLUMN contact_reminded_at DATETIME(3) NULL COMMENT '2 小时联系超时提醒已发送（只提醒一次）' AFTER contacted_at;

INSERT INTO notify_template (template_code, channels, title, content, respect_quiet_hours) VALUES
('BROKER_RECOMMENDED',     'INBOX,SMS', '专属顾问为你推荐了岗位', '你的专属顾问为你推荐了「${jobTitle}」，打开仕兔查看岗位详情并确认报名。', 1),
('BROKER_CONTACT_OVERDUE', 'INBOX',     '流转工单联系超时',       '${seekerName} 转入流转池已超过 2 小时仍未联系，请尽快跟进，24 小时内未出结果将自动释放至公域。', 0);
