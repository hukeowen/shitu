-- 运营中台「系统运行状态」按天统计短信发送 / 失败条数：给 sms_log 加按时间的索引，避免每次打开工作台全表扫描。
ALTER TABLE sms_log ADD KEY idx_sms_time (created_at, status);
