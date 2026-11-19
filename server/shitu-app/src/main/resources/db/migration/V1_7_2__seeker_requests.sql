-- 求职者自助渠道：申请取消报名、申请离职。
-- R-04 不变：取消报名仍由驻场 / 项目经理执行，求职者只是提出申请；离职仍由项目经理审核。

CREATE TABLE application_cancel_request (
    id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    application_id VARCHAR(32)  NOT NULL,
    user_id        VARCHAR(32)  NOT NULL,
    company_id     VARCHAR(32)  NOT NULL,
    project_id     VARCHAR(32)  NOT NULL,
    reason         VARCHAR(255) NOT NULL,
    status         VARCHAR(16)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING 待处理 / APPROVED 已同意并取消 / REJECTED 未同意 / CLOSED 报名已因其他原因结束',
    reply          VARCHAR(255) NULL COMMENT '不同意时给求职者的说明',
    handled_by     VARCHAR(32)  NULL,
    handled_at     DATETIME(3)  NULL,
    created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_acr_company_status (company_id, status),
    KEY idx_acr_application (application_id)
) COMMENT '求职者提出的取消报名申请（由驻场 / 项目经理处理）';

ALTER TABLE resign_request
    ADD COLUMN source VARCHAR(8) NOT NULL DEFAULT 'STAFF' COMMENT 'STAFF 驻场 / 项目经理发起；SEEKER 员工本人申请' AFTER requested_by;

INSERT INTO notify_template (template_code, channels, title, content, variables, respect_quiet_hours) VALUES
('STAFF_NOTICE',  'INBOX,SMS', '待处理申请', '${content}', 'content', 1),
('SEEKER_NOTICE', 'INBOX,SMS', '申请进展',   '${content}', 'content', 1);
