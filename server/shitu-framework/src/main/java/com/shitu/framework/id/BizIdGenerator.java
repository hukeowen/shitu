package com.shitu.framework.id;

import com.shitu.common.Constants;
import com.zaxxer.hikari.HikariDataSource;
import jakarta.annotation.PreDestroy;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Clock;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

/**
 * 业务编号：可读、按日递增，例如 {@code U2026110600001}（用户）、{@code C10023}（公司）、{@code J20261106008}（岗位）。
 * <p>序列存在 {@code biz_sequence}，用<b>独立的小连接池</b>（自动提交）递增：
 * <ul>
 *   <li>不加入外层业务事务 —— 序列行不会被长事务锁住，并发报名不会在序列上排队；</li>
 *   <li>不占用主连接池 —— 若在主池里开 REQUIRES_NEW，高并发下每个请求要同时占两个连接，池会被耗尽（Sprint 2 并发验收发现）。</li>
 * </ul>
 * 外层事务回滚时编号会跳号，业务上可以接受。
 */
@Component
public class BizIdGenerator {

    private static final DateTimeFormatter DAY = DateTimeFormatter.BASIC_ISO_DATE;
    private static final char[] SHORT_CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ".toCharArray();

    private final HikariDataSource pool;
    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    public BizIdGenerator(DataSourceProperties props, Clock clock) {
        HikariDataSource ds = props.initializeDataSourceBuilder().type(HikariDataSource.class).build();
        ds.setPoolName("shitu-sequence");
        ds.setMaximumPoolSize(4);
        ds.setMinimumIdle(1);
        ds.setAutoCommit(true);
        this.pool = ds;
        this.jdbc = new JdbcTemplate(ds);
        this.clock = clock;
    }

    @PreDestroy
    void close() {
        pool.close();
    }

    /** 原子递增并返回新值（首次为 start）。INSERT 与 LAST_INSERT_ID 在同一连接上执行。 */
    public long next(String seqKey, long start) {
        Long v = jdbc.execute((java.sql.Connection con) -> {
            try (var ps = con.prepareStatement(
                    "INSERT INTO biz_sequence (seq_key, value) VALUES (?, LAST_INSERT_ID(?)) "
                            + "ON DUPLICATE KEY UPDATE value = LAST_INSERT_ID(value + 1)")) {
                ps.setString(1, seqKey);
                ps.setLong(2, start);
                ps.executeUpdate();
            }
            try (Statement st = con.createStatement(); ResultSet rs = st.executeQuery("SELECT LAST_INSERT_ID()")) {
                rs.next();
                return rs.getLong(1);
            }
        });
        if (v == null) {
            throw new IllegalStateException("sequence " + seqKey + " failed");
        }
        return v;
    }

    /** 前缀 + yyyyMMdd + 至少 digits 位的当日序号，如 dated("U", 5) → U2026110600001。 */
    public String dated(String prefix, int digits) {
        String day = LocalDate.now(clock.withZone(Constants.ZONE)).format(DAY);
        long n = next(prefix + ":" + day, 1);
        return prefix + day + pad(n, digits);
    }

    /** 全局递增编号，如 global("C", 10001) → C10001、C10002 …。 */
    public String global(String prefix, long start) {
        return prefix + next(prefix, start);
    }

    /** 不可猜测的短码（渠道码），去掉了 0/O、1/l/I 等易混字符。 */
    public String shortCode(int length) {
        char[] c = new char[length];
        for (int i = 0; i < length; i++) {
            c[i] = SHORT_CODE_ALPHABET[random.nextInt(SHORT_CODE_ALPHABET.length)];
        }
        return new String(c);
    }

    /** 32 位十六进制随机 ID（会话等内部主键）。 */
    public String uuid() {
        return java.util.UUID.randomUUID().toString().replace("-", "");
    }

    private static String pad(long n, int digits) {
        String s = Long.toString(n);
        return s.length() >= digits ? s : "0".repeat(digits - s.length()) + s;
    }
}
