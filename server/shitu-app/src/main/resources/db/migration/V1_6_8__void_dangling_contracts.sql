-- 报名已经结束（超时释放、取消、爽约等）但合同还停在「待签署」的历史数据：作废
UPDATE contract c JOIN application a ON a.application_id = c.application_id
   SET c.status = 'VOIDED', c.ended_at = CURRENT_TIMESTAMP(3)
 WHERE c.status = 'PENDING_SIGN' AND a.status <> 'PENDING_CONFIRM';
