-- =====================================================================
-- 种子数据：计费规则 v1、系统参数（决策记录中的参数化项）、题库 v1、引擎参数 v1、通知模板
-- =====================================================================

INSERT INTO billing_rule (version, effective_from, service_unit_price, transfer_unit_price, supply_share, free_months, created_by)
VALUES (1, '2026-01-01', 0.10, 10.00, 0.80, 3, 'SYSTEM');

INSERT INTO sys_param (param_key, param_value, value_type, description) VALUES
('response_window.duration',         'PT24H', 'DURATION', 'D-06 私域响应窗口时长'),
('response_window.day_start',        '08:00', 'TIME',     'D-14 白天开始'),
('response_window.day_end',          '22:00', 'TIME',     'D-14 白天结束'),
('response_window.day_interval',     'PT6H',  'DURATION', 'D-14 白天提醒间隔'),
('response_window.night_interval',   'PT12H', 'DURATION', 'D-14 夜间提醒间隔'),
('broker.contact_sla',               'PT2H',  'DURATION', 'D-10 经纪人联系时限'),
('broker.resolve_sla',               'PT24H', 'DURATION', 'D-10 经纪人出结果时限，超时自动释放'),
('matching.rematch_alert_count',     '3',     'INT',      'D-11 同一求职周期匹配次数达到后提醒驻场介入'),
('matching.display_threshold',       '80',    'INT',      'R-02 匹配度展示阈值（%）'),
('matching.result_count',            '3',     'INT',      'R-02 固定输出岗位数'),
('matching.max_per_company_public',  '2',     'INT',      'D-30 公域用户结果中同一公司最多岗位数'),
('kyc.ocr_confidence_threshold',     '85',    'INT',      'D-15 OCR 置信度阈值，低于转人工'),
('kyc.min_age_register',             '16',    'INT',      'D-15 未满此年龄硬阻断'),
('kyc.min_age_apply',                '18',    'INT',      'D-15 未满此年龄不能报名'),
('kyc.fraud_phone_count_24h',        '3',     'INT',      'D-17 24h 内同一证件被多少个手机号注册判定刷单'),
('advance.days_per_chance',          '7',     'INT',      'D-26 每满多少在岗日获得一次预支机会'),
('advance.amount',                   '500.00','DECIMAL',  '文档 6.5 单次预支金额'),
('advance.monthly_limit',            '4',     'INT',      '文档 6.5 每月最多次数'),
('bill.dispute_workdays',            '5',     'INT',      'D-23 账单异议期（工作日）'),
('bill.settle_day_of_next_month',    '15',    'INT',      '文档 14.3 次月结算截止日'),
('sms.code_interval_seconds',        '60',    'INT',      '同一手机号验证码发送间隔'),
('sms.code_daily_limit',             '10',    'INT',      '同一手机号每日验证码上限'),
('disclaimer.version',               '1.0',   'STRING',   '告知书当前版本（变更后用户需重新同意）');

-- ---------------- 题库 v1（原型 P-12） ----------------
INSERT INTO quiz_version (version_id, name, status, published_by, published_at) VALUES
(1, 'v1.0 初始题库', 'ACTIVE', 'SYSTEM', CURRENT_TIMESTAMP(3));

INSERT INTO quiz_question (version_id, seq, question_type, stem, hint, profile_field, match_role, options) VALUES
(1, 1, 'JUDGE', '你能接受进工厂上班吗？', '车间流水线 / 仓储 / 装配等岗位', 'accept_factory', 'HARD_FILTER',
 '[{"code":"A","label":"能接受，我就是找厂里的活儿","value":"YES"},{"code":"B","label":"可以试试，但想先了解环境","value":"MAYBE"},{"code":"C","label":"不接受进厂，只看厂外岗位","value":"NO"}]'),
(1, 2, 'JUDGE', '是否只考虑某个城市 / 区域？', '选择后仅匹配该地域岗位', 'locked_region', 'HARD_FILTER',
 '[{"code":"A","label":"是，只看我选的地方","value":"LOCKED","needRegion":true},{"code":"B","label":"不限，哪里合适去哪里","value":"ANY"}]'),
(1, 3, 'CHOICE', '你想做哪一类工种？', NULL, 'expect_job_type', 'SOFT_WEIGHT',
 '[{"code":"A","label":"电子组装 / SMT","value":"ELECTRONICS"},{"code":"B","label":"普工 / 流水线","value":"GENERAL"},{"code":"C","label":"仓储 / 分拣 / 物流","value":"WAREHOUSE"},{"code":"D","label":"注塑 / 机加工","value":"MACHINING"},{"code":"E","label":"质检 / 品管","value":"QC"},{"code":"F","label":"都可以","value":"ANY"}]'),
(1, 4, 'CHOICE', '你期望的月综合收入大概是多少？', '含加班费，按每月出勤 26 天估算', 'expect_salary', 'SOFT_WEIGHT',
 '[{"code":"A","label":"4,500 – 5,500 元","sub":"轻松班次","min":4500,"max":5500},{"code":"B","label":"5,500 – 6,500 元","sub":"正常加班","min":5500,"max":6500},{"code":"C","label":"6,500 – 8,000 元","sub":"接受多加班","min":6500,"max":8000},{"code":"D","label":"8,000 元以上","sub":"技术 / 夜班岗","min":8000,"max":12000}]'),
(1, 5, 'CHOICE', '能接受什么班次？', NULL, 'shift_pref', 'SOFT_WEIGHT',
 '[{"code":"A","label":"只做白班","value":"DAY"},{"code":"B","label":"两班倒可以","value":"TWO_SHIFT"},{"code":"C","label":"夜班也行","value":"NIGHT"},{"code":"D","label":"长白班","value":"LONG_DAY"}]'),
(1, 6, 'CHOICE', '对住宿有什么要求？', NULL, 'dorm_req', 'SOFT_WEIGHT',
 '[{"code":"A","label":"必须包住","value":"REQUIRED"},{"code":"B","label":"包住，最好 4 人间以内","value":"SMALL_ROOM"},{"code":"C","label":"包住，要有空调","value":"AIRCON"},{"code":"D","label":"不需要住宿","value":"NONE"}]'),
(1, 7, 'CHOICE', '相关工作做过多久？', NULL, 'work_years', 'SOFT_WEIGHT',
 '[{"code":"A","label":"没做过","value":0},{"code":"B","label":"1 年以内","value":1},{"code":"C","label":"1 – 3 年","value":2},{"code":"D","label":"3 年以上","value":3}]');

-- ---------------- 匹配引擎参数 v1（原型 P-13，D-29 / D-30） ----------------
INSERT INTO engine_config (version_id, status, config, published_by, published_at) VALUES
(1, 'ACTIVE', '{
  "factorWeights": {"jobType": 30, "salary": 25, "distance": 20, "shift": 10, "dorm": 10, "experience": 5},
  "distanceScore": [{"maxKm": 10, "score": 100}, {"maxKm": 30, "score": 80}, {"maxKm": 60, "score": 50}, {"maxKm": null, "score": 20}],
  "decay": [{"maxDays": 7, "factor": 1.0}, {"maxDays": 14, "factor": 0.8}, {"maxDays": 30, "factor": 0.5}, {"maxDays": 60, "factor": 0.2}, {"maxDays": null, "factor": 0.0}],
  "lowConversion": {"minPostedDays": 15, "maxConversionRate": 0.10, "factor": 0.5},
  "combineDecayAndConversion": "MIN",
  "resetDecayOnHire": true,
  "credit": [{"minScore": 60, "factor": 1.0}, {"minScore": 30, "factor": 0.2}, {"minScore": 0, "factor": 0.0}],
  "penalty": {"level2": 0.5, "level3": 0.0},
  "quota": {"lowRemaining": 2, "factor": 0.6},
  "newJobBoost": {"maxDays": 3, "factor": 1.15},
  "displayThreshold": 80,
  "resultCount": 3,
  "maxPerCompanyPublic": 2
}', 'SYSTEM', CURRENT_TIMESTAMP(3));

-- ---------------- 通知模板（站内信 + 短信，D-05） ----------------
INSERT INTO notify_template (template_code, channels, title, content, respect_quiet_hours) VALUES
('APPLICATION_CREATED_SITE',  'INBOX',     '新报名待知悉',   '${seekerName} 报名了「${jobTitle}」，请在 24 小时内点击知悉并推送面试信息。', 0),
('INTERVIEW_INFO_PUSHED',     'INBOX,SMS', '面试信息',       '你报名的「${jobTitle}」面试时间 ${interviewAt}，地点 ${address}。请带好：${documents}。', 0),
('ARRIVAL_CONFIRMED',         'INBOX',     '已确认到厂',     '你已到厂签到，面试结果出来后会第一时间通知你。', 1),
('CONTRACT_SIGN_REQUIRED',    'INBOX,SMS', '请签署劳动合同', '恭喜通过面试！请在 24 小时内完成线上签约：${signUrl}', 0),
('CONTRACT_SIGNED_MANAGER',   'INBOX',     '签约完成',       '${seekerName} 已完成「${jobTitle}」电子签约，状态已变为在岗。', 1),
('FOLLOW_UP_REMINDER',        'INBOX',     '24h 跟进提醒',   '${seekerName}（${stage}）剩余 ${remaining}，超时将被释放至公域。', 0),
('USER_RELEASED',             'INBOX,SMS', '求职状态变更',   '你现在可以匹配全平台的岗位了，打开仕兔重新问薪即可。', 1),
('USER_RELEASED_COMPANY',     'INBOX',     '用户已释放',     '${seekerName} 已被释放至公域，原因：${reason}。', 1),
('BROKER_CASE_CREATED',       'INBOX',     '新的流转用户',   '${seekerName} 已转入流转池，请在 2 小时内联系。', 0),
('ADVANCE_PENDING_APPROVAL',  'INBOX',     '预支待审批',     '${seekerName} 申请预支 ${amount} 元，请尽快审批。', 1),
('ADVANCE_RESULT',            'INBOX,SMS', '预支审批结果',   '你的 ${amount} 元预支申请${result}。', 1),
('MONTHLY_BILL_ISSUED',       'INBOX',     '月度账单',       '${month} 账单已生成，应付 ${payable} 元，如有异议请在 ${disputeDeadline} 前提出。', 1),
('INJURY_ALERT',              'INBOX,SMS', '工伤紧急异常',   '${projectName} 发生工伤事件：${detail}', 0);
