package com.shitu.notify.outbox;

import com.fasterxml.jackson.databind.JsonNode;

/** 发件箱事件订阅方（通知、统计、风控……）。抛异常 = 本次投递失败，按退避重试。 */
public interface OutboxHandler {

    /** 关心的事件类型。 */
    boolean supports(String eventType);

    void handle(long outboxId, String eventType, String aggregateId, JsonNode payload);
}
