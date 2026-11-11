-- =====================================================================
-- 工伤紧急异常（T-405）：驻场 / 项目经理上报，推送老板与项目经理，处理后结案留痕
-- =====================================================================
CREATE TABLE incident (
    id           BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id   VARCHAR(32)  NOT NULL,
    project_id   VARCHAR(32)  NOT NULL,
    person_name  VARCHAR(30)  NOT NULL COMMENT '受伤人员（上报人填写）',
    severity     VARCHAR(16)  NOT NULL COMMENT 'MINOR 轻伤 / SERIOUS 需送医 / CRITICAL 危重',
    occurred_at  DATETIME(3)  NOT NULL,
    detail       VARCHAR(500) NOT NULL,
    status       VARCHAR(16)  NOT NULL DEFAULT 'OPEN' COMMENT 'OPEN / CLOSED',
    reported_by  VARCHAR(32)  NOT NULL,
    handle_note  VARCHAR(500) NULL,
    closed_by    VARCHAR(32)  NULL,
    closed_at    DATETIME(3)  NULL,
    created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_inc_company (company_id, status, id),
    KEY idx_inc_project (project_id, id)
) COMMENT '工伤紧急异常记录';
