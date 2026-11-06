-- =====================================================================
-- Sprint 3：入职确权与电子签
-- =====================================================================

ALTER TABLE contract
    ADD COLUMN employee_no VARCHAR(32)  NULL COMMENT '确权时录入的工号，签约完成后写入任职记录' AFTER employment_id,
    ADD COLUMN sign_url    VARCHAR(500) NULL COMMENT '签署链接（e签宝链接有时效，失效后重新发起）' AFTER esign_flow_id;
