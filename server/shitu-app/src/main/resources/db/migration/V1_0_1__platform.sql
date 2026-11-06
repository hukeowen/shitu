-- =====================================================================
-- 平台基础：参数、节假日、审计、平台账号、分布式任务锁、事件发件箱
-- 约定：utf8mb4 / InnoDB；时间 DATETIME(3) 统一存 Asia/Shanghai；金额 DECIMAL(12,2)
-- 枚举一律存英文常量（varchar），中文由 /api/v1/dict 提供
-- =====================================================================

CREATE TABLE sys_param (
    param_key    VARCHAR(64)  NOT NULL PRIMARY KEY,
    param_value  VARCHAR(512) NOT NULL,
    value_type   VARCHAR(16)  NOT NULL COMMENT 'INT / DECIMAL / DURATION / TIME / STRING / BOOL',
    description  VARCHAR(255) NOT NULL,
    updated_by   VARCHAR(32)  NULL,
    updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) COMMENT '系统参数（所有「参数化」决策项，平台中台可改，不需发版）';

CREATE TABLE holiday (
    holiday_date DATE        NOT NULL PRIMARY KEY,
    is_workday   TINYINT(1)  NOT NULL COMMENT '1 = 调休上班日；0 = 法定假日',
    name         VARCHAR(32) NOT NULL
) COMMENT '法定节假日日历（D-23：5 个工作日异议期按此计算）';

CREATE TABLE ops_admin (
    admin_id      VARCHAR(32)  NOT NULL PRIMARY KEY,
    username      VARCHAR(64)  NOT NULL,
    password_hash VARCHAR(100) NOT NULL,
    display_name  VARCHAR(32)  NOT NULL,
    roles         VARCHAR(128) NOT NULL COMMENT '逗号分隔：SUPER / OPERATOR / FINANCE / RISK',
    status        VARCHAR(16)  NOT NULL DEFAULT 'NORMAL',
    last_login_at DATETIME(3)  NULL,
    created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_ops_admin_username (username)
) COMMENT '平台运营账号（与租户账号完全隔离）';

CREATE TABLE audit_log (
    id           BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    actor_domain VARCHAR(16)  NOT NULL COMMENT 'SEEKER / TENANT / OPS / SYSTEM',
    actor_id     VARCHAR(32)  NULL,
    company_id   VARCHAR(32)  NULL,
    action       VARCHAR(64)  NOT NULL COMMENT '如 USER_RELEASE / CREDIT_ADJUST / DATA_EXPORT / ROLE_CHANGE',
    target_type  VARCHAR(32)  NULL,
    target_id    VARCHAR(64)  NULL,
    detail       JSON         NULL,
    ip           VARCHAR(45)  NULL,
    trace_id     VARCHAR(64)  NULL,
    created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_audit_target (target_type, target_id),
    KEY idx_audit_actor (actor_domain, actor_id, created_at),
    KEY idx_audit_company (company_id, created_at)
) COMMENT '审计日志（只追加，应用层不提供更新 / 删除）';

CREATE TABLE shedlock (
    name       VARCHAR(64)  NOT NULL PRIMARY KEY,
    lock_until TIMESTAMP(3) NOT NULL,
    locked_at  TIMESTAMP(3) NOT NULL,
    locked_by  VARCHAR(255) NOT NULL
) COMMENT 'ShedLock：多实例下定时任务只在一个实例执行';

CREATE TABLE outbox_event (
    id              BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    event_type      VARCHAR(64)  NOT NULL COMMENT 'APPLICATION_CREATED / USER_RELEASED / CONTRACT_SIGNED ...',
    aggregate_type  VARCHAR(32)  NOT NULL,
    aggregate_id    VARCHAR(64)  NOT NULL,
    payload         JSON         NOT NULL,
    status          VARCHAR(16)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING / DONE / DEAD',
    attempts        INT          NOT NULL DEFAULT 0,
    next_attempt_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_error      VARCHAR(1000) NULL,
    trace_id        VARCHAR(64)  NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_outbox_dispatch (status, next_attempt_at),
    KEY idx_outbox_aggregate (aggregate_type, aggregate_id)
) COMMENT '事务发件箱：与业务写入同一事务，由投递任务分发';
