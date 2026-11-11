package com.shitu.app.tenant;

import com.shitu.common.util.Rows;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.lifecycle.seeker.ApplicationService;
import com.shitu.matching.domain.MatchProfile;
import com.shitu.matching.session.MatchService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 报名详情里的求职者画像（M-04）：画像标签、匹配记录、在本公司的历史报名。
 * <p>数据边界：只展示本公司的岗位与报名。求职者在其他公司的匹配结果、报名记录不出现，也不透露数量。
 */
@Service
public class ApplicationInsightService {

    public record Insight(List<String> profileTags, List<Map<String, Object>> matchRecords, List<Map<String, Object>> history) {
    }

    private final ApplicationService applications;
    private final MatchService matching;
    private final JdbcTemplate jdbc;

    public ApplicationInsightService(ApplicationService applications, MatchService matching, JdbcTemplate jdbc) {
        this.applications = applications;
        this.matching = matching;
        this.jdbc = jdbc;
    }

    public Insight of(AuthPrincipal p, String applicationId) {
        // 复用详情接口的权限校验（跨公司 / 非本项目驻场 → 404）
        ApplicationService.SiteApplication app = applications.one(p, applicationId);
        String userId = app.userId();
        String companyId = p.companyId();

        List<Map<String, Object>> sessions = jdbc.queryForList("SELECT session_id, status, started_at FROM match_session "
                + "WHERE user_id = ? AND status IN ('MATCHED', 'NO_MATCH') ORDER BY started_at DESC LIMIT 5", userId);
        String fromSession = jdbc.queryForList("SELECT match_session_id FROM application WHERE application_id = ? AND company_id = ?",
                String.class, applicationId, companyId).stream().filter(x -> x != null).findFirst().orElse(null);
        String profileSession = fromSession != null ? fromSession
                : sessions.isEmpty() ? null : (String) sessions.get(0).get("session_id");
        List<String> tags = profileSession == null ? List.of() : tags(matching.profileOf(matching.snapshot(profileSession).session()));

        List<Map<String, Object>> records = new ArrayList<>();
        for (Map<String, Object> s : sessions) {
            List<Map<String, Object>> jobs = jdbc.queryForList("SELECT r.job_id, j.title, r.match_score, r.reason_text FROM match_result r "
                    + "JOIN job j ON j.job_id = r.job_id WHERE r.session_id = ? AND r.displayed = 1 AND j.company_id = ? ORDER BY r.rank_no",
                    s.get("session_id"), companyId);
            if (jobs.isEmpty()) {
                continue; // 这次匹配没有本公司岗位，不展示
            }
            jobs.forEach(j -> j.put("applied_job", app.jobId().equals(j.get("job_id"))));
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("matchedAt", s.get("started_at"));
            m.put("source", s.get("session_id").equals(fromSession));
            m.put("jobs", Rows.camel(jobs));
            records.add(m);
        }

        List<Map<String, Object>> history = Rows.camel(jdbc.queryForList("SELECT a.application_id, a.job_id, j.title AS job_title, a.status, "
                + "a.created_at, a.interview_result, a.ended_at, a.end_reason FROM application a JOIN job j ON j.job_id = a.job_id "
                + "WHERE a.company_id = ? AND a.user_id = ? AND a.application_id <> ? ORDER BY a.created_at DESC LIMIT 20",
                companyId, userId, applicationId));
        return new Insight(tags, records, history);
    }

    private static List<String> tags(MatchProfile p) {
        List<String> t = new ArrayList<>();
        t.add(switch (p.factory()) {
            case YES -> "接受进厂";
            case MAYBE -> "可以考虑进厂";
            case NO -> "不接受进厂";
        });
        t.add(p.lockedCity() == null ? "地域不限" : "只看" + p.lockedCity());
        t.add(p.jobType() == null ? "工种不限" : p.jobType().label());
        if (p.salaryMin() != null && p.salaryMax() != null) {
            t.add("期望 " + p.salaryMin().stripTrailingZeros().toPlainString() + "–" + p.salaryMax().stripTrailingZeros().toPlainString() + " 元");
        }
        if (p.shift() != null) {
            t.add(p.shift().label());
        }
        if (p.dorm() != null) {
            t.add(switch (p.dorm()) {
                case REQUIRED -> "必须包住";
                case SMALL_ROOM -> "4 人间以内";
                case AIRCON -> "宿舍要有空调";
                case NONE -> "不需要住宿";
            });
        }
        t.add(switch (p.workYears()) {
            case 0 -> "无相关经验";
            case 1 -> "经验 1 年以内";
            case 2 -> "经验 1–3 年";
            default -> "经验 3 年以上";
        });
        if (p.age() != null) {
            t.add(p.age() + " 岁");
        }
        return t;
    }
}
