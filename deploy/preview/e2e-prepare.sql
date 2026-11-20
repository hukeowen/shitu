-- 跑界面验收（e2e.mjs）之前执行：把演示账单摆回可测试的状态。只适用于预览环境的演示数据。
--   mysql shitu < e2e-prepare.sql
-- billPay 用第三家演示公司的账单走「提交凭证 → 退回 → 重交 → 确认到账」；
-- opsBillDispute / opsBillSettle 用第一家演示公司的账单走「异议 → 驳回」和「直接登记结算」。
DELETE FROM bill_payment WHERE company_id IN ('C10001', 'C10003');
-- payout 用第一家演示公司走「登记收款账户 → 平台登记流转分成付款」
DELETE FROM bill_receivable_payout WHERE company_id = 'C10001';
DELETE FROM company_payee WHERE company_id = 'C10001';
UPDATE monthly_bill SET status = 'ISSUED', settled_at = NULL WHERE company_id IN ('C10001', 'C10003') AND status = 'SETTLED';
SELECT bill_id, company_id, bill_month, status, dispute_deadline, settle_deadline FROM monthly_bill ORDER BY company_id;

-- 结算截止日不早于异议期结束后 3 天（和出账规则一致；演示账单是补发的，原来的截止日落在异议期里）
UPDATE monthly_bill SET settle_deadline = dispute_deadline + INTERVAL 3 DAY
 WHERE dispute_deadline IS NOT NULL AND settle_deadline < dispute_deadline + INTERVAL 3 DAY AND status IN ('ISSUED', 'DISPUTED', 'CONFIRMED');

-- 演示账单的异议截止日是固定日期，过了之后 opsBillDispute 就没有可提异议的账单：
-- 把第一家演示公司那张已下发的账单的异议期顺延到至少后天，结算截止日跟着保持「异议期后 3 天」
UPDATE monthly_bill SET dispute_deadline = CURDATE() + INTERVAL 2 DAY, settle_deadline = CURDATE() + INTERVAL 5 DAY
 WHERE company_id = 'C10001' AND status = 'ISSUED' AND dispute_deadline < CURDATE() + INTERVAL 2 DAY;
