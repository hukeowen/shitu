package com.shitu.app.ops;

import com.shitu.common.api.ApiResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 平台中台 · 系统运行状态：定时任务最近一次运行、通知积压、短信失败。
 * 给运营一个不用翻日志就能看到「后台有没有在正常跑」的地方；有异常项时工作台会标出来。
 */
@Tag(name = "平台中台 · 系统运行状态")
@RestController
@RequestMapping("/api/v1/ops")
public class OpsHealthController {

    /** state：OK 正常 / LATE 超过预期间隔没运行 / NEVER 还没运行过（刚上线的新任务、每月任务属正常） */
    public record Job(String name, String title, LocalDateTime lastRunAt, Long minutesAgo, int expectedEveryMinutes, String state) {
    }

    public record Outbox(long pending, long stuck, long dead) {
    }

    public record Sms(long sentToday, long failedToday, long deferredPending) {
    }

    public record Health(List<Job> jobs, Outbox outbox, Sms sms, int issues, List<String> issueTexts) {
    }

    /** 任务名 → 中文名、预期最长间隔（分钟，已留余量）。顺序即展示顺序 */
    private static final Map<String, Object[]> JOBS = new LinkedHashMap<>();

    static {
        JOBS.put("outbox_dispatch", new Object[]{"通知与事件投递", 5});
        JOBS.put("response_window_scan", new Object[]{"24 小时响应窗口超时释放", 10});
        JOBS.put("follow_up_reminder", new Object[]{"跟进提醒（剩 4 小时 / 1 小时）", 10});
        JOBS.put("broker_sla", new Object[]{"经纪人联系与处理时限", 10});
        JOBS.put("deferred_sms", new Object[]{"免打扰时段后补发短信", 10});
        JOBS.put("job_weight", new Object[]{"岗位权重重算", 130});
        JOBS.put("scheduled_resign", new Object[]{"到期离职生效", 130});
        JOBS.put("daily_billing", new Object[]{"每日计费", 1500});
        JOBS.put("job_health", new Object[]{"陈旧岗位与诚信分复核", 1500});
        JOBS.put("contract_expiry", new Object[]{"合同到期提醒", 1500});
        JOBS.put("bill_collection", new Object[]{"账单催收", 1500});
        JOBS.put("staff_digest_evening", new Object[]{"驻场晚间待办汇总", 1500});
        JOBS.put("staff_digest_morning", new Object[]{"驻场早间待办汇总", 1500});
        JOBS.put("monthly_bill", new Object[]{"月账单生成与下发", 46080});
    }

    private final JdbcTemplate jdbc;

    public OpsHealthController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Operation(summary = "系统运行状态：定时任务最近运行、通知积压、短信失败")
    @PreAuthorize("hasAnyRole('SUPER','OPERATOR','FINANCE','RISK')")
    @GetMapping("/health-summary")
    public ApiResponse<Health> health() {
        // shedlock 用数据库的 UTC 时间记录；换算成数据库本地时间和「距今多少分钟」
        Map<String, Object[]> last = new HashMap<>();
        jdbc.query("SELECT name, TIMESTAMPADD(SECOND, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()), locked_at), "
                + "TIMESTAMPDIFF(MINUTE, locked_at, UTC_TIMESTAMP()) FROM shedlock", rs -> {
            Timestamp t = rs.getTimestamp(2);
            last.put(rs.getString(1), new Object[]{t == null ? null : t.toLocalDateTime(), rs.getLong(3)});
        });
        List<Job> jobs = new ArrayList<>();
        List<String> issues = new ArrayList<>();
        for (Map.Entry<String, Object[]> e : JOBS.entrySet()) {
            String title = (String) e.getValue()[0];
            int expected = (Integer) e.getValue()[1];
            Object[] l = last.get(e.getKey());
            if (l == null) {
                jobs.add(new Job(e.getKey(), title, null, null, expected, "NEVER"));
                continue;
            }
            long ago = Math.max(0, (Long) l[1]);
            boolean late = ago > expected;
            jobs.add(new Job(e.getKey(), title, (LocalDateTime) l[0], ago, expected, late ? "LATE" : "OK"));
            if (late) {
                issues.add("定时任务「" + title + "」已 " + human(ago) + "没有运行");
            }
        }
        long pending = count("SELECT COUNT(*) FROM outbox_event WHERE status = 'PENDING'");
        long stuck = count("SELECT COUNT(*) FROM outbox_event WHERE status = 'PENDING' AND created_at < NOW() - INTERVAL 10 MINUTE");
        long dead = count("SELECT COUNT(*) FROM outbox_event WHERE status = 'DEAD'");
        if (stuck > 0) {
            issues.add(stuck + " 条通知 / 事件积压超过 10 分钟没有发出");
        }
        if (dead > 0) {
            issues.add(dead + " 条通知 / 事件多次重试失败，已停止重试");
        }
        long sent = count("SELECT COUNT(*) FROM sms_log WHERE status = 'SENT' AND created_at >= CURDATE()");
        long failed = count("SELECT COUNT(*) FROM sms_log WHERE status = 'FAILED' AND created_at >= CURDATE()");
        long deferred = count("SELECT COUNT(*) FROM sms_deferred WHERE status = 'PENDING' AND send_after < NOW() - INTERVAL 15 MINUTE");
        if (failed > 0) {
            issues.add("今天有 " + failed + " 条短信发送失败");
        }
        if (deferred > 0) {
            issues.add(deferred + " 条延迟短信到时间后还没补发");
        }
        return ApiResponse.ok(new Health(jobs, new Outbox(pending, stuck, dead), new Sms(sent, failed, deferred), issues.size(), issues));
    }

    private long count(String sql) {
        Long n = jdbc.queryForObject(sql, Long.class);
        return n == null ? 0 : n;
    }

    private static String human(long minutes) {
        if (minutes < 120) {
            return minutes + " 分钟";
        }
        return minutes < 2880 ? minutes / 60 + " 小时" : minutes / 1440 + " 天";
    }
}
