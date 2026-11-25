-- D-62 ② 问卷改版（2026-11-23 负责人拍板）：不问期望工资；第 4 题问年龄（数字输入）；
-- 第 5 题班次为「接受 / 不接受 / 看情况」三态矩阵，「看情况」只做中性追问、不给金额锚点；
-- 第 6 题住宿只问要不要安排住，不再列福利菜单。工资改为按岗位到手工资排位打分（MatchScorer）。
-- 题库 v1 归档保留：旧匹配会话的答案 / 画像按 v1 结构照常读取与回放。

-- 题型参数：数字题 {min,max,unit}，矩阵题 {followUp}；单选题为 NULL
ALTER TABLE quiz_question
    ADD COLUMN config JSON NULL COMMENT '题型参数：NUMBER {min,max,unit} / MATRIX {followUp}' AFTER options,
    MODIFY COLUMN question_type VARCHAR(16) NOT NULL COMMENT 'JUDGE 判断题 / CHOICE 选择题 / NUMBER 数字题 / MATRIX 矩阵题';

-- 版本号取当前最大值 + 1（平台可能已经建过草稿，避免主键冲突）
SET @v2 = (SELECT COALESCE(MAX(version_id), 0) + 1 FROM quiz_version);

-- 同一时间只能有一个生效版本（uk_quiz_one_active）：先归档，再插入新的生效版本
UPDATE quiz_version SET status = 'ARCHIVED' WHERE status = 'ACTIVE';

INSERT INTO quiz_version (version_id, name, status, published_by, published_at) VALUES
(@v2, 'v2.0 产品改版：不问期望工资', 'ACTIVE', 'SYSTEM', CURRENT_TIMESTAMP(3));

-- 第 4 题是年龄：年龄过滤在打分器里本来就是硬过滤，但题库要求「硬过滤题排在前面」，这里按软权重题登记，不影响过滤
INSERT INTO quiz_question (version_id, seq, question_type, stem, hint, profile_field, match_role, options, config) VALUES
(@v2, 1, 'JUDGE', '你能接受进工厂上班吗？', '车间流水线 / 仓储 / 装配等岗位', 'accept_factory', 'HARD_FILTER',
 '[{"code":"A","label":"能接受，我就是找厂里的活儿","value":"YES"},{"code":"B","label":"可以试试，但想先了解环境","value":"MAYBE"},{"code":"C","label":"不接受进厂，只看厂外岗位","value":"NO"}]', NULL),
(@v2, 2, 'JUDGE', '是否只考虑某个城市 / 区域？', '选择后仅匹配该地域岗位', 'locked_region', 'HARD_FILTER',
 '[{"code":"A","label":"是，只看我选的地方","value":"LOCKED","needRegion":true},{"code":"B","label":"不限，哪里合适去哪里","value":"ANY"}]', NULL),
(@v2, 3, 'CHOICE', '你想做哪一类工种？', NULL, 'expect_job_type', 'SOFT_WEIGHT',
 '[{"code":"A","label":"电子组装 / SMT","value":"ELECTRONICS"},{"code":"B","label":"普工 / 流水线","value":"GENERAL"},{"code":"C","label":"仓储 / 分拣 / 物流","value":"WAREHOUSE"},{"code":"D","label":"注塑 / 机加工","value":"MACHINING"},{"code":"E","label":"质检 / 品管","value":"QC"},{"code":"F","label":"都可以","value":"ANY"}]', NULL),
(@v2, 4, 'NUMBER', '你今年多大？', '用来避开招不了你这个年龄的厂', 'age', 'SOFT_WEIGHT',
 '[]', '{"min":16,"max":65,"unit":"岁"}'),
(@v2, 5, 'MATRIX', '这几种班你能不能上？', '每一行选一个；拿不准就选「看情况」', 'shift_matrix', 'SOFT_WEIGHT',
 '[{"code":"DAY","label":"白班","value":"DAY"},{"code":"TWO_SHIFT","label":"两班倒","value":"TWO_SHIFT"},{"code":"NIGHT","label":"夜班","value":"NIGHT"},{"code":"LONG_DAY","label":"长白班","sub":"每天 12 小时左右","value":"LONG_DAY"}]',
 '{"followUp":"什么情况下可以？"}'),
(@v2, 6, 'CHOICE', '要不要厂里安排住？', NULL, 'dorm_req', 'SOFT_WEIGHT',
 '[{"code":"A","label":"需要","value":"NEEDED"},{"code":"B","label":"不需要","value":"NOT_NEEDED"}]', NULL),
(@v2, 7, 'CHOICE', '相关工作做过多久？', NULL, 'work_years', 'SOFT_WEIGHT',
 '[{"code":"A","label":"没做过","value":0},{"code":"B","label":"1 年以内","value":1},{"code":"C","label":"1 – 3 年","value":2},{"code":"D","label":"3 年以上","value":3}]', NULL);
