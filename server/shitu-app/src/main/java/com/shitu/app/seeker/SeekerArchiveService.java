package com.shitu.app.seeker;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.shitu.advance.service.PayrollService;
import com.shitu.common.enums.JobType;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.common.util.Masks;
import com.shitu.common.util.Rows;
import com.shitu.framework.crypto.FieldCipher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Date;
import java.time.Clock;
import java.time.LocalDate;
import java.time.Period;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/**
 * C 端「我的」里的个人档案类只读 / 自助数据：经纪人工单进度（C-305）、我的台账（C-506）、我的简历（C-504）。
 * <p>全部按 userId 取本人数据；直接走 JDBC（不经租户拦截器），每条 SQL 都显式带 user_id。
 */
@Service
public class SeekerArchiveService {

    private static final int MAX_LIST = 5;
    private static final int MAX_TAGS = 10;

    public record Ledger(List<Map<String, Object>> applications, List<Map<String, Object>> employments,
                         List<PayrollService.Payslip> payslips) {
    }

    /** 简历可编辑部分。emergencyPhone 是本人填写的紧急联系人电话，只回给本人。 */
    public record ResumeForm(String wechatId, String emergencyName, String emergencyPhone, List<String> expectJobTypes,
                             List<String> expectRegions, Integer workYears, List<String> skillTags, String intro) {
    }

    public record Resume(ResumeForm form, Map<String, Object> archive) {
    }

    private final JdbcTemplate jdbc;
    private final FieldCipher cipher;
    private final ObjectMapper json;
    private final PayrollService payroll;
    private final Clock clock;

    public SeekerArchiveService(JdbcTemplate jdbc, FieldCipher cipher, ObjectMapper json, PayrollService payroll, Clock clock) {
        this.jdbc = jdbc;
        this.cipher = cipher;
        this.json = json;
        this.payroll = payroll;
        this.clock = clock;
    }

    // ------------------------------------------------------------------ 经纪人工单进度（C-305）

    /** 最近一张经纪人工单；没有返回 null。只给进度与时限，不给经纪人个人信息。 */
    public Map<String, Object> brokerProgress(String userId) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT bc.id, bc.status, bc.trigger_type, COALESCE(c.short_name, c.name) AS company_name, "
                + "bc.created_at, bc.contact_due_at, bc.resolve_due_at, bc.contacted_at, bc.closed_at, "
                + "(SELECT COUNT(*) FROM broker_recommendation r WHERE r.broker_case_id = bc.id) AS recommend_count, "
                + "(SELECT MIN(r.created_at) FROM broker_recommendation r WHERE r.broker_case_id = bc.id) AS first_recommended_at "
                + "FROM broker_case bc JOIN company c ON c.company_id = bc.company_id WHERE bc.user_id = ? ORDER BY bc.id DESC LIMIT 1", userId);
        return rows.isEmpty() ? null : Rows.camel(rows.get(0));
    }

    // ------------------------------------------------------------------ 我的台账（C-506）

    public Ledger ledger(String userId) {
        List<Map<String, Object>> apps = Rows.camel(jdbc.queryForList("SELECT a.application_id, j.title AS job_title, "
                + "COALESCE(c.short_name, c.name) AS company_name, a.status, a.created_at, a.acknowledged_at, a.interview_at, "
                + "a.interview_address, a.arrived_at, a.interview_result, a.ended_at, a.end_reason FROM application a "
                + "JOIN job j ON j.job_id = a.job_id JOIN company c ON c.company_id = a.company_id "
                + "WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT 100", userId));
        return new Ledger(apps, employments(userId), payroll.mine(userId));
    }

    private List<Map<String, Object>> employments(String userId) {
        return Rows.camel(jdbc.queryForList("SELECT e.employment_id, COALESCE(c.short_name, c.name) AS company_name, p.name AS project_name, "
                + "j.title AS job_title, DATE_FORMAT(e.start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(e.end_date, '%Y-%m-%d') AS end_date, "
                + "e.end_reason, DATEDIFF(COALESCE(e.end_date, ?), e.start_date) + 1 AS days FROM employment e "
                + "JOIN company c ON c.company_id = e.company_id LEFT JOIN project p ON p.project_id = e.project_id "
                + "LEFT JOIN job j ON j.job_id = e.job_id WHERE e.user_id = ? ORDER BY e.start_date DESC LIMIT 50",
                Date.valueOf(LocalDate.now(clock)), userId));
    }

    // ------------------------------------------------------------------ 我的简历（C-504）

    public Resume resume(String userId) {
        List<Map<String, Object>> r = jdbc.queryForList("SELECT wechat_id, emergency_name, emergency_phone_enc, expect_job_types, "
                + "expect_regions, work_years, skill_tags, intro FROM user_resume WHERE user_id = ?", userId);
        ResumeForm form = r.isEmpty() ? new ResumeForm(null, null, null, List.of(), List.of(), null, List.of(), null)
                : new ResumeForm((String) r.get(0).get("wechat_id"), (String) r.get(0).get("emergency_name"),
                r.get(0).get("emergency_phone_enc") == null ? null : cipher.decrypt((String) r.get(0).get("emergency_phone_enc")),
                list(r.get(0).get("expect_job_types")), list(r.get(0).get("expect_regions")),
                r.get(0).get("work_years") == null ? null : ((Number) r.get(0).get("work_years")).intValue(),
                list(r.get(0).get("skill_tags")), (String) r.get(0).get("intro"));

        Map<String, Object> u = jdbc.queryForMap("SELECT real_name_enc, gender, birth_date, kyc_status, user_status, registered_at "
                + "FROM `user` WHERE user_id = ?", userId);
        Map<String, Object> archive = new LinkedHashMap<>();
        archive.put("realName", u.get("real_name_enc") == null ? null : Masks.name(cipher.decrypt((String) u.get("real_name_enc"))));
        archive.put("gender", u.get("gender"));
        archive.put("age", u.get("birth_date") == null ? null
                : Period.between(((Date) u.get("birth_date")).toLocalDate(), LocalDate.now(clock)).getYears());
        archive.put("kycStatus", u.get("kyc_status"));
        archive.put("userStatus", u.get("user_status"));
        archive.put("registeredAt", u.get("registered_at"));
        List<Map<String, Object>> emps = employments(userId);
        archive.put("current", emps.stream().filter(e -> e.get("endDate") == null).findFirst().orElse(null));
        archive.put("history", emps.stream().filter(e -> e.get("endDate") != null).toList());
        // 考勤异常：驻场标记的请假 / 旷工天数（D-27）
        Map<String, Long> abs = new LinkedHashMap<>();
        jdbc.query("SELECT d.absence_type, COUNT(*) FROM duty_absence d JOIN employment e ON e.employment_id = d.employment_id "
                + "WHERE e.user_id = ? GROUP BY d.absence_type", rs -> { abs.put(rs.getString(1), rs.getLong(2)); }, userId);
        archive.put("leaveDays", abs.getOrDefault("LEAVE", 0L));
        archive.put("absentDays", abs.getOrDefault("ABSENT", 0L));
        archive.put("applicationCount", jdbc.queryForObject("SELECT COUNT(*) FROM application WHERE user_id = ?", Long.class, userId));
        return new Resume(form, archive);
    }

    @Transactional
    public void saveResume(String userId, ResumeForm f) {
        String wechat = trim(f.wechatId());
        BizException.check(wechat == null || wechat.matches("[A-Za-z0-9_-]{5,40}"), ErrorCode.SYS_BAD_REQUEST, "微信号格式不正确");
        String eName = trim(f.emergencyName());
        BizException.check(eName == null || eName.length() <= 20, ErrorCode.SYS_BAD_REQUEST, "紧急联系人姓名不超过 20 个字");
        String ePhone = trim(f.emergencyPhone());
        BizException.check(ePhone == null || Masks.isMobile(ePhone), ErrorCode.SYS_BAD_REQUEST, "紧急联系人手机号格式不正确");
        List<String> types = clean(f.expectJobTypes());
        BizException.check(types.size() <= MAX_LIST && types.stream().allMatch(SeekerArchiveService::isJobType),
                ErrorCode.SYS_BAD_REQUEST, "期望工种不正确");
        List<String> regions = clean(f.expectRegions());
        BizException.check(regions.size() <= MAX_LIST && regions.stream().allMatch(x -> x.length() <= 20),
                ErrorCode.SYS_BAD_REQUEST, "期望地点最多 " + MAX_LIST + " 个，每个不超过 20 个字");
        BizException.check(f.workYears() == null || (f.workYears() >= 0 && f.workYears() <= 50), ErrorCode.SYS_BAD_REQUEST, "工作年限不正确");
        List<String> tags = clean(f.skillTags());
        BizException.check(tags.size() <= MAX_TAGS && tags.stream().allMatch(x -> x.length() <= 12),
                ErrorCode.SYS_BAD_REQUEST, "技能标签最多 " + MAX_TAGS + " 个，每个不超过 12 个字");
        String intro = trim(f.intro());
        BizException.check(intro == null || intro.length() <= 500, ErrorCode.SYS_BAD_REQUEST, "个人简介不超过 500 字");

        jdbc.update("INSERT INTO user_resume (user_id, wechat_id, emergency_name, emergency_phone_enc, expect_job_types, expect_regions, "
                        + "work_years, skill_tags, intro) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE wechat_id = VALUES(wechat_id), "
                        + "emergency_name = VALUES(emergency_name), emergency_phone_enc = VALUES(emergency_phone_enc), "
                        + "expect_job_types = VALUES(expect_job_types), expect_regions = VALUES(expect_regions), work_years = VALUES(work_years), "
                        + "skill_tags = VALUES(skill_tags), intro = VALUES(intro)",
                userId, wechat, eName, ePhone == null ? null : cipher.encrypt(ePhone), write(types), write(regions), f.workYears(),
                write(tags), intro);
    }

    private static boolean isJobType(String s) {
        for (JobType t : JobType.values()) {
            if (t.name().equals(s)) {
                return true;
            }
        }
        return false;
    }

    private static String trim(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static List<String> clean(List<String> in) {
        if (in == null) {
            return List.of();
        }
        LinkedHashSet<String> out = new LinkedHashSet<>();
        in.forEach(x -> {
            if (x != null && !x.isBlank()) {
                out.add(x.trim());
            }
        });
        return new ArrayList<>(out);
    }

    private List<String> list(Object v) {
        if (v == null) {
            return List.of();
        }
        try {
            return json.readValue(v.toString(), new TypeReference<List<String>>() { });
        } catch (Exception e) {
            return List.of();
        }
    }

    private String write(List<String> v) {
        try {
            return json.writeValueAsString(v);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
