-- =====================================================================
-- 求职者与生命周期：用户、状态日志、24h 窗口、实名、告知书、报名、任职、合同、离职、花名册
-- =====================================================================

CREATE TABLE `user` (
    user_id                VARCHAR(32)   NOT NULL PRIMARY KEY COMMENT 'U+日期+序号',
    phone_enc              VARCHAR(255)  NOT NULL,
    phone_hash             CHAR(64)      NOT NULL,
    real_name_enc          VARCHAR(255)  NULL COMMENT '实名后写入，不可改',
    id_card_enc            VARCHAR(255)  NULL,
    id_card_hash           CHAR(64)      NULL COMMENT '一证一号',
    birth_date             DATE          NULL COMMENT '取自 OCR，年龄拦截唯一依据',
    gender                 CHAR(1)       NULL,
    kyc_status             VARCHAR(16)   NOT NULL DEFAULT 'NONE' COMMENT 'NONE / VERIFIED / REVIEWING / REJECTED',
    source_company_id      VARCHAR(32)   NOT NULL COMMENT '来源归属：注册时锁定，永不更改（触发器保护）',
    bound_company_id       VARCHAR(32)   NULL COMMENT '当前归属：NULL = 公域',
    user_status            VARCHAR(24)   NOT NULL,
    last_release_reason    VARCHAR(24)   NULL,
    current_application_id VARCHAR(32)   NULL,
    register_channel_code  VARCHAR(16)   NULL,
    register_channel_type  VARCHAR(16)   NOT NULL,
    match_cycle_count      INT           NOT NULL DEFAULT 0 COMMENT '本求职周期内匹配次数（D-11）',
    profile_version        INT           NOT NULL DEFAULT 0,
    advance_debt           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    blacklist_flag         TINYINT(1)    NOT NULL DEFAULT 0,
    registered_at          DATETIME(3)   NOT NULL,
    created_at             DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at             DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    version                INT           NOT NULL DEFAULT 0,
    UNIQUE KEY uk_user_phone (phone_hash),
    UNIQUE KEY uk_user_id_card (id_card_hash),
    KEY idx_user_bound_status (bound_company_id, user_status),
    KEY idx_user_source (source_company_id)
) COMMENT '求职者。user_status / bound_company_id 只允许 LifecycleService 修改';

DELIMITER $$
CREATE TRIGGER trg_user_source_immutable BEFORE UPDATE ON `user`
FOR EACH ROW
BEGIN
    IF NEW.source_company_id <> OLD.source_company_id THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'source_company_id is immutable (R-05)';
    END IF;
END$$
DELIMITER ;

CREATE TABLE user_resume (
    user_id             VARCHAR(32)  NOT NULL PRIMARY KEY,
    wechat_id           VARCHAR(64)  NULL,
    emergency_name      VARCHAR(32)  NULL,
    emergency_phone_enc VARCHAR(255) NULL,
    expect_job_types    JSON         NULL,
    expect_regions      JSON         NULL,
    work_years          TINYINT      NULL,
    skill_tags          JSON         NULL,
    attachments         JSON         NULL COMMENT '证件附件 OSS key',
    intro               VARCHAR(500) NULL,
    updated_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) COMMENT '我的简历 · 本人可编辑部分（C-504）';

CREATE TABLE user_status_log (
    id               BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id          VARCHAR(32)  NOT NULL,
    event            VARCHAR(32)  NOT NULL COMMENT 'LifecycleEvent',
    from_status      VARCHAR(24)  NOT NULL,
    to_status        VARCHAR(24)  NOT NULL,
    bound_before     VARCHAR(32)  NULL,
    bound_after      VARCHAR(32)  NULL,
    release_reason   VARCHAR(24)  NULL,
    application_id   VARCHAR(32)  NULL,
    actor_role       VARCHAR(16)  NOT NULL,
    actor_id         VARCHAR(32)  NULL COMMENT 'SYSTEM 为空',
    actor_company_id VARCHAR(32)  NULL,
    remark           VARCHAR(500) NULL,
    ip               VARCHAR(45)  NULL,
    trace_id         VARCHAR(64)  NULL,
    created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_usl_user_time (user_id, created_at),
    KEY idx_usl_release (release_reason, created_at)
) COMMENT '状态迁移日志（R-12，纠纷证据，永久保留）';

CREATE TABLE response_window (
    id              BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id         VARCHAR(32) NOT NULL,
    company_id      VARCHAR(32) NOT NULL,
    stage           VARCHAR(24) NOT NULL COMMENT '进入窗口时的状态：PRIVATE_PENDING / PENDING_INTERVIEW / PENDING_CONFIRM',
    application_id  VARCHAR(32) NULL,
    started_at      DATETIME(3) NOT NULL,
    deadline        DATETIME(3) NOT NULL,
    status          VARCHAR(16) NOT NULL DEFAULT 'OPEN' COMMENT 'OPEN / CLOSED（正常推进）/ FIRED（已超时释放）',
    closed_at       DATETIME(3) NULL,
    open_user_id    VARCHAR(32) GENERATED ALWAYS AS (IF(status = 'OPEN', user_id, NULL)) STORED,
    UNIQUE KEY uk_rw_one_open (open_user_id),
    KEY idx_rw_scan (status, deadline),
    KEY idx_rw_company (company_id, status, deadline)
) COMMENT '24h 响应窗口：同一用户同时最多一个 OPEN 窗口';

CREATE TABLE follow_up_reminder (
    id          BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
    window_id   BIGINT      NOT NULL,
    round_no    INT         NOT NULL,
    remind_at   DATETIME(3) NOT NULL,
    status      VARCHAR(16) NOT NULL DEFAULT 'PLANNED' COMMENT 'PLANNED / SENT / CANCELLED',
    sent_at     DATETIME(3) NULL,
    UNIQUE KEY uk_fur_round (window_id, round_no),
    KEY idx_fur_scan (status, remind_at)
) COMMENT '24h 窗口内三方跟进提醒计划（白天 6h / 夜间 12h）';

CREATE TABLE kyc_record (
    id                BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id           VARCHAR(32)  NOT NULL,
    method            VARCHAR(16)  NOT NULL COMMENT 'OCR_2FACTOR / MANUAL_INPUT',
    ocr_confidence    DECIMAL(5,2) NULL,
    id_card_hash      CHAR(64)     NOT NULL,
    birth_date        DATE         NULL,
    result            VARCHAR(24)  NOT NULL COMMENT 'PASS / ID_MISMATCH / UNDERAGE / ID_OCCUPIED / BLACKLISTED / LOW_CONFIDENCE / VERIFY_FAILED',
    provider_trace_id VARCHAR(64)  NULL,
    ip                VARCHAR(45)  NULL,
    created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_kyc_user (user_id, created_at),
    KEY idx_kyc_idcard_time (id_card_hash, created_at) COMMENT 'D-17：24h 内同证多号检测'
) COMMENT '实名核验记录（证件原图不留存）';

CREATE TABLE kyc_review (
    id           BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id      VARCHAR(32)  NOT NULL,
    kyc_record_id BIGINT      NOT NULL,
    review_type  VARCHAR(24)  NOT NULL COMMENT 'LOW_CONFIDENCE / ID_OCCUPIED_APPEAL / FRAUD_SUSPECT / BLACKLIST_APPEAL',
    status       VARCHAR(16)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING / APPROVED / REJECTED',
    reviewer_id  VARCHAR(32)  NULL,
    remark       VARCHAR(500) NULL,
    created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    reviewed_at  DATETIME(3)  NULL,
    KEY idx_kr_status (status, created_at)
) COMMENT '实名人工复核队列（P-14）';

CREATE TABLE blacklist (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id     VARCHAR(32)  NOT NULL,
    id_card_hash CHAR(64)    NULL,
    reason_code VARCHAR(32)  NOT NULL COMMENT 'UNPAID_ADVANCE / FRAUD / ...（D-16：对外只暴露「平台级失信」标记）',
    detail      VARCHAR(500) NULL,
    status      VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE / LIFTED',
    created_by  VARCHAR(32)  NULL,
    created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    lifted_at   DATETIME(3)  NULL,
    KEY idx_bl_user (user_id, status)
) COMMENT '平台黑名单';

CREATE TABLE disclaimer_consent (
    id          BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id     VARCHAR(32) NOT NULL,
    doc_version VARCHAR(16) NOT NULL,
    ip          VARCHAR(45) NOT NULL,
    user_agent  VARCHAR(255) NULL,
    agreed_at   DATETIME(3) NOT NULL,
    UNIQUE KEY uk_consent_user_version (user_id, doc_version)
) COMMENT '告知书与免责声明同意留痕（永久存档，C-403）';

CREATE TABLE application (
    application_id     VARCHAR(32)  NOT NULL PRIMARY KEY COMMENT 'BM+日期+序号',
    user_id            VARCHAR(32)  NOT NULL,
    company_id         VARCHAR(32)  NOT NULL,
    project_id         VARCHAR(32)  NOT NULL,
    job_id             VARCHAR(32)  NOT NULL,
    match_session_id   VARCHAR(32)  NULL COMMENT '来自哪次匹配结果（R-01）；经纪人推荐时为空',
    broker_case_id     BIGINT       NULL COMMENT '经纪人二次推荐来源',
    pre_apply_status   VARCHAR(24)  NOT NULL COMMENT 'D-31：报名前状态，面试未过 / 取消时据此恢复',
    pre_apply_bound    VARCHAR(32)  NULL,
    status             VARCHAR(24)  NOT NULL,
    acknowledged_at    DATETIME(3)  NULL COMMENT '驻场点击知悉',
    acknowledged_by    VARCHAR(32)  NULL,
    interview_at       DATETIME(3)  NULL,
    interview_address  VARCHAR(255) NULL,
    arrived_at         DATETIME(3)  NULL,
    interview_result   VARCHAR(16)  NULL COMMENT 'PASS / FAIL',
    ended_at           DATETIME(3)  NULL,
    end_reason         VARCHAR(24)  NULL,
    end_operator_id    VARCHAR(32)  NULL COMMENT '取消必须有后台操作人（R-04）',
    end_remark         VARCHAR(500) NULL,
    created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    version            INT          NOT NULL DEFAULT 0,
    active_user_id     VARCHAR(32)  GENERATED ALWAYS AS (IF(status IN ('PENDING_INTERVIEW','PENDING_CONFIRM'), user_id, NULL)) STORED,
    UNIQUE KEY uk_app_one_active (active_user_id) COMMENT '同一用户同时只有一条有效报名',
    KEY idx_app_user (user_id, created_at),
    KEY idx_app_company_status (company_id, status, created_at),
    KEY idx_app_project_status (project_id, status),
    KEY idx_app_job (job_id, status)
) COMMENT '报名 / 报备';

CREATE TABLE interview_notice (
    id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id     VARCHAR(32)  NOT NULL,
    application_id VARCHAR(32)  NOT NULL,
    interview_at   DATETIME(3)  NOT NULL,
    address        VARCHAR(255) NOT NULL,
    lng            DECIMAL(10,6) NULL,
    lat            DECIMAL(10,6) NULL,
    route_tips     VARCHAR(500) NULL,
    documents      JSON         NULL COMMENT '证件清单',
    contact_name   VARCHAR(32)  NULL,
    contact_phone_enc VARCHAR(255) NULL,
    pushed_by      VARCHAR(32)  NOT NULL,
    pushed_at      DATETIME(3)  NOT NULL,
    KEY idx_in_app (application_id)
) COMMENT '面试确认信息（驻场知悉后推送，C-408）';

CREATE TABLE employment (
    employment_id    VARCHAR(32)  NOT NULL PRIMARY KEY,
    user_id          VARCHAR(32)  NOT NULL,
    company_id       VARCHAR(32)  NOT NULL,
    project_id       VARCHAR(32)  NOT NULL,
    job_id           VARCHAR(32)  NULL COMMENT '花名册导入可为空',
    application_id   VARCHAR(32)  NULL,
    employee_no      VARCHAR(32)  NULL COMMENT '工号',
    start_date       DATE         NOT NULL,
    end_date         DATE         NULL,
    source_company_id_snapshot VARCHAR(32) NOT NULL,
    is_transfer      TINYINT(1)   NOT NULL COMMENT 'source ≠ company → 产生流转费',
    is_stock         TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '存量人员（审计用；计费按人数差 D-18）',
    origin           VARCHAR(16)  NOT NULL COMMENT 'PLATFORM_ONBOARD / ROSTER_IMPORT',
    contract_id      VARCHAR(32)  NULL,
    end_reason       VARCHAR(24)  NULL,
    created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    active_user_id   VARCHAR(32)  GENERATED ALWAYS AS (IF(end_date IS NULL, user_id, NULL)) STORED,
    UNIQUE KEY uk_emp_one_active (active_user_id) COMMENT '同一用户同时只有一段在职',
    KEY idx_emp_company_dates (company_id, start_date, end_date),
    KEY idx_emp_source (source_company_id_snapshot, is_transfer),
    KEY idx_emp_user (user_id)
) COMMENT '任职记录：计费的唯一事实依据（02-架构 §6.2）';

CREATE TABLE employment_change_log (
    id            BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id    VARCHAR(32) NOT NULL,
    employment_id VARCHAR(32) NOT NULL,
    change_type   VARCHAR(16) NOT NULL COMMENT 'INTERNAL_TRANSFER / LEAVE_MARK',
    from_project  VARCHAR(32) NULL,
    to_project    VARCHAR(32) NULL,
    from_job      VARCHAR(32) NULL,
    to_job        VARCHAR(32) NULL,
    effective_date DATE       NOT NULL,
    operator_id   VARCHAR(32) NOT NULL,
    created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_ecl_emp (employment_id)
) COMMENT '内部调岗（计费不中断，E-07）';

CREATE TABLE duty_absence (
    id            BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id    VARCHAR(32) NOT NULL,
    employment_id VARCHAR(32) NOT NULL,
    absence_date  DATE        NOT NULL,
    absence_type  VARCHAR(16) NOT NULL COMMENT 'LEAVE 请假 / ABSENT 旷工',
    marked_by     VARCHAR(32) NOT NULL,
    remark        VARCHAR(255) NULL,
    created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_absence_day (employment_id, absence_date)
) COMMENT 'D-27：驻场标记的请假 / 旷工，扣减有效在岗日（M-15）';

CREATE TABLE contract (
    contract_id      VARCHAR(32)  NOT NULL PRIMARY KEY,
    contract_no      VARCHAR(32)  NOT NULL,
    user_id          VARCHAR(32)  NOT NULL,
    company_id       VARCHAR(32)  NOT NULL,
    application_id   VARCHAR(32)  NULL,
    employment_id    VARCHAR(32)  NULL,
    template_code    VARCHAR(32)  NOT NULL,
    title            VARCHAR(100) NOT NULL,
    term_start       DATE         NOT NULL,
    term_end         DATE         NULL,
    status           VARCHAR(16)  NOT NULL DEFAULT 'PENDING_SIGN',
    esign_flow_id    VARCHAR(64)  NULL COMMENT 'e签宝签署流程 ID',
    signed_file_key  VARCHAR(255) NULL,
    signed_at        DATETIME(3)  NULL,
    ended_at         DATETIME(3)  NULL,
    created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_contract_no (contract_no),
    UNIQUE KEY uk_contract_flow (esign_flow_id) COMMENT '签约回调幂等',
    KEY idx_contract_user (user_id, created_at)
) COMMENT '劳动合同（电子签）';

CREATE TABLE esign_callback_log (
    id           BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    flow_id      VARCHAR(64)  NOT NULL,
    action       VARCHAR(32)  NOT NULL,
    raw_body     JSON         NOT NULL,
    signature_ok TINYINT(1)   NOT NULL,
    processed    TINYINT(1)   NOT NULL DEFAULT 0,
    received_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_ecb_flow (flow_id)
) COMMENT '电子签回调原文（重复推送只处理一次）';

CREATE TABLE resign_request (
    id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    employment_id  VARCHAR(32)  NOT NULL,
    user_id        VARCHAR(32)  NOT NULL,
    company_id     VARCHAR(32)  NOT NULL,
    resign_date    DATE         NOT NULL,
    reason         VARCHAR(255) NULL,
    status         VARCHAR(16)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING / APPROVED / REJECTED',
    requested_by   VARCHAR(32)  NOT NULL,
    approved_by    VARCHAR(32)  NULL,
    approved_at    DATETIME(3)  NULL,
    created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_rr_company_status (company_id, status)
) COMMENT '离职审核（T-308）';

CREATE TABLE roster_batch (
    batch_id      VARCHAR(32)  NOT NULL PRIMARY KEY,
    company_id    VARCHAR(32)  NOT NULL,
    project_id    VARCHAR(32)  NULL,
    file_key      VARCHAR(255) NOT NULL,
    total_rows    INT          NOT NULL DEFAULT 0,
    success_rows  INT          NOT NULL DEFAULT 0,
    failed_rows   INT          NOT NULL DEFAULT 0,
    in_free_period TINYINT(1)  NOT NULL COMMENT '导入时是否在免费期 → 计入存量基数',
    status        VARCHAR(16)  NOT NULL DEFAULT 'PROCESSING' COMMENT 'PROCESSING / DONE / FAILED',
    operator_id   VARCHAR(32)  NOT NULL,
    created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    finished_at   DATETIME(3)  NULL,
    KEY idx_rb_company (company_id, created_at)
) COMMENT '花名册导入批次';

CREATE TABLE roster_row (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id  VARCHAR(32)  NOT NULL,
    batch_id    VARCHAR(32)  NOT NULL,
    row_no      INT          NOT NULL,
    raw         JSON         NOT NULL COMMENT '原始行（敏感字段已加密）',
    result      VARCHAR(16)  NOT NULL COMMENT 'SUCCESS / FAILED',
    error_msg   VARCHAR(255) NULL,
    user_id     VARCHAR(32)  NULL,
    KEY idx_rr_batch (batch_id, result)
) COMMENT '花名册导入明细（失败行可下载）';
