-- =====================================================================
-- 答题漏斗（P-12）：记录「打开答题页」，与匹配会话、报名一起组成 打开 → 提交 → 匹配到岗位 → 报名 四级漏斗
-- =====================================================================
CREATE TABLE quiz_open (
    user_id   VARCHAR(32) NOT NULL,
    biz_date  DATE        NOT NULL,
    PRIMARY KEY (user_id, biz_date),
    KEY idx_qo_date (biz_date)
) COMMENT '每人每天是否打开过答题页（漏斗起点）';
