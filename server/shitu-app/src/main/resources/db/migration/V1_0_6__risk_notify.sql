-- =====================================================================
-- 风控（岗位权重、投诉、诚信分、处罚）与通知
-- =====================================================================

CREATE TABLE job_weight_daily (
    biz_date          DATE         NOT NULL,
    job_id            VARCHAR(32)  NOT NULL,
    posted_days       INT          NOT NULL,
    decay_factor      DECIMAL(4,3) NOT NULL,
    conversion_factor DECIMAL(4,3) NOT NULL,
    credit_factor     DECIMAL(4,3) NOT NULL,
    penalty_factor    DECIMAL(4,3) NOT NULL,
    quota_factor      DECIMAL(4,3) NOT NULL,
    new_job_boost     DECIMAL(4,3) NOT NULL,
    final_weight      DECIMAL(4,3) NOT NULL COMMENT 'min(衰减, 低转化) × 诚信 × 处罚 × 名额 × 新岗扶持（D-29）',
    PRIMARY KEY (biz_date, job_id)
) COMMENT '岗位权重每日快照（仅平台可见）';

CREATE TABLE complaint (
    id           BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    job_id       VARCHAR(32)  NOT NULL,
    company_id   VARCHAR(32)  NOT NULL,
    user_id      VARCHAR(32)  NOT NULL,
    category     VARCHAR(24)  NOT NULL COMMENT 'FULL_STILL_HIRING / INFO_FALSE / MISMATCH_AFTER_INTERVIEW',
    content      VARCHAR(500) NULL,
    images       JSON         NULL,
    status       VARCHAR(16)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING / VERIFIED / REJECTED',
    handled_by   VARCHAR(32)  NULL,
    handle_remark VARCHAR(500) NULL,
    created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    handled_at   DATETIME(3)  NULL,
    KEY idx_cp_job_status (job_id, status),
    KEY idx_cp_status (status, created_at)
) COMMENT '岗位投诉（同岗 ≥3 次属实 → 自动下架 + 扣分）';

CREATE TABLE credit_score_log (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id  VARCHAR(32)  NOT NULL,
    delta       INT          NOT NULL,
    score_after INT          NOT NULL,
    rule_code   VARCHAR(32)  NOT NULL COMMENT 'STALE_JOB −5 / FALSE_STATUS −10 / DIVERSION −30 / MANUAL',
    ref_type    VARCHAR(32)  NULL,
    ref_id      VARCHAR(64)  NULL,
    remark      VARCHAR(500) NULL,
    operator_id VARCHAR(32)  NULL COMMENT '人工调整必填（留痕）',
    created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_csl_company (company_id, created_at)
) COMMENT '诚信分变更记录';

CREATE TABLE risk_event (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id  VARCHAR(32)  NOT NULL,
    event_type  VARCHAR(32)  NOT NULL COMMENT '异常事件，用于三级处罚的「单月 3 次异常」统计',
    ref_type    VARCHAR(32)  NULL,
    ref_id      VARCHAR(64)  NULL,
    detail      JSON         NULL,
    created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_re_company_time (company_id, created_at)
) COMMENT '风控异常事件';

CREATE TABLE penalty (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id  VARCHAR(32)  NOT NULL,
    level       TINYINT      NOT NULL COMMENT '1 警告 / 2 限流 / 3 封禁',
    reason      VARCHAR(500) NOT NULL,
    start_date  DATE         NOT NULL,
    end_date    DATE         NULL COMMENT '2 级持续 30 天；3 级永久为空',
    created_by  VARCHAR(32)  NOT NULL,
    created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_pen_company (company_id, start_date)
) COMMENT '三级处罚记录';

CREATE TABLE notify_template (
    template_code VARCHAR(48)  NOT NULL PRIMARY KEY,
    channels      VARCHAR(64)  NOT NULL COMMENT '逗号分隔：INBOX / SMS',
    title         VARCHAR(64)  NOT NULL,
    content       VARCHAR(500) NOT NULL COMMENT '占位符 ${name}',
    sms_template_id VARCHAR(32) NULL COMMENT '短信平台模板 ID',
    respect_quiet_hours TINYINT(1) NOT NULL DEFAULT 1,
    enabled       TINYINT(1)   NOT NULL DEFAULT 1,
    updated_by    VARCHAR(32)  NULL,
    updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) COMMENT '通知模板（P-16，改文案不发版）';

CREATE TABLE notification (
    id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    recipient_type VARCHAR(16)  NOT NULL COMMENT 'SEEKER / MEMBER',
    recipient_id   VARCHAR(32)  NOT NULL,
    template_code  VARCHAR(48)  NOT NULL,
    title          VARCHAR(64)  NOT NULL,
    content        VARCHAR(500) NOT NULL,
    link           VARCHAR(255) NULL,
    priority       TINYINT      NOT NULL DEFAULT 0 COMMENT '2 = 最高（工伤异常）',
    outbox_id      BIGINT       NULL,
    read_at        DATETIME(3)  NULL,
    created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_ntf_idem (outbox_id, recipient_type, recipient_id, template_code),
    KEY idx_ntf_inbox (recipient_type, recipient_id, read_at, created_at)
) COMMENT '站内信';

CREATE TABLE sms_log (
    id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    phone_hash    CHAR(64)     NOT NULL,
    biz_type      VARCHAR(24)  NOT NULL COMMENT 'LOGIN_CODE / NOTIFY',
    template_code VARCHAR(48)  NULL,
    provider_msg_id VARCHAR(64) NULL,
    status        VARCHAR(16)  NOT NULL COMMENT 'SENT / FAILED',
    ip            VARCHAR(45)  NULL,
    created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_sms_phone_time (phone_hash, created_at),
    KEY idx_sms_ip_time (ip, created_at)
) COMMENT '短信发送记录（频控与对账）';
