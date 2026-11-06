-- =====================================================================
-- Sprint 5：风控通知模板
-- =====================================================================
INSERT INTO notify_template (template_code, channels, title, content, respect_quiet_hours) VALUES
('JOB_STALE',          'INBOX', '岗位需要更新', '「${jobTitle}」：${message}', 1),
('COMPANY_PENALIZED',  'INBOX', '平台处罚通知', '平台对贵公司作出 ${level} 级处罚，原因：${reason}。如有异议请联系平台运营。', 0);
