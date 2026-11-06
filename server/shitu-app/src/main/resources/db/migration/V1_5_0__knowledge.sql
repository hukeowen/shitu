-- =====================================================================
-- Sprint 5：岗位知识库（T-305 / C-409）通知模板
-- 未命中问题在 kb_query_log 中以 answered_by = 'HUMAN_PENDING' AND hit_entry_id IS NULL 表示"待补充"；
-- 公司补充答案后回填 hit_entry_id，忽略则 answered_by = 'IGNORED'。
-- =====================================================================
ALTER TABLE kb_query_log ADD KEY idx_kql_pending (company_id, answered_by, hit_entry_id);

INSERT INTO notify_template (template_code, channels, title, content, respect_quiet_hours) VALUES
('KB_QUESTION_PENDING', 'INBOX', '求职者提问待回复', '「${jobTitle}」有求职者提问：${question}', 1),
('KB_ANSWERED',         'INBOX', '你的提问有回复了', '你关于「${jobTitle}」的提问「${question}」已有回复：${answer}', 1);
