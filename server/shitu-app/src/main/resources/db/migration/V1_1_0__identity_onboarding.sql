-- =====================================================================
-- Sprint 1：账号会话、业务编号、入驻审核、岗位审核意见
-- 只新增，不做破坏性变更（02-架构 §14）
-- =====================================================================

CREATE TABLE biz_sequence (
    seq_key VARCHAR(64) NOT NULL PRIMARY KEY COMMENT '如 USER:20261106 / COMPANY / JOB:20261106',
    value   BIGINT      NOT NULL
) COMMENT '业务编号序列（U20261106 00001、C10023、J20261106 008 …），独立事务递增';

CREATE TABLE auth_session (
    session_id         VARCHAR(32)  NOT NULL PRIMARY KEY,
    domain             VARCHAR(16)  NOT NULL COMMENT 'SEEKER / TENANT / OPS',
    subject_id         VARCHAR(32)  NOT NULL COMMENT 'user_id / member_id / admin_id',
    company_id         VARCHAR(32)  NULL COMMENT 'TENANT 域登录时的公司',
    refresh_hash       CHAR(64)     NOT NULL COMMENT 'refresh token 的 SHA-256，明文不落库',
    prev_refresh_hash  CHAR(64)     NULL COMMENT '上一个 refresh token：宽限期内重放视为并发刷新，超出视为盗用并吊销',
    rotated_at         DATETIME(3)  NULL,
    status             VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE / REVOKED',
    revoke_reason      VARCHAR(32)  NULL COMMENT 'LOGOUT / REUSE_DETECTED / ACCOUNT_DISABLED / PASSWORD_CHANGED',
    expires_at         DATETIME(3)  NOT NULL,
    ip                 VARCHAR(45)  NULL,
    user_agent         VARCHAR(255) NULL,
    created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_used_at       DATETIME(3)  NULL,
    UNIQUE KEY uk_session_refresh (refresh_hash),
    KEY idx_session_prev (prev_refresh_hash),
    KEY idx_session_subject (domain, subject_id, status)
) COMMENT '登录会话（refresh token 轮换；access token 无状态，15 分钟）';

ALTER TABLE company
    ADD COLUMN submitted_at DATETIME(3)  NULL COMMENT '最近一次提交入驻申请' AFTER contact_phone_enc,
    ADD COLUMN audit_remark VARCHAR(255) NULL COMMENT '入驻审核意见（驳回原因）' AFTER submitted_at,
    ADD COLUMN audited_by   VARCHAR(32)  NULL AFTER audit_remark,
    ADD COLUMN audited_at   DATETIME(3)  NULL AFTER audited_by,
    ADD COLUMN status_remark VARCHAR(255) NULL COMMENT '限流 / 封禁原因' AFTER company_status;

ALTER TABLE ops_admin
    ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 COMMENT '初始密码 / 被重置后首次登录必须改密' AFTER password_hash,
    ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);

ALTER TABLE job
    ADD COLUMN audit_remark VARCHAR(500) NULL COMMENT '最近一次驳回 / 强制下架说明' AFTER job_status,
    ADD COLUMN submitted_at DATETIME(3)  NULL COMMENT '最近一次提交审核' AFTER audit_remark;

ALTER TABLE channel_code
    ADD COLUMN created_by VARCHAR(32) NULL AFTER status,
    ADD KEY idx_channel_member (member_id);

ALTER TABLE `user`
    ADD KEY idx_user_channel (register_channel_code);
