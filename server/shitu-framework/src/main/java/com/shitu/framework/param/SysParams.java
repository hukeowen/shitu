package com.shitu.framework.param;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

/**
 * 系统参数（{@code sys_param}，平台中台可改、不发版）。读多写少，进程内缓存 60 秒。
 * <p>读不到时使用调用方给的默认值，并打警告日志 —— 参数缺失不能导致业务中断。
 */
@Component
public class SysParams {

    private static final Logger log = LoggerFactory.getLogger(SysParams.class);
    private static final long TTL_MS = 60_000;

    private final JdbcTemplate jdbc;
    private final Clock clock;
    private volatile Map<String, String> cache = Map.of();
    private volatile Instant loadedAt = Instant.EPOCH;

    public SysParams(JdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    private Map<String, String> values() {
        Instant now = clock.instant();
        if (now.toEpochMilli() - loadedAt.toEpochMilli() > TTL_MS) {
            synchronized (this) {
                if (now.toEpochMilli() - loadedAt.toEpochMilli() > TTL_MS) {
                    Map<String, String> m = new HashMap<>();
                    jdbc.query("SELECT param_key, param_value FROM sys_param",
                            rs -> {
                                m.put(rs.getString(1), rs.getString(2));
                            });
                    cache = Map.copyOf(m);
                    loadedAt = now;
                }
            }
        }
        return cache;
    }

    public String getString(String key, String def) {
        String v = values().get(key);
        if (v == null) {
            log.warn("sys_param {} missing, using default {}", key, def);
            return def;
        }
        return v;
    }

    public int getInt(String key, int def) {
        try {
            return Integer.parseInt(getString(key, String.valueOf(def)).trim());
        } catch (NumberFormatException e) {
            log.warn("sys_param {} is not an int, using default {}", key, def);
            return def;
        }
    }

    public BigDecimal getDecimal(String key, BigDecimal def) {
        try {
            return new BigDecimal(getString(key, def.toPlainString()).trim());
        } catch (NumberFormatException e) {
            return def;
        }
    }

    /** 参数修改后立即失效缓存（仅本实例；其他实例 60 秒内生效）。 */
    public void invalidate() {
        loadedAt = Instant.EPOCH;
    }
}
