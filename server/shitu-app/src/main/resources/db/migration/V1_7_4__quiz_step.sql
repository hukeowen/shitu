-- 答题漏斗细化到每一题：记录每人每天进到过第几题，用来看哪道题流失最多（P-12）。
CREATE TABLE quiz_step (
    user_id   VARCHAR(32) NOT NULL,
    biz_date  DATE        NOT NULL,
    seq       INT         NOT NULL COMMENT '题号，从 1 开始',
    PRIMARY KEY (user_id, biz_date, seq),
    KEY idx_qs_date (biz_date, seq)
) COMMENT '每人每天进入过的题目（各题进入 / 放弃人数）';
