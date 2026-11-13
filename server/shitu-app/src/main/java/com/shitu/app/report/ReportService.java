package com.shitu.app.report;

import com.shitu.common.util.Rows;
import com.shitu.common.Constants;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.sql.Date;
import java.time.Clock;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 看板与报表（T-306 / T-401 / T-402 / P-01）。V1.0 规模下直接在业务表上聚合（有索引，单公司千人级），
 * 后续量大时改为每日汇总表（02-架构 §5 report 模块）。老板只能拿到聚合数据，接口不返回任何个人明细（R-13）。
 * 所有查询显式带公司条件（JDBC 不经过租户拦截器）。
 */
@Service
public class ReportService {

    private final JdbcTemplate jdbc;
    private final Clock clock;

    public ReportService(JdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    private LocalDate today() {
        return LocalDate.now(clock.withZone(Constants.ZONE));
    }

    /** T-306 项目经理看板（按负责项目；projectIds 为空 = 全公司）。 */
    public Map<String, Object> pmBoard(String companyId, Collection<String> projectIds) {
        String scope = projectIds == null || projectIds.isEmpty() ? ""
                : " AND project_id IN (" + String.join(",", projectIds.stream().map(x -> "?").toList()) + ")";
        Object[] args = args(companyId, projectIds);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("pendingInterview", count("SELECT COUNT(*) FROM application WHERE company_id = ? AND status = 'PENDING_INTERVIEW'" + scope, args));
        m.put("pendingConfirm", count("SELECT COUNT(*) FROM application WHERE company_id = ? AND status = 'PENDING_CONFIRM'" + scope, args));
        m.put("employed", count("SELECT COUNT(*) FROM employment WHERE company_id = ? AND end_date IS NULL" + scope, args));
        m.put("resignedThisMonth", count("SELECT COUNT(*) FROM employment WHERE company_id = ? AND end_date >= ?" + scope,
                prepend(args, 1, Date.valueOf(today().withDayOfMonth(1)))));
        m.put("arrivedToday", count("SELECT COUNT(*) FROM application WHERE company_id = ? AND DATE(arrived_at) = ?" + scope,
                prepend(args, 1, Date.valueOf(today()))));
        m.put("hiredThisMonth", count("SELECT COUNT(*) FROM employment WHERE company_id = ? AND start_date >= ?" + scope,
                prepend(args, 1, Date.valueOf(today().withDayOfMonth(1)))));
        m.put("recruitingJobs", count("SELECT COUNT(*) FROM job WHERE company_id = ? AND job_status = 'RECRUITING'" + scope, args));
        return m;
    }

    /** T-401 老板总览：总入职、在岗、项目分布与明细（只有聚合）。 */
    public Map<String, Object> ownerOverview(String companyId) {
        LocalDate first = today().withDayOfMonth(1);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("totalHired", count("SELECT COUNT(*) FROM employment WHERE company_id = ?", companyId));
        m.put("employed", count("SELECT COUNT(*) FROM employment WHERE company_id = ? AND end_date IS NULL", companyId));
        m.put("hiredThisMonth", count("SELECT COUNT(*) FROM employment WHERE company_id = ? AND start_date >= ?", companyId, Date.valueOf(first)));
        m.put("resignedThisMonth", count("SELECT COUNT(*) FROM employment WHERE company_id = ? AND end_date >= ?", companyId, Date.valueOf(first)));
        m.put("privatePool", count("SELECT COUNT(*) FROM `user` WHERE bound_company_id = ? AND user_status = 'PRIVATE_PENDING'", companyId));
        m.put("transferIn", count("SELECT COUNT(*) FROM employment WHERE company_id = ? AND end_date IS NULL AND is_transfer = 1", companyId));
        m.put("transferOut", count("SELECT COUNT(*) FROM employment WHERE source_company_id_snapshot = ? AND company_id <> ? AND end_date IS NULL",
                companyId, companyId));
        m.put("projects", Rows.camel(jdbc.queryForList("SELECT p.project_id, p.name, p.city, "
                + "(SELECT GROUP_CONCAT(m.name) FROM member_project mp JOIN member m ON m.member_id = mp.member_id "
                + "  WHERE mp.project_id = p.project_id AND m.roles LIKE '%PM%') AS managers, "
                + "(SELECT COUNT(*) FROM employment e WHERE e.project_id = p.project_id AND e.end_date IS NULL) AS employed, "
                + "(SELECT COUNT(*) FROM employment e WHERE e.project_id = p.project_id AND e.start_date >= ?) AS hired_this_month, "
                + "(SELECT COUNT(*) FROM employment e WHERE e.project_id = p.project_id AND e.end_date >= ?) AS resigned_this_month "
                + "FROM project p WHERE p.company_id = ? AND p.status = 'ACTIVE' ORDER BY employed DESC",
                Date.valueOf(first), Date.valueOf(first), companyId)));
        return m;
    }

    /** T-402 渠道转化：各渠道码 访问 → 注册 → 报名 → 入职（只统计本公司渠道码）。 */
    public List<Map<String, Object>> channelFunnel(String companyId) {
        return Rows.camel(jdbc.queryForList("SELECT c.code, c.name, c.member_id, c.project_id, "
                + "(SELECT COUNT(DISTINCT v.visitor_key) FROM channel_visit v WHERE v.code = c.code) AS visits, "
                + "(SELECT COUNT(*) FROM `user` u WHERE u.register_channel_code = c.code) AS registrations, "
                + "(SELECT COUNT(DISTINCT a.user_id) FROM application a JOIN `user` u ON u.user_id = a.user_id "
                + "  WHERE u.register_channel_code = c.code AND a.company_id = ?) AS applied, "
                + "(SELECT COUNT(DISTINCT e.user_id) FROM employment e JOIN `user` u ON u.user_id = e.user_id "
                + "  WHERE u.register_channel_code = c.code AND e.company_id = ?) AS hired "
                + "FROM channel_code c WHERE c.company_id = ? ORDER BY registrations DESC", companyId, companyId, companyId));
    }

    /** P-01 运营总览（平台）。 */
    public Map<String, Object> opsOverview() {
        LocalDate t = today();
        LocalDate y = t.minusDays(1);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("companies", count("SELECT COUNT(*) FROM company WHERE company_status IN ('NORMAL','THROTTLED')"));
        m.put("pendingCompanies", count("SELECT COUNT(*) FROM company WHERE company_status = 'PENDING_AUDIT'"));
        m.put("employed", count("SELECT COUNT(*) FROM employment WHERE end_date IS NULL"));
        m.put("hiredToday", count("SELECT COUNT(*) FROM employment WHERE start_date = ?", Date.valueOf(t)));
        m.put("registeredToday", count("SELECT COUNT(*) FROM `user` WHERE DATE(registered_at) = ?", Date.valueOf(t)));
        m.put("applicationsToday", count("SELECT COUNT(*) FROM application WHERE DATE(created_at) = ?", Date.valueOf(t)));
        m.put("publicSeekers", count("SELECT COUNT(*) FROM `user` WHERE user_status = 'PUBLIC_SEEKING'"));
        m.put("recruitingJobs", count("SELECT COUNT(*) FROM job WHERE job_status = 'RECRUITING'"));
        // 昨日计费（每日计费任务 00:30 计算前一天）
        Map<String, Object> fee = jdbc.queryForMap("SELECT COALESCE(SUM(service_fee), 0) AS service_fee, COALESCE(SUM(transfer_payable), 0) AS transfer_fee "
                + "FROM company_fee_daily WHERE biz_date = ?", Date.valueOf(y));
        // D-19：平台从流转费拿到的钱分两种 —— 与来源公司分成后的「抽佣」，和来源为平台 / 来源公司已注销时的「全额收入」
        String split = "SELECT COUNT(*) AS transfer_count, COALESCE(SUM(platform_amount), 0) AS platform_take, "
                + "COALESCE(SUM(CASE WHEN supply_amount > 0 THEN platform_amount ELSE 0 END), 0) AS commission, "
                + "COALESCE(SUM(CASE WHEN supply_amount > 0 THEN 0 ELSE platform_amount END), 0) AS full_income "
                + "FROM billing_daily WHERE fee_type = 'TRANSFER' AND ";
        Map<String, Object> transfer = jdbc.queryForMap(split + "biz_date = ?", Date.valueOf(y));
        m.put("yesterday", Map.of("date", y.toString(), "serviceFee", fee.get("service_fee"), "transferFee", fee.get("transfer_fee"),
                "transferCount", transfer.get("transfer_count"), "platformTake", transfer.get("platform_take"),
                "transferCommission", transfer.get("commission"), "transferFullIncome", transfer.get("full_income")));
        Map<String, Object> monthTransfer = jdbc.queryForMap(split + "biz_date >= ?", Date.valueOf(YearMonth.from(t).atDay(1)));
        m.put("monthTransferCommission", monthTransfer.get("commission"));
        m.put("monthTransferFullIncome", monthTransfer.get("full_income"));
        YearMonth month = YearMonth.from(t);
        BigDecimal monthService = jdbc.queryForObject("SELECT COALESCE(SUM(service_fee), 0) FROM company_fee_daily WHERE biz_date >= ?",
                BigDecimal.class, Date.valueOf(month.atDay(1)));
        m.put("monthServiceFee", monthService);
        m.put("trend", Rows.camel(jdbc.queryForList("SELECT DATE(registered_at) AS d, COUNT(*) AS registrations FROM `user` "
                + "WHERE registered_at >= ? GROUP BY DATE(registered_at) ORDER BY d", Date.valueOf(t.minusDays(13)))));
        return m;
    }

    /**
     * T-102：本月被动释放的私域用户（24 小时未跟进 / 经纪人超时 / 确权超时）与获客损失。
     * 获客损失 = 其中由本公司自己引流来的人数（释放后其他公司可以免费匹配走）。
     */
    public Map<String, Object> timeoutReleases(String companyId) {
        LocalDate first = today().withDayOfMonth(1);
        String base = "FROM user_status_log l JOIN `user` u ON u.user_id = l.user_id WHERE l.bound_before = ? AND l.bound_after IS NULL "
                + "AND l.event IN ('TIMEOUT_24H', 'BROKER_SLA_TIMEOUT', 'CONFIRM_TIMEOUT') AND l.created_at >= ? AND l.created_at < ?";
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("month", YearMonth.from(first).toString());
        m.put("released", count("SELECT COUNT(*) " + base, companyId, Date.valueOf(first), Date.valueOf(first.plusMonths(1))));
        m.put("ownLeadsLost", count("SELECT COUNT(*) " + base + " AND u.source_company_id = ?",
                companyId, Date.valueOf(first), Date.valueOf(first.plusMonths(1)), companyId));
        m.put("releasedLastMonth", count("SELECT COUNT(*) " + base, companyId, Date.valueOf(first.minusMonths(1)), Date.valueOf(first)));
        m.put("byReason", Rows.camel(jdbc.queryForList("SELECT l.event, COUNT(*) AS cnt " + base + " GROUP BY l.event ORDER BY cnt DESC",
                companyId, Date.valueOf(first), Date.valueOf(first.plusMonths(1)))));
        return m;
    }

    /** P-12 答题漏斗：最近 N 天，按人去重。 */
    public Map<String, Object> quizFunnel(int days) {
        LocalDate from = today().minusDays(days - 1L);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("days", days);
        m.put("from", from.toString());
        // 提交过答案的人一定打开过答题页（旧数据、接口直连没有打开记录），并进来保证漏斗逐级递减
        m.put("opened", count("SELECT COUNT(*) FROM (SELECT user_id FROM quiz_open WHERE biz_date >= ? "
                + "UNION SELECT user_id FROM match_session WHERE started_at >= ?) t", Date.valueOf(from), Date.valueOf(from)));
        m.put("submitted", count("SELECT COUNT(DISTINCT user_id) FROM match_session WHERE started_at >= ?", Date.valueOf(from)));
        m.put("matched", count("SELECT COUNT(DISTINCT user_id) FROM match_session WHERE started_at >= ? AND status = 'MATCHED'", Date.valueOf(from)));
        m.put("applied", count("SELECT COUNT(DISTINCT a.user_id) FROM application a JOIN match_session s ON s.session_id = a.match_session_id "
                + "WHERE s.started_at >= ?", Date.valueOf(from)));
        return m;
    }

    /** 记录「打开答题页」；失败不影响答题。 */
    public void quizOpened(String userId) {
        try {
            jdbc.update("INSERT IGNORE INTO quiz_open (user_id, biz_date) VALUES (?, ?)", userId, Date.valueOf(today()));
        } catch (RuntimeException e) {
            org.slf4j.LoggerFactory.getLogger(ReportService.class).warn("quiz_open record failed: {}", e.getMessage());
        }
    }

    private long count(String sql, Object... args) {
        Long n = jdbc.queryForObject(sql, Long.class, args);
        return n == null ? 0 : n;
    }

    private static Object[] args(String companyId, Collection<String> projectIds) {
        List<Object> a = new java.util.ArrayList<>();
        a.add(companyId);
        if (projectIds != null) {
            a.addAll(projectIds);
        }
        return a.toArray();
    }

    private static Object[] prepend(Object[] args, int at, Object v) {
        List<Object> a = new java.util.ArrayList<>(List.of(args));
        a.add(at, v);
        return a.toArray();
    }
}
