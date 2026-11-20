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

-- 账单：恢复演示状态（第一家已结算、第三家已下发待付款），清掉验收提交的付款凭证
DELETE FROM bill_payment WHERE company_id IN ('C10001', 'C10003');
DELETE FROM bill_receivable_payout WHERE company_id = 'C10001';
DELETE FROM company_payee WHERE company_id = 'C10001';
UPDATE monthly_bill SET status = 'ISSUED', settled_at = NULL WHERE company_id = 'C10003' AND status = 'SETTLED';
UPDATE monthly_bill SET status = 'SETTLED', settled_at = COALESCE(settled_at, issued_at) WHERE company_id = 'C10001' AND status = 'ISSUED';

-- 预支：验收流程（advance、madvreject、madvpass）用演示员工申请预支，每跑一次占掉一个人当月的机会并留下 500 元欠款，
-- 跑几轮就没有可预支的人了。把演示数据之后产生的预支申请连同审批、欠款流水一起删掉（演示数据里的预支是同一批建的，
-- 建完一小时之后出现的都是验收产生的）。
CREATE TEMPORARY TABLE ta AS
  SELECT advance_id FROM advance_request WHERE created_at > (SELECT t.first_at + INTERVAL 1 HOUR FROM (SELECT MIN(created_at) AS first_at FROM advance_request) t);
DELETE FROM advance_approval WHERE advance_id IN (SELECT advance_id FROM ta);
DELETE FROM advance_repayment WHERE advance_id IN (SELECT advance_id FROM ta);
DELETE FROM advance_debt_log WHERE advance_id IN (SELECT advance_id FROM ta);
DELETE FROM advance_request WHERE advance_id IN (SELECT advance_id FROM ta);
SELECT 'advances left', COUNT(*) FROM advance_request;

-- 名额：每次验收报名占掉演示岗位一个名额，快占满的补一些，免得演示数据脚本和下次验收匹配不到岗位
UPDATE job SET quota_total = quota_total + 30, quota_remaining = quota_remaining + 30
 WHERE company_id IN ('C10001', 'C10002', 'C10003') AND job_status = 'RECRUITING' AND quota_remaining < 10;
