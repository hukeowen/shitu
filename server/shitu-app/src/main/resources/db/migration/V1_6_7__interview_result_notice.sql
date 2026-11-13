-- 面试结果通知求职者（验收巡检发现：面试通过后到发起签约之间求职者收不到任何消息）
INSERT INTO notify_template (template_code, channels, title, content, respect_quiet_hours) VALUES
('INTERVIEW_PASSED', 'INBOX,SMS', '面试通过', '恭喜通过面试！驻场老师会在 24 小时内为你办理入职并发起线上签约，请留意消息。', 0),
('INTERVIEW_FAILED', 'INBOX',     '面试结果', '很遗憾，这次面试没有通过。你可以打开仕兔重新问薪，匹配其他岗位。', 1);

-- 签约提醒不再在正文里带签署链接（站内信有跳转，短信引导打开仕兔）
UPDATE notify_template SET content = '恭喜通过面试！请在 24 小时内打开仕兔，在「我的合同」里完成线上签约。', variables = NULL WHERE template_code = 'CONTRACT_SIGN_REQUIRED';
