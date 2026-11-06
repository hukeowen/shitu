-- =====================================================================
-- 岗位、题库、匹配引擎、经纪人流转、知识库
-- =====================================================================

CREATE TABLE job (
    job_id             VARCHAR(32)   NOT NULL PRIMARY KEY COMMENT 'J20260701008',
    company_id         VARCHAR(32)   NOT NULL,
    project_id         VARCHAR(32)   NOT NULL,
    client_id          VARCHAR(32)   NOT NULL COMMENT '必须在已审核通过的 client_contract 内',
    title              VARCHAR(64)   NOT NULL,
    job_type           VARCHAR(32)   NOT NULL COMMENT '工种编码，对应题库 Q3',
    factory_job        TINYINT(1)    NOT NULL DEFAULT 1 COMMENT '是否进厂岗位（Q1 硬过滤）',
    salary_min         DECIMAL(10,2) NOT NULL,
    salary_max         DECIMAL(10,2) NOT NULL,
    shift_type         VARCHAR(16)   NOT NULL COMMENT 'DAY / NIGHT / TWO_SHIFT / LONG_DAY',
    dorm_provided      TINYINT(1)    NOT NULL DEFAULT 0,
    dorm_room_size     TINYINT       NULL COMMENT '几人间',
    dorm_aircon        TINYINT(1)    NULL,
    dorm_private_bath  TINYINT(1)    NULL,
    meal_provided      TINYINT(1)    NOT NULL DEFAULT 0,
    min_work_years     TINYINT       NOT NULL DEFAULT 0,
    age_min            TINYINT       NOT NULL DEFAULT 18,
    age_max            TINYINT       NOT NULL DEFAULT 45,
    duties             TEXT          NOT NULL,
    benefits           VARCHAR(500)  NULL,
    required_documents JSON          NULL,
    notes              VARCHAR(500)  NULL,
    interview_address  VARCHAR(255)  NOT NULL,
    interview_time_desc VARCHAR(100) NULL COMMENT '如 工作日 09:00 / 14:00',
    quota_total        INT           NOT NULL,
    quota_remaining    INT           NOT NULL COMMENT '报名原子扣减：UPDATE ... WHERE quota_remaining > 0',
    job_status         VARCHAR(16)   NOT NULL DEFAULT 'PENDING_AUDIT',
    posted_at          DATETIME(3)   NULL COMMENT '上架 / 恢复招聘时刻 → 挂岗天数起算（暂停后恢复重置）',
    decay_reset_at     DATETIME(3)   NULL COMMENT 'D-29：最近一次新入职，重置时间衰减',
    match_weight       DECIMAL(4,3)  NOT NULL DEFAULT 1.000 COMMENT '仅平台可见（R-14），每日任务重算',
    complaint_verified INT           NOT NULL DEFAULT 0,
    last_info_update_at DATETIME(3)  NULL,
    created_by         VARCHAR(32)   NOT NULL,
    created_at         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    version            INT           NOT NULL DEFAULT 0,
    KEY idx_job_pool (job_status, company_id),
    KEY idx_job_project (project_id),
    CONSTRAINT ck_job_quota CHECK (quota_remaining >= 0 AND quota_remaining <= quota_total),
    CONSTRAINT ck_job_salary CHECK (salary_min <= salary_max)
) COMMENT '岗位';

CREATE TABLE job_audit (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id  VARCHAR(32)  NOT NULL,
    job_id      VARCHAR(32)  NOT NULL,
    action      VARCHAR(16)  NOT NULL COMMENT 'SUBMIT / APPROVE / REJECT / FORCE_OFFLINE',
    remark      VARCHAR(500) NULL,
    operator_id VARCHAR(32)  NOT NULL,
    created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_ja_job (job_id)
) COMMENT '岗位审核记录';

CREATE TABLE quiz_version (
    version_id   INT          NOT NULL PRIMARY KEY,
    name         VARCHAR(32)  NOT NULL,
    status       VARCHAR(16)  NOT NULL COMMENT 'DRAFT / ACTIVE / ARCHIVED',
    published_by VARCHAR(32)  NULL,
    published_at DATETIME(3)  NULL,
    created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    active_flag  TINYINT      GENERATED ALWAYS AS (IF(status = 'ACTIVE', 1, NULL)) STORED,
    UNIQUE KEY uk_quiz_one_active (active_flag)
) COMMENT 'AI 问薪题库版本（P-12，可灰度回滚）';

CREATE TABLE quiz_question (
    id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    version_id    INT          NOT NULL,
    seq           TINYINT      NOT NULL,
    question_type VARCHAR(16)  NOT NULL COMMENT 'JUDGE 判断题 / CHOICE 选择题',
    stem          VARCHAR(100) NOT NULL,
    hint          VARCHAR(200) NULL,
    profile_field VARCHAR(32)  NOT NULL COMMENT 'accept_factory / locked_region / expect_job_type ...',
    match_role    VARCHAR(16)  NOT NULL COMMENT 'HARD_FILTER / SOFT_WEIGHT',
    options       JSON         NOT NULL COMMENT '[{code,label,sub,value}]',
    UNIQUE KEY uk_qq_seq (version_id, seq)
) COMMENT '题目（≤7 题，硬过滤题前置）';

CREATE TABLE engine_config (
    version_id   INT         NOT NULL PRIMARY KEY,
    status       VARCHAR(16) NOT NULL COMMENT 'DRAFT / ACTIVE / ARCHIVED',
    config       JSON        NOT NULL COMMENT '因子权重、衰减曲线、阈值、同公司上限（P-13）',
    published_by VARCHAR(32) NULL,
    published_at DATETIME(3) NULL,
    created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    active_flag  TINYINT     GENERATED ALWAYS AS (IF(status = 'ACTIVE', 1, NULL)) STORED,
    UNIQUE KEY uk_engine_one_active (active_flag)
) COMMENT '匹配引擎参数版本';

CREATE TABLE match_session (
    session_id       VARCHAR(32)  NOT NULL PRIMARY KEY,
    user_id          VARCHAR(32)  NOT NULL,
    quiz_version_id  INT          NOT NULL,
    engine_version_id INT         NULL,
    scope            VARCHAR(24)  NOT NULL COMMENT 'ALL_PLATFORM / OWN_COMPANY',
    scope_company_id VARCHAR(32)  NULL,
    answers          JSON         NULL,
    profile          JSON         NULL COMMENT '画像标签',
    profile_version  INT          NULL,
    status           VARCHAR(16)  NOT NULL DEFAULT 'ANSWERING' COMMENT 'ANSWERING / MATCHED / NO_MATCH / ABANDONED',
    started_at       DATETIME(3)  NOT NULL,
    finished_at      DATETIME(3)  NULL,
    KEY idx_ms_user (user_id, started_at)
) COMMENT '答题会话';

CREATE TABLE match_result (
    id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    session_id    VARCHAR(32)  NOT NULL,
    rank_no       TINYINT      NOT NULL,
    job_id        VARCHAR(32)  NOT NULL,
    match_score   DECIMAL(5,2) NOT NULL COMMENT '匹配度 0~100',
    job_weight    DECIMAL(4,3) NOT NULL,
    sort_score    DECIMAL(7,3) NOT NULL,
    factor_scores JSON         NOT NULL COMMENT '各因子得分，用于解释与回放',
    reason_text   VARCHAR(255) NULL,
    displayed     TINYINT(1)   NOT NULL COMMENT '匹配度 ≥ 阈值才展示',
    UNIQUE KEY uk_mr_rank (session_id, rank_no),
    KEY idx_mr_job (job_id)
) COMMENT '匹配结果快照（报名校验：岗位必须出现在用户最近一次匹配结果中）';

CREATE TABLE broker_case (
    id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id        VARCHAR(32)  NOT NULL,
    company_id     VARCHAR(32)  NOT NULL,
    trigger_type   VARCHAR(24)  NOT NULL COMMENT 'LOW_MATCH / REMATCH_LIMIT / SITE_TRANSFER / JOB_CHANGE',
    match_session_id VARCHAR(32) NULL,
    from_member_id VARCHAR(32)  NULL COMMENT '驻场流转时的操作人',
    broker_id      VARCHAR(32)  NULL,
    status         VARCHAR(16)  NOT NULL DEFAULT 'OPEN' COMMENT 'OPEN / CONTACTED / RECOMMENDED / APPLIED / RELEASED / CLOSED',
    contact_due_at DATETIME(3)  NOT NULL COMMENT 'D-10：2h 内联系',
    resolve_due_at DATETIME(3)  NOT NULL COMMENT 'D-10：24h 内出结果，否则自动释放',
    contacted_at   DATETIME(3)  NULL,
    closed_at      DATETIME(3)  NULL,
    created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_bc_company_status (company_id, status, resolve_due_at),
    KEY idx_bc_user (user_id)
) COMMENT '人才经纪人流转池（T-201）';

CREATE TABLE ai_report (
    id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id    VARCHAR(32)  NOT NULL,
    broker_case_id BIGINT      NOT NULL,
    summary       TEXT         NOT NULL,
    recommendations JSON       NOT NULL COMMENT '3 个推荐岗位 + 推荐理由',
    generator     VARCHAR(16)  NOT NULL COMMENT 'TEMPLATE / LLM',
    created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_ar_case (broker_case_id)
) COMMENT 'AI 岗位匹配分析报告（T-202）';

CREATE TABLE broker_recommendation (
    id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id     VARCHAR(32)  NOT NULL,
    broker_case_id BIGINT       NOT NULL,
    job_id         VARCHAR(32)  NOT NULL,
    broker_id      VARCHAR(32)  NOT NULL,
    note           VARCHAR(255) NULL,
    user_decision  VARCHAR(16)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING / ACCEPTED / DECLINED',
    decided_at     DATETIME(3)  NULL,
    created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_br_case (broker_case_id)
) COMMENT '经纪人二次推荐（用户在 C 端确认后走正常实名报名，T-203）';

CREATE TABLE kb_entry (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id  VARCHAR(32)  NOT NULL,
    project_id  VARCHAR(32)  NULL,
    job_id      VARCHAR(32)  NULL,
    question    VARCHAR(255) NOT NULL,
    answer      TEXT         NOT NULL,
    status      VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE',
    updated_by  VARCHAR(32)  NOT NULL,
    updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    KEY idx_kb_scope (company_id, project_id, job_id),
    FULLTEXT KEY ft_kb_q (question, answer) WITH PARSER ngram
) COMMENT '岗位知识库（T-305）';

CREATE TABLE kb_query_log (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id  VARCHAR(32)  NOT NULL COMMENT '岗位所属公司（未命中问题回流该公司知识库）',
    user_id     VARCHAR(32)  NOT NULL,
    job_id      VARCHAR(32)  NOT NULL,
    question    VARCHAR(255) NOT NULL,
    hit_entry_id BIGINT      NULL,
    answered_by VARCHAR(16)  NOT NULL COMMENT 'KB / LLM / HUMAN_PENDING',
    created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_kql_job (job_id, hit_entry_id)
) COMMENT '岗位 AI 问答日志（未命中回流知识库待补）';
