package com.shitu.app.notify;

import com.shitu.common.Constants;
import com.shitu.framework.outbox.OutboxWriter;
import com.shitu.framework.param.SysParams;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * 驻场待办汇总（站内信 + 短信，每人每次最多一条）：
 * <ul>
 *   <li>晚间（默认 20:30）：响应时限在今晚到次日 9:00 之间到期的报名——夜间免打扰时段不发短信，所以提前到晚上提醒；</li>
 *   <li>早间（默认 8:30）：今天之内到期的，以及报名后还没知悉的。</li>
 * </ul>
 * 收件人与逐条提醒一致：该项目的驻场和项目经理；项目没分配人、或还没有报名（私域待匹配）时发给全公司驻场。没有待办的人不发。
 */
@Service
public class StaffDigestService {

    private static final Logger log = LoggerFactory.getLogger(StaffDigestService.class);
    private static final DateTimeFormatter HM = DateTimeFormatter.ofPattern("HH:mm");

    /** 一个人名下的待办：到期数、最早到期时间、未知悉数 */
    private static final class Tally {
        String companyId;
        int due;
        LocalDateTime earliest;
        int unacked;
    }

    private final JdbcTemplate jdbc;
    private final OutboxWriter outbox;
    private final SysParams params;
    private final Clock clock;
    @org.springframework.beans.factory.annotation.Autowired
    private org.springframework.transaction.PlatformTransactionManager txManager;

    public StaffDigestService(JdbcTemplate jdbc, OutboxWriter outbox, SysParams params, Clock clock) {
        this.jdbc = jdbc;
        this.outbox = outbox;
        this.params = params;
        this.clock = clock;
    }

    @Scheduled(cron = "${shitu.jobs.staff-digest-evening-cron:0 30 20 * * *}", zone = "Asia/Shanghai")
    @SchedulerLock(name = "staff_digest_evening", lockAtMostFor = "PT10M", lockAtLeastFor = "PT5M")
    public void scheduledEvening() {
        if (enabled()) {
            // 定时任务线程里直接调本类方法不经过事务代理，发件箱又必须在事务里写：显式开事务
            Integer n = new org.springframework.transaction.support.TransactionTemplate(txManager)
                    .execute(s -> evening(LocalDateTime.now(clock.withZone(Constants.ZONE))));
            log.info("驻场晚间汇总：发出 {} 条", n);
        }
    }

    @Scheduled(cron = "${shitu.jobs.staff-digest-morning-cron:0 30 8 * * *}", zone = "Asia/Shanghai")
    @SchedulerLock(name = "staff_digest_morning", lockAtMostFor = "PT10M", lockAtLeastFor = "PT5M")
    public void scheduledMorning() {
        if (enabled()) {
            Integer n = new org.springframework.transaction.support.TransactionTemplate(txManager)
                    .execute(s -> morning(LocalDateTime.now(clock.withZone(Constants.ZONE))));
            log.info("驻场早间汇总：发出 {} 条", n);
        }
    }

    private boolean enabled() {
        return "true".equalsIgnoreCase(params.getString("notify.staff_digest_enabled", "true"));
    }

    /** 今晚到次日 9:00 之间到期的。 @return 发出的条数 */
    @Transactional
    public int evening(LocalDateTime now) {
        LocalDateTime until = now.toLocalDate().plusDays(1).atTime(LocalTime.of(9, 0));
        Map<String, Tally> byMember = new LinkedHashMap<>();
        collectDue(byMember, now, until);
        int sent = 0;
        for (Map.Entry<String, Tally> e : byMember.entrySet()) {
            Tally t = e.getValue();
            publish(e.getKey(), t.companyId, "今晚到明早 9 点前，你负责的求职者里有 " + t.due + " 人的响应时限到期（最早 "
                    + t.earliest.format(HM) + "），超时会被自动释放，请今晚处理。");
            sent++;
        }
        return sent;
    }

    /** 今天之内到期的 + 报名后还没知悉的。 @return 发出的条数 */
    @Transactional
    public int morning(LocalDateTime now) {
        LocalDateTime until = now.toLocalDate().plusDays(1).atStartOfDay();
        Map<String, Tally> byMember = new LinkedHashMap<>();
        collectDue(byMember, now, until);
        collectUnacked(byMember);
        int sent = 0;
        for (Map.Entry<String, Tally> e : byMember.entrySet()) {
            Tally t = e.getValue();
            List<String> parts = new ArrayList<>();
            if (t.due > 0) {
                parts.add("今天有 " + t.due + " 人的响应时限到期（最早 " + t.earliest.format(HM) + "）");
            }
            if (t.unacked > 0) {
                parts.add((parts.isEmpty() ? "" : "另") + "有 " + t.unacked + " 人报名后还没知悉");
            }
            publish(e.getKey(), t.companyId, String.join("，", parts) + "。请及时处理，超时会被自动释放。");
            sent++;
        }
        return sent;
    }

    // ------------------------------------------------------------------

    private void collectDue(Map<String, Tally> byMember, LocalDateTime from, LocalDateTime until) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT w.company_id, w.deadline, a.project_id FROM response_window w "
                + "LEFT JOIN application a ON a.application_id = w.application_id "
                + "WHERE w.status = 'OPEN' AND w.deadline > ? AND w.deadline <= ?", Timestamp.valueOf(from), Timestamp.valueOf(until));
        Map<String, Staff> cache = new HashMap<>();
        for (Map<String, Object> r : rows) {
            String companyId = (String) r.get("company_id");
            LocalDateTime deadline = ((java.time.LocalDateTime) toLdt(r.get("deadline")));
            for (String m : cache.computeIfAbsent(companyId, this::staff).of((String) r.get("project_id"))) {
                Tally t = byMember.computeIfAbsent(m, k -> new Tally());
                t.companyId = companyId;
                t.due++;
                if (t.earliest == null || deadline.isBefore(t.earliest)) {
                    t.earliest = deadline;
                }
            }
        }
    }

    private void collectUnacked(Map<String, Tally> byMember) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT company_id, project_id, COUNT(*) AS n FROM application "
                + "WHERE status = 'PENDING_INTERVIEW' AND acknowledged_at IS NULL AND ended_at IS NULL GROUP BY company_id, project_id");
        Map<String, Staff> cache = new HashMap<>();
        for (Map<String, Object> r : rows) {
            String companyId = (String) r.get("company_id");
            for (String m : cache.computeIfAbsent(companyId, this::staff).of((String) r.get("project_id"))) {
                Tally t = byMember.computeIfAbsent(m, k -> new Tally());
                t.companyId = companyId;
                t.unacked += ((Number) r.get("n")).intValue();
            }
        }
    }

    private void publish(String memberId, String companyId, String content) {
        outbox.publish("STAFF_DIGEST", "MEMBER", memberId, Map.of("memberId", memberId, "companyId", companyId, "content", content));
    }

    private static LocalDateTime toLdt(Object v) {
        return v instanceof Timestamp ts ? ts.toLocalDateTime() : (LocalDateTime) v;
    }

    /** 一家公司里谁负责哪个项目（只算在职的驻场 / 项目经理）。 */
    private Staff staff(String companyId) {
        Staff s = new Staff();
        jdbc.query("SELECT member_id, roles FROM member WHERE company_id = ? AND status = 'NORMAL'", rs -> {
            Set<String> roles = Set.of(rs.getString(2).split(","));
            if (roles.contains("SITE")) {
                s.sites.add(rs.getString(1));
            }
            if (roles.contains("SITE") || roles.contains("PM")) {
                s.sitesAndPms.add(rs.getString(1));
            }
        }, companyId);
        jdbc.query("SELECT member_id, project_id FROM member_project WHERE company_id = ?", rs -> {
            if (s.sitesAndPms.contains(rs.getString(1))) {
                s.byProject.computeIfAbsent(rs.getString(2), k -> new TreeSet<>()).add(rs.getString(1));
            }
        }, companyId);
        return s;
    }

    private static final class Staff {
        final Set<String> sites = new TreeSet<>();
        final Set<String> sitesAndPms = new TreeSet<>();
        final Map<String, Set<String>> byProject = new HashMap<>();

        /** 该项目的驻场和项目经理；没有项目或项目没分配人时是全公司驻场 */
        Set<String> of(String projectId) {
            Set<String> on = projectId == null ? null : byProject.get(projectId);
            return on == null || on.isEmpty() ? sites : on;
        }
    }
}
