-- =====================================================================
-- 负责人裁定的四条口径（D-25 修订 / D-57 / D-58 / D-59）
-- =====================================================================

-- D-57：转交人才经纪人时，私域响应窗口重新计 24 小时；同一个窗口只重置一次
ALTER TABLE response_window ADD COLUMN broker_reset TINYINT(1) NOT NULL DEFAULT 0 COMMENT '转交经纪人时已重置过截止时间（D-57）';

-- D-59：离职日在未来的申请，审核通过后先进入 SCHEDULED（待生效），到离职日当天才结束任职并释放
ALTER TABLE resign_request MODIFY COLUMN status VARCHAR(16) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING / SCHEDULED / APPROVED / REJECTED';
ALTER TABLE resign_request ADD KEY idx_rr_scheduled (status, resign_date);

-- D-58：处罚通知只告知等级与原因，不出现限流、降权等字样
UPDATE notify_template SET content = '平台对贵公司作出 ${level} 级处罚，原因：${reason}。如有异议请在 5 个工作日内联系平台运营申诉。'
WHERE template_code = 'COMPANY_PENALIZED';
