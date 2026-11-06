package com.shitu.framework.outbox;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.shitu.framework.web.TraceIdFilter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;

/**
 * 事务发件箱（02-架构 §9）：事件与业务数据在同一事务提交，由投递任务异步分发（通知、报表等）。
 * 必须在业务事务内调用。
 */
@Component
public class OutboxWriter {

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public OutboxWriter(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void publish(String eventType, String aggregateType, String aggregateId, Map<String, ?> payload) {
        String body;
        try {
            body = json.writeValueAsString(payload == null ? Map.of() : payload);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("outbox payload not serializable", e);
        }
        jdbc.update("INSERT INTO outbox_event (event_type, aggregate_type, aggregate_id, payload, trace_id) VALUES (?, ?, ?, ?, ?)",
                eventType, aggregateType, aggregateId, body, TraceIdFilter.current());
    }
}
