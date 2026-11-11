package com.shitu.app.support;

import com.shitu.common.Constants;
import com.shitu.framework.outbox.OutboxWriter;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 合同到期（J-13 / C-503），每天一次：
 * <ul>
 *   <li>在职员工的生效合同，到期前 60 / 30 / 7 天各提醒一次本人与项目经理。
 *       用 {@code expiry_reminded} 记录已提醒到哪一档：任务漏跑几天也只补最近的一档，不会一口气连发三条；</li>
 *   <li>过了截止日的生效合同置为「已到期」，通知项目经理续签或办理离职。任职与计费不受影响（人还在岗）。</li>
 * </ul>
 * 任务不在租户请求里，JDBC 显式带公司；逐条独立事务，单条失败不影响其他。
 */
@Component
public class ContractExpiryTask {

    private static final Logger log = LoggerFactory.getLogger(ContractExpiryTask.class);
    private static final int[] THRESHOLDS = {7, 30, 60};

    private final JdbcTemplate jdbc;
    private final OutboxWriter outbox;
    private final TransactionTemplate tx;
    private final Clock clock;

    public ContractExpiryTask(JdbcTemplate jdbc, OutboxWriter outbox, TransactionTemplate tx, Clock clock) {
        this.jdbc = jdbc;
        this.outbox = outbox;
        this.tx = tx;
        this.clock = clock;
    }

    @Scheduled(cron = "${shitu.jobs.contract-expiry-cron:0 0 9 * * *}", zone = "Asia/Shanghai")
    @SchedulerLock(name = "contract_expiry", lockAtMostFor = "PT20M")
    public void scheduled() {
        int[] r = run();
        log.info("合同到期扫描：到期提醒 {}，置为已到期 {}", r[0], r[1]);
    }

    /** @return [提醒数, 置为已到期数] */
    public int[] run() {
        LocalDate today = LocalDate.now(clock.withZone(Constants.ZONE));
        int reminded = 0;
        int expired = 0;

        List<Map<String, Object>> due = jdbc.queryForList("SELECT c.contract_id, c.company_id, c.user_id, c.term_end, e.project_id, "
                + "co.name AS company_name FROM contract c JOIN employment e ON e.employment_id = c.employment_id AND e.end_date IS NULL "
                + "JOIN company co ON co.company_id = c.company_id WHERE c.status = 'EFFECTIVE' AND c.term_end < ? LIMIT 2000", today);
        for (Map<String, Object> c : due) {
            Boolean ok = tx.execute(s -> {
                if (jdbc.update("UPDATE contract SET status = 'EXPIRED', ended_at = ? WHERE contract_id = ? AND status = 'EFFECTIVE'",
                        LocalDateTime.now(clock), c.get("contract_id")) != 1) {
                    return false;
                }
                outbox.publish("CONTRACT_EXPIRED", "CONTRACT", (String) c.get("contract_id"), payload(c, 0));
                return true;
            });
            if (Boolean.TRUE.equals(ok)) {
                expired++;
            }
        }

        for (int days : THRESHOLDS) {
            List<Map<String, Object>> rows = jdbc.queryForList("SELECT c.contract_id, c.company_id, c.user_id, c.term_end, e.project_id, "
                    + "co.name AS company_name FROM contract c JOIN employment e ON e.employment_id = c.employment_id AND e.end_date IS NULL "
                    + "JOIN company co ON co.company_id = c.company_id WHERE c.status = 'EFFECTIVE' AND c.term_end >= ? AND c.term_end <= ? "
                    + "AND (c.expiry_reminded IS NULL OR c.expiry_reminded > ?) LIMIT 2000", today, today.plusDays(days), days);
            for (Map<String, Object> c : rows) {
                Boolean ok = tx.execute(s -> {
                    if (jdbc.update("UPDATE contract SET expiry_reminded = ? WHERE contract_id = ? AND status = 'EFFECTIVE' "
                            + "AND (expiry_reminded IS NULL OR expiry_reminded > ?)", days, c.get("contract_id"), days) != 1) {
                        return false;
                    }
                    long left = java.time.temporal.ChronoUnit.DAYS.between(today, ((java.sql.Date) c.get("term_end")).toLocalDate());
                    outbox.publish("CONTRACT_EXPIRING", "CONTRACT", (String) c.get("contract_id"), payload(c, left));
                    return true;
                });
                if (Boolean.TRUE.equals(ok)) {
                    reminded++;
                }
            }
        }
        return new int[]{reminded, expired};
    }

    private static Map<String, Object> payload(Map<String, Object> c, long daysLeft) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("companyId", c.get("company_id"));
        m.put("projectId", c.get("project_id"));
        m.put("userId", c.get("user_id"));
        m.put("companyName", c.get("company_name"));
        m.put("termEnd", String.valueOf(c.get("term_end")));
        m.put("days", String.valueOf(daysLeft));
        return m;
    }
}
