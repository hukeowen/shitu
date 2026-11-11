-- =====================================================================
-- 归属争议登记（P-08）：公司对某个求职者的来源 / 当前归属有异议时，由运营登记、核查并写结论
-- 来源归属注册时锁定、永不更改（R-05），争议处理只留痕，不改归属
-- =====================================================================
CREATE TABLE attribution_dispute (
    id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id       VARCHAR(32)  NOT NULL,
    company_id    VARCHAR(32)  NULL COMMENT '提出异议的公司',
    content       VARCHAR(500) NOT NULL COMMENT '争议内容',
    status        VARCHAR(16)  NOT NULL DEFAULT 'OPEN' COMMENT 'OPEN / RESOLVED',
    conclusion    VARCHAR(500) NULL,
    created_by    VARCHAR(32)  NOT NULL,
    resolved_by   VARCHAR(32)  NULL,
    created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    resolved_at   DATETIME(3)  NULL,
    KEY idx_ad_user (user_id, id),
    KEY idx_ad_status (status, id)
) COMMENT '归属争议登记与处理结论';
