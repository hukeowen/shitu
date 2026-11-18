-- 清掉界面验收脚本（e2e.mjs）留下的岗位、成员和公司；求职者及其报名、任职记录保留。只在预览环境的演示库上用：mysql shitu < e2e-clean.sql
START TRANSACTION;
CREATE TEMPORARY TABLE tj AS SELECT job_id FROM job WHERE title LIKE '验收岗位%' AND job_id NOT IN (SELECT job_id FROM application);
CREATE TEMPORARY TABLE tm AS SELECT member_id FROM member WHERE name LIKE '验收驻场%' OR company_id IN (SELECT company_id FROM company WHERE name LIKE '昆山验收%');
CREATE TEMPORARY TABLE tc AS SELECT company_id FROM company WHERE name LIKE '昆山验收%';
DELETE FROM match_result WHERE job_id IN (SELECT job_id FROM tj);
DELETE FROM job_audit WHERE job_id IN (SELECT job_id FROM tj);
DELETE FROM job_weight_daily WHERE job_id IN (SELECT job_id FROM tj);
DELETE FROM job WHERE job_id IN (SELECT job_id FROM tj);
DELETE FROM member_project WHERE member_id IN (SELECT member_id FROM tm);
DELETE FROM notification WHERE recipient_type = 'MEMBER' AND recipient_id IN (SELECT member_id FROM tm);
DELETE FROM member WHERE member_id IN (SELECT member_id FROM tm);
DELETE FROM company WHERE company_id IN (SELECT company_id FROM tc);
COMMIT;
SELECT 'jobs left', COUNT(*) FROM job WHERE title LIKE '验收岗位%';
SELECT 'members left', COUNT(*) FROM member WHERE name LIKE '验收%';
SELECT 'companies left', COUNT(*) FROM company WHERE name LIKE '昆山验收%';
SELECT 'companies total', COUNT(*) FROM company;

-- 账单结算流程（opsBillSettle）会把第三家演示公司的账单结算掉，恢复成「已下发」
UPDATE monthly_bill SET status = 'ISSUED', settled_at = NULL WHERE company_id = 'C10003' AND status = 'SETTLED';
