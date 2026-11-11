-- 问题反馈（C-508）、工资申诉通知（C-702）、审核结果通知；D-06 释放通知原公司加短信

CREATE TABLE feedback (
    id          BIGINT        NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id     VARCHAR(32)   NOT NULL,
    category    VARCHAR(24)   NOT NULL COMMENT 'ACCOUNT / JOB / PAY / CONTRACT / SUGGEST / OTHER',
    content     VARCHAR(1000) NOT NULL,
    contact     VARCHAR(64)   NULL COMMENT '回访电话（可选，默认用注册手机号）',
    status      VARCHAR(16)   NOT NULL DEFAULT 'OPEN' COMMENT 'OPEN / REPLIED / CLOSED',
    reply       VARCHAR(1000) NULL,
    handled_by  VARCHAR(32)   NULL,
    created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    handled_at  DATETIME(3)   NULL,
    KEY idx_fb_user (user_id, id),
    KEY idx_fb_status (status, id)
) COMMENT '问题反馈工单（C-508，平台处理）';

INSERT INTO notify_template (template_code, channels, title, content, variables, respect_quiet_hours) VALUES
('FEEDBACK_REPLIED',      'INBOX',     '问题反馈已回复',   '你的反馈已回复：${reply}', 'reply', 1),
('PAYSLIP_APPEAL_NEW',    'INBOX',     '新的工资申诉',     '${seekerName} 对 ${month} 工资条提出申诉：${content}', 'seekerName,month,content', 1),
('PAYSLIP_APPEAL_RESULT', 'INBOX,SMS', '工资申诉处理结果', '你对 ${month} 工资条的申诉已处理：${reply}', 'month,reply', 1),
('COMPANY_AUDIT_RESULT',  'INBOX,SMS', '入驻审核结果',     '${result}', 'result', 0),
('JOB_AUDIT_RESULT',      'INBOX',     '岗位审核结果',     '${result}', 'result', 1),
('REMATCH_LIMIT_SITE',    'INBOX',     '求职者多次重新匹配', '${seekerName} 已重新匹配 ${count} 次仍未报名，已转入流转池，请留意跟进。', 'seekerName,count', 1);

UPDATE notify_template SET channels = 'INBOX,SMS' WHERE template_code = 'USER_RELEASED_COMPANY';
