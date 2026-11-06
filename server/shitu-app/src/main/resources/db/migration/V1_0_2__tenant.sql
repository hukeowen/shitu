-- =====================================================================
-- 租户：劳务公司、成员与角色、项目、甲方企业与合作合同、渠道码
-- =====================================================================

CREATE TABLE company (
    company_id          VARCHAR(32)   NOT NULL PRIMARY KEY COMMENT 'C10023；平台用保留值 PLATFORM，不在本表',
    name                VARCHAR(100)  NOT NULL,
    short_name          VARCHAR(32)   NULL,
    unified_credit_code VARCHAR(18)   NOT NULL COMMENT '统一社会信用代码',
    dispatch_license_no VARCHAR(64)   NULL COMMENT '劳务派遣经营许可证号',
    license_files       JSON          NULL COMMENT '营业执照 / 许可证 OSS key',
    contact_name        VARCHAR(32)   NOT NULL,
    contact_phone_enc   VARCHAR(255)  NOT NULL,
    company_status      VARCHAR(16)   NOT NULL DEFAULT 'PENDING_AUDIT',
    onboard_date        DATE          NULL COMMENT '入驻审核通过日 = 免费期起算日',
    free_period_end     DATE          NULL COMMENT '免费期最后一天（含）',
    credit_score        INT           NOT NULL DEFAULT 100,
    penalty_level       TINYINT       NOT NULL DEFAULT 0 COMMENT '0 无 / 1 警告 / 2 限流 / 3 封禁',
    penalty_until       DATE          NULL,
    fee_rights_revoked  TINYINT(1)    NOT NULL DEFAULT 0 COMMENT 'D-24：诚信分<30 或 3 级处罚 → 取消收费服务权限',
    payday_of_month     TINYINT       NOT NULL DEFAULT 15 COMMENT '发薪日（预支抵扣）',
    closed_at           DATETIME(3)   NULL,
    created_at          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    version             INT           NOT NULL DEFAULT 0,
    UNIQUE KEY uk_company_credit_code (unified_credit_code),
    KEY idx_company_status (company_status)
) COMMENT '劳务公司（租户）';

CREATE TABLE member (
    member_id       VARCHAR(32)  NOT NULL PRIMARY KEY,
    company_id      VARCHAR(32)  NOT NULL,
    name            VARCHAR(32)  NOT NULL,
    phone_enc       VARCHAR(255) NOT NULL,
    phone_hash      CHAR(64)     NOT NULL,
    roles           VARCHAR(64)  NOT NULL COMMENT '逗号分隔：SITE / BROKER / PM / OWNER',
    status          VARCHAR(16)  NOT NULL DEFAULT 'NORMAL' COMMENT 'NORMAL / DISABLED',
    last_login_at   DATETIME(3)  NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_member_phone (phone_hash),
    KEY idx_member_company (company_id)
) COMMENT '租户成员：驻场 / 经纪人 / 项目经理 / 老板（一人可多角色；一个手机号只属于一家公司）';

CREATE TABLE client_company (
    client_id           VARCHAR(32)  NOT NULL PRIMARY KEY,
    name                VARCHAR(100) NOT NULL COMMENT '如 立讯精密工业（昆山）有限公司',
    unified_credit_code VARCHAR(18)  NULL,
    city                VARCHAR(32)  NULL,
    created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_client_name (name)
) COMMENT '甲方用工企业（全平台共享主数据）';

CREATE TABLE client_contract (
    contract_id     VARCHAR(32)  NOT NULL PRIMARY KEY,
    company_id      VARCHAR(32)  NOT NULL,
    client_id       VARCHAR(32)  NOT NULL,
    file_key        VARCHAR(255) NOT NULL COMMENT 'OSS 私有桶 key',
    valid_from      DATE         NOT NULL,
    valid_to        DATE         NOT NULL,
    audit_status    VARCHAR(16)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING / APPROVED / REJECTED',
    audit_remark    VARCHAR(255) NULL,
    audited_by      VARCHAR(32)  NULL,
    audited_at      DATETIME(3)  NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_cc_company_client (company_id, client_id)
) COMMENT '劳务公司与甲方的合作合同（岗位发布前必传，文档 11.2）';

CREATE TABLE project (
    project_id   VARCHAR(32)  NOT NULL PRIMARY KEY,
    company_id   VARCHAR(32)  NOT NULL,
    client_id    VARCHAR(32)  NOT NULL,
    contract_id  VARCHAR(32)  NULL,
    name         VARCHAR(64)  NOT NULL COMMENT '如 立讯精密昆山二期',
    province     VARCHAR(16)  NULL,
    city         VARCHAR(32)  NOT NULL,
    district     VARCHAR(32)  NULL,
    address      VARCHAR(255) NOT NULL,
    lng          DECIMAL(10,6) NULL,
    lat          DECIMAL(10,6) NULL,
    status       VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE / CLOSED',
    created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_project_company (company_id)
) COMMENT '项目（劳务公司在某甲方厂区的用工项目）';

CREATE TABLE member_project (
    company_id VARCHAR(32) NOT NULL,
    member_id  VARCHAR(32) NOT NULL,
    project_id VARCHAR(32) NOT NULL,
    PRIMARY KEY (member_id, project_id),
    KEY idx_mp_project (project_id)
) COMMENT '成员负责的项目（驻场 / 项目经理的数据范围）';

CREATE TABLE channel_code (
    code         VARCHAR(16)  NOT NULL PRIMARY KEY COMMENT '短码，二维码内容 https://m.shitu.com/r/{code}',
    channel_type VARCHAR(16)  NOT NULL COMMENT 'COMPANY_QR / EMPLOYEE_SHARE / BRAND_AD',
    company_id   VARCHAR(32)  NULL COMMENT 'COMPANY_QR 必填',
    member_id    VARCHAR(32)  NULL COMMENT '成员专属码',
    project_id   VARCHAR(32)  NULL COMMENT '项目专属码',
    referrer_user_id VARCHAR(32) NULL COMMENT 'EMPLOYEE_SHARE：分享的员工（仅统计，不影响归属）',
    name         VARCHAR(64)  NOT NULL,
    status       VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE',
    created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_channel_company (company_id)
) COMMENT '渠道码';

CREATE TABLE channel_visit (
    id          BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
    code        VARCHAR(16) NOT NULL,
    visitor_key VARCHAR(64) NOT NULL COMMENT '匿名访客标识（cookie）',
    user_id     VARCHAR(32) NULL COMMENT '已登录用户扫码时记录（不改变归属，C-106）',
    ip          VARCHAR(45) NULL,
    user_agent  VARCHAR(255) NULL,
    created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_visit_code_time (code, created_at)
) COMMENT '扫码访问（渠道转化报表的「访问」层）';
