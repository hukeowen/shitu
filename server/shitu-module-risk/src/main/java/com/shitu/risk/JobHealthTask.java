package com.shitu.risk;

import com.shitu.common.Constants;
import com.shitu.framework.outbox.OutboxWriter;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * J-05 僵尸岗位 / J-06 陈旧提醒 / J-08 诚信与处罚（T-304，文档 13.1）：
 * <ul>
 *   <li>挂岗 15 天无报名、30 天无入职 → 提醒项目经理更新岗位（每个岗位每种提醒只发一次，直到岗位信息更新）；</li>
 *   <li>45 天未更新岗位信息 → 自动暂停招聘并扣 5 分（STALE_JOB），项目经理更新后可恢复；</li>
 *   <li>每日处罚复核（限流到期解除、单月异常 3 次升级）。</li>
 * </ul>
 */
@Component
public class JobHealthTask {

    private static final Logger log = LoggerFactory.getLogger(JobHealthTask.class);

    private final JdbcTemplate jdbc;
    private final CreditService credit;
    private final OutboxWriter outbox;
    private final TransactionTemplate tx;
    private final Clock clock;

    public JobHealthTask(JdbcTemplate jdbc, CreditService credit, OutboxWriter outbox, TransactionTemplate tx, Clock clock) {
        this.jdbc = jdbc;
        this.credit = credit;
        this.outbox = outbox;
        this.tx = tx;
        this.clock = clock;
    }

    @Scheduled(cron = "${shitu.jobs.job-health-cron:0 30 1 * * *}", zone = "Asia/Shanghai")
    @SchedulerLock(name = "job_health", lockAtMostFor = "PT20M")
    public void scheduled() {
        int[] r = scan();
        int[] p = credit.dailyReview();
        log.info("岗位健康扫描：提醒 {}，自动暂停 {}；处罚复核：解除 {}，升级 {}", r[0], r[1], p[0], p[1]);
    }

    /** @return [提醒数, 自动暂停数] */
    public int[] scan() {
        LocalDateTime now = LocalDateTime.now(clock.withZone(Constants.ZONE));
        int reminded = 0;
        int paused = 0;
        List<Map<String, Object>> jobs = jdbc.queryForList("SELECT j.job_id, j.company_id, j.project_id, j.title, j.posted_at, "
                + "COALESCE(j.last_info_update_at, j.created_at) AS info_at, "
                + "(SELECT MAX(a.created_at) FROM application a WHERE a.job_id = j.job_id) AS last_apply, "
                + "(SELECT COUNT(*) FROM application a WHERE a.job_id = j.job_id AND a.status = 'EMPLOYED' AND a.created_at >= j.posted_at) AS hires "
                + "FROM job j WHERE j.job_status = 'RECRUITING'");
        for (Map<String, Object> j : jobs) {
            String jobId = (String) j.get("job_id");
            LocalDateTime posted = ldt(j.get("posted_at"));
            LocalDateTime infoAt = ldt(j.get("info_at"));
            LocalDateTime lastApply = ldt(j.get("last_apply"));
            if (infoAt != null && infoAt.plusDays(45).isBefore(now)) {
                Boolean ok = tx.execute(s -> {
                    int n = jdbc.update("UPDATE job SET job_status = 'PAUSED', audit_remark = ? WHERE job_id = ? AND job_status = 'RECRUITING'",
                            "45 天未更新岗位信息，系统自动暂停；更新信息后可恢复招聘", jobId);
                    if (n == 1) {
                        credit.adjust((String) j.get("company_id"), -5, "STALE_JOB", "JOB", jobId, "岗位 45 天未更新", null);
                        notifyStale(j, "45 天未更新岗位信息，已自动暂停招聘");
                    }
                    return n == 1;
                });
                if (Boolean.TRUE.equals(ok)) {
                    paused++;
                }
                continue;
            }
            if (posted == null) {
                continue;
            }
            String kind = null;
            if ((lastApply == null || lastApply.isBefore(posted)) && posted.plusDays(15).isBefore(now)) {
                kind = "NO_APPLY_15D";
            } else if (((Number) j.get("hires")).longValue() == 0 && posted.plusDays(30).isBefore(now)) {
                kind = "NO_HIRE_30D";
            }
            if (kind != null && remindOnce(jobId, kind, infoAt)) {
                String k = kind;
                tx.executeWithoutResult(s -> notifyStale(j, "NO_APPLY_15D".equals(k) ? "挂岗 15 天没有报名，请检查薪资和信息是否有竞争力"
                        : "挂岗 30 天没有入职，请更新岗位信息或调整条件"));
                reminded++;
            }
        }
        return new int[]{reminded, paused};
    }

    /** 同一岗位同一种提醒，在岗位信息更新前只发一次（用 risk_event 记录）。 */
    private boolean remindOnce(String jobId, String kind, LocalDateTime infoAt) {
        Long sent = jdbc.queryForObject("SELECT COUNT(*) FROM risk_event WHERE ref_type = 'JOB' AND ref_id = ? AND event_type = ? AND created_at >= ?",
                Long.class, jobId, "STALE_" + kind, infoAt == null ? Timestamp.valueOf("2000-01-01 00:00:00") : Timestamp.valueOf(infoAt));
        if (sent != null && sent > 0) {
            return false;
        }
        String companyId = jdbc.queryForObject("SELECT company_id FROM job WHERE job_id = ?", String.class, jobId);
        // 陈旧提醒不计入「单月异常」：用单独的事件类型前缀，J-08 统计时排除
        jdbc.update("INSERT INTO risk_event (company_id, event_type, ref_type, ref_id) VALUES (?, ?, 'JOB', ?)", companyId, "STALE_" + kind, jobId);
        return true;
    }

    private void notifyStale(Map<String, Object> j, String message) {
        outbox.publish("JOB_STALE", "JOB", (String) j.get("job_id"), Map.of("companyId", j.get("company_id"),
                "projectId", j.get("project_id"), "jobTitle", j.get("title"), "message", message));
    }

    private static LocalDateTime ldt(Object o) {
        if (o instanceof Timestamp t) {
            return t.toLocalDateTime();
        }
        if (o instanceof LocalDateTime l) {
            return l;
        }
        return null;
    }
}
