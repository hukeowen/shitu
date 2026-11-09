package com.shitu.app.config;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.binder.MeterBinder;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.function.Supplier;

/**
 * 业务健康指标（/actuator/prometheus），告警规则见 docs/06-运维手册.md：
 * <ul>
 *   <li>{@code shitu_outbox_pending}：待投递事件数；持续增长 = 投递任务卡住</li>
 *   <li>{@code shitu_outbox_dead}：死信数；&gt; 0 即告警（通知 / 释放等副作用没有执行）</li>
 *   <li>{@code shitu_response_window_overdue}：已过截止 5 分钟仍未处理的 24h 窗口；&gt; 0 = 超时扫描没在跑</li>
 *   <li>{@code shitu_daily_billing_lag_days}：最近一次每日计费距今天数；&gt; 1 = 计费任务漏跑</li>
 * </ul>
 * 只做轻量 COUNT（有索引），Prometheus 每 30s 抓取一次。
 */
@Component
public class BusinessMetrics implements MeterBinder {

    private final JdbcTemplate jdbc;

    public BusinessMetrics(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void bindTo(MeterRegistry registry) {
        gauge(registry, "shitu.outbox.pending", "待投递的发件箱事件",
                () -> count("SELECT COUNT(*) FROM outbox_event WHERE status = 'PENDING'"));
        gauge(registry, "shitu.outbox.dead", "投递失败进入死信的事件",
                () -> count("SELECT COUNT(*) FROM outbox_event WHERE status = 'DEAD'"));
        gauge(registry, "shitu.response.window.overdue", "过截止 5 分钟仍未处理的 24h 响应窗口",
                () -> count("SELECT COUNT(*) FROM response_window WHERE status = 'OPEN' "
                        + "AND deadline < DATE_SUB(NOW(3), INTERVAL 5 MINUTE)"));
        gauge(registry, "shitu.daily.billing.lag.days", "最近一次每日计费距今天数",
                () -> count("SELECT COALESCE(DATEDIFF(CURRENT_DATE, MAX(biz_date)), 999) FROM company_fee_daily"));
    }

    private static void gauge(MeterRegistry r, String name, String desc, Supplier<Number> f) {
        Gauge.builder(name, f).description(desc).register(r);
    }

    private long count(String sql) {
        try {
            Long n = jdbc.queryForObject(sql, Long.class);
            return n == null ? 0 : n;
        } catch (RuntimeException e) {
            return -1;   // 数据库不可用时返回 -1，由 DB 健康检查另行告警
        }
    }
}
