-- 驻场提醒：跟进提醒加发短信；每天晚上和早上各发一条汇总，夜里到期的报名不再无人知晓。

-- 「剩 4 小时 / 1 小时」的跟进提醒原来只发站内信，驻场不打开页面收不到。加发短信；夜间免打扰时段内的短信顺延到早上，
-- 夜里到期的由下面的晚间汇总提前提醒。
UPDATE notify_template SET channels = 'INBOX,SMS', respect_quiet_hours = 1 WHERE template_code = 'FOLLOW_UP_REMINDER';

INSERT INTO notify_template (template_code, channels, title, content, variables, respect_quiet_hours) VALUES
('STAFF_DIGEST', 'INBOX,SMS', '待办提醒', '${content}', 'content', 0);

INSERT INTO sys_param (param_key, param_value, value_type, description) VALUES
('notify.staff_digest_enabled', 'true', 'BOOL', '是否给驻场 / 项目经理发每日待办汇总（晚 20:30 提醒夜间到期的报名，早 8:30 提醒当天到期与未知悉的报名）');
