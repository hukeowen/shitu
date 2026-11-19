package com.shitu.it;

import com.shitu.app.notify.StaffDigestService;
import com.shitu.framework.crypto.FieldCipher;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.security.SecureRandom;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 驻场待办汇总：晚间提醒夜里到期的，早间提醒当天到期与未知悉的；每人一条，按负责的项目归集，没有待办的人不发。
 * 「现在」由参数传入，取一个遥远的未来日期，避免和库里其他数据的时间窗口相交。
 */
@EnabledIfEnvironmentVariable(named = "SHITU_IT", matches = "true")
@SpringBootTest(properties = {FlowItSupport.IT_DB, "shitu.scheduling.enabled=false", "shitu.ops.init-password=ItSuper2026"})
class StaffDigestIT {

    static final SecureRandom RND = new SecureRandom();
    /** 每次运行换一天，互不干扰 */
    final LocalDate day = LocalDate.of(2040, 1, 1).plusDays(RND.nextInt(3000));

    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    StaffDigestService digest;
    @Autowired
    FieldCipher cipher;

    final String tag = String.valueOf(100000 + RND.nextInt(899999));
    final String co = "CD" + tag;

    @Test
    void eveningAndMorning() {
        String credit = ("91" + tag + "0000000000000000").substring(0, 18);
        jdbc.update("INSERT INTO company (company_id, name, unified_credit_code, contact_name, contact_phone_enc, company_status, "
                        + "onboard_date, fee_rights_revoked) VALUES (?, ?, ?, '测试', ?, 'NORMAL', ?, 0)",
                co, "汇总测试公司" + tag, credit, cipher.encrypt("13800000000"), Date.valueOf("2026-01-05"));
        String siteA = member("SITE");          // 负责项目 P1
        String pmA = member("PM");              // 负责项目 P1
        String siteB = member("SITE");          // 负责项目 P2
        String siteFree = member("SITE");       // 没分配项目
        String broker = member("BROKER");       // 不该收到
        String owner = member("OWNER");         // 不该收到
        String p1 = "PD1" + tag;
        String p2 = "PD2" + tag;
        String p3 = "PD3" + tag;                // 没分配任何人 → 全公司驻场
        assign(siteA, p1);
        assign(pmA, p1);
        assign(siteB, p2);

        LocalDateTime evening = day.atTime(20, 30);
        window(p1, day.atTime(23, 10));                 // 今晚到期：siteA、pmA
        window(p1, day.plusDays(1).atTime(2, 40));      // 凌晨到期：siteA、pmA
        window(p2, day.plusDays(1).atTime(8, 50));      // 明早 9 点前：siteB
        window(p2, day.plusDays(1).atTime(9, 30));      // 明早 9 点后：晚间不算，早间算
        window(p3, day.plusDays(1).atTime(1, 0));       // 项目没分配人：全公司驻场（siteA、siteB、siteFree）
        window(null, day.plusDays(1).atTime(3, 0));     // 私域待匹配、没有报名：全公司驻场
        window(p1, day.atTime(19, 0));                  // 已经过期的不算
        closedWindow(p1, day.atTime(23, 30));           // 已关闭的不算

        assertThat(digest.evening(evening)).isGreaterThanOrEqualTo(4);
        assertThat(content(siteA)).as("P1 两个 + P3 + 私域 = 4 人，最早 23:10").contains("有 4 人").contains("23:10");
        assertThat(content(pmA)).as("项目经理只收自己项目的：2 人").contains("有 2 人").contains("23:10");
        assertThat(content(siteB)).as("P2 一个 + P3 + 私域 = 3 人，最早 01:00").contains("有 3 人").contains("01:00");
        assertThat(content(siteFree)).as("没分配项目的驻场只收全公司兜底的 2 人").contains("有 2 人").contains("01:00");
        assertThat(events(broker)).isZero();
        assertThat(events(owner)).isZero();

        // ---------------------------------------------------------------- 早间：当天到期 + 未知悉
        LocalDateTime morning = day.plusDays(1).atTime(8, 30);
        application(p2, false);
        application(p2, false);
        application(p1, true);   // 已知悉的不算
        int before = events(siteB);
        int beforeA = events(siteA);
        digest.morning(morning);
        assertThat(events(siteB)).isEqualTo(before + 1);
        assertThat(content(siteB)).as("当天到期：08:50 和 09:30 两个；未知悉 2 个")
                .contains("今天有 2 人").contains("08:50").contains("另有 2 人报名后还没知悉");
        assertThat(events(siteA)).as("P1 没有当天到期的窗口，也没有未知悉的报名：不发").isEqualTo(beforeA);
    }

    // ==================================================================== fixtures

    private String member(String role) {
        String id = "MD" + tag + RND.nextInt(1_000_000);
        String phone = "139" + String.format("%08d", RND.nextInt(100_000_000));
        jdbc.update("INSERT INTO member (member_id, company_id, name, phone_enc, phone_hash, roles, status) VALUES (?, ?, ?, ?, ?, ?, 'NORMAL')",
                id, co, "汇总" + role, cipher.encrypt(phone), cipher.blindIndex(phone), role);
        return id;
    }

    private void assign(String memberId, String projectId) {
        jdbc.update("INSERT INTO member_project (company_id, member_id, project_id) VALUES (?, ?, ?)", co, memberId, projectId);
    }

    private void window(String projectId, LocalDateTime deadline) {
        String user = "UD" + tag + RND.nextInt(10_000_000);
        String app = projectId == null ? null : application(projectId, true, user);
        jdbc.update("INSERT INTO response_window (user_id, company_id, stage, application_id, started_at, deadline, status) "
                        + "VALUES (?, ?, ?, ?, ?, ?, 'OPEN')", user, co, projectId == null ? "PRIVATE_PENDING" : "PENDING_INTERVIEW", app,
                Timestamp.valueOf(deadline.minusHours(24)), Timestamp.valueOf(deadline));
    }

    private void closedWindow(String projectId, LocalDateTime deadline) {
        String user = "UD" + tag + RND.nextInt(10_000_000);
        jdbc.update("INSERT INTO response_window (user_id, company_id, stage, application_id, started_at, deadline, status, closed_at) "
                        + "VALUES (?, ?, 'PENDING_INTERVIEW', ?, ?, ?, 'CLOSED', ?)", user, co, application(projectId, true, user),
                Timestamp.valueOf(deadline.minusHours(24)), Timestamp.valueOf(deadline), Timestamp.valueOf(deadline.minusHours(1)));
    }

    private String application(String projectId, boolean acknowledged) {
        return application(projectId, acknowledged, "UD" + tag + RND.nextInt(10_000_000));
    }

    private String application(String projectId, boolean acknowledged, String user) {
        String id = "BMD" + tag + RND.nextInt(10_000_000);
        jdbc.update("INSERT INTO application (application_id, user_id, company_id, project_id, job_id, pre_apply_status, status, "
                        + "acknowledged_at, interview_address) VALUES (?, ?, ?, ?, 'J-TEST', 'PUBLIC_SEEKING', 'PENDING_INTERVIEW', ?, '测试地址')",
                id, user, co, projectId, acknowledged ? Timestamp.valueOf(day.atStartOfDay()) : null);
        return id;
    }

    private int events(String memberId) {
        Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM outbox_event WHERE event_type = 'STAFF_DIGEST' AND aggregate_id = ?",
                Integer.class, memberId);
        return n == null ? 0 : n;
    }

    /** 这个人最近一条汇总的正文 */
    private String content(String memberId) {
        List<String> rows = jdbc.queryForList("SELECT JSON_UNQUOTE(JSON_EXTRACT(payload, '$.content')) FROM outbox_event "
                + "WHERE event_type = 'STAFF_DIGEST' AND aggregate_id = ? ORDER BY id DESC LIMIT 1", String.class, memberId);
        return rows.isEmpty() ? "" : rows.get(0);
    }
}
