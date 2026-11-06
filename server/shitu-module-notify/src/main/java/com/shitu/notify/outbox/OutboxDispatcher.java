package com.shitu.notify.outbox;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 发件箱投递（02-架构 §9）：每 2 秒取一批待投递事件，分发给所有订阅方。
 * <ul>
 *   <li>全部订阅方成功 → DONE；任一失败 → 指数退避（2^n 秒，最长 1 小时）重试；</li>
 *   <li>失败满 {@value #MAX_ATTEMPTS} 次 → DEAD，打错误日志告警，平台可人工重放；</li>
 *   <li>订阅方必须幂等（站内信按 outboxId 唯一）—— 「至少一次」投递。</li>
 * </ul>
 * {@code outbox_event} 是平台专属表，直接用 JDBC 访问。
 */
@Component
public class OutboxDispatcher {

    private static final Logger log = LoggerFactory.getLogger(OutboxDispatcher.class);
    static final int MAX_ATTEMPTS = 10;
    private static final int BATCH = 100;

    private record Row(long id, String eventType, String aggregateId, String payload, int attempts) {
    }

    private final JdbcTemplate jdbc;
    private final List<OutboxHandler> handlers;
    private final ObjectMapper json;
    private final Clock clock;

    public OutboxDispatcher(JdbcTemplate jdbc, List<OutboxHandler> handlers, ObjectMapper json, Clock clock) {
        this.jdbc = jdbc;
        this.handlers = handlers;
        this.json = json;
        this.clock = clock;
    }

    @Scheduled(fixedDelayString = "${shitu.jobs.outbox-dispatch:PT2S}", initialDelayString = "PT10S")
    @SchedulerLock(name = "outbox_dispatch", lockAtMostFor = "PT2M")
    public void scheduled() {
        dispatch();
    }

    /** @return 本次成功投递的事件数 */
    public int dispatch() {
        LocalDateTime now = LocalDateTime.now(clock);
        List<Row> rows = jdbc.query("SELECT id, event_type, aggregate_id, payload, attempts FROM outbox_event "
                        + "WHERE status = 'PENDING' AND next_attempt_at <= ? ORDER BY id LIMIT " + BATCH,
                (rs, i) -> new Row(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getInt(5)), now);
        int done = 0;
        for (Row r : rows) {
            try {
                JsonNode payload = json.readTree(r.payload());
                for (OutboxHandler h : handlers) {
                    if (h.supports(r.eventType())) {
                        h.handle(r.id(), r.eventType(), r.aggregateId(), payload);
                    }
                }
                jdbc.update("UPDATE outbox_event SET status = 'DONE', attempts = attempts + 1, last_error = NULL WHERE id = ?", r.id());
                done++;
            } catch (Exception e) {
                int attempts = r.attempts() + 1;
                boolean dead = attempts >= MAX_ATTEMPTS;
                long backoff = Math.min(3600, 1L << Math.min(attempts, 12));
                String err = String.valueOf(e.getMessage());
                jdbc.update("UPDATE outbox_event SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?",
                        dead ? "DEAD" : "PENDING", attempts, LocalDateTime.now(clock).plus(Duration.ofSeconds(backoff)),
                        err.length() > 1000 ? err.substring(0, 1000) : err, r.id());
                if (dead) {
                    log.error("outbox event {} ({}) dead after {} attempts", r.id(), r.eventType(), attempts, e);
                } else {
                    log.warn("outbox event {} ({}) failed, retry in {}s: {}", r.id(), r.eventType(), backoff, err);
                }
            }
        }
        return done;
    }
}
