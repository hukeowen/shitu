-- =====================================================================
-- 系统参数中台可改（参数化决策）；D-17 刷单确认后的扣分值参数化
-- =====================================================================
INSERT INTO sys_param (param_key, param_value, value_type, description) VALUES
('kyc.fraud_credit_deduct', '30', 'INT', 'D-17 确认刷单后引流公司扣除的诚信分');

ALTER TABLE sys_param
    ADD COLUMN update_remark VARCHAR(255) NULL COMMENT '最近一次修改原因' AFTER updated_by;

-- 这三项由「匹配引擎参数」版本管理（P-13），sys_param 里的副本没有代码读取，删掉避免出现改了不生效的开关
DELETE FROM sys_param WHERE param_key IN ('matching.display_threshold', 'matching.result_count', 'matching.max_per_company_public');
