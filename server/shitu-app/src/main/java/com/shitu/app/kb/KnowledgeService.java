package com.shitu.app.kb;

import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.kv.RateLimiter;
import com.shitu.framework.outbox.OutboxWriter;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 岗位知识库（T-305）与岗位问答（C-409）。
 * <ul>
 *   <li>问答条目按 公司 / 项目 / 岗位 三级作用域维护：岗位级优先，项目级、公司级（两者都为空）兜底。</li>
 *   <li>检索用 MySQL ngram 全文索引；V1.0 不接大模型（02-架构 原则 5），命中直接返回条目答案。</li>
 *   <li>未命中 → 记为"待补充"并通知项目经理；公司补充答案后回填日志并通知提问的求职者。</li>
 * </ul>
 * JDBC 不经过租户拦截器，所有语句显式带 company_id。
 */
@Service
public class KnowledgeService {

    static final String PENDING = "HUMAN_PENDING";
    static final String IGNORED = "IGNORED";
    /** ngram 自然语言模式的相关度阈值：太低会被"工资""上班"这类高频双字误命中。 */
    static final double MIN_SCORE = 0.2;

    private final JdbcTemplate jdbc;
    private final OutboxWriter outbox;
    private final RateLimiter limiter;

    public KnowledgeService(JdbcTemplate jdbc, OutboxWriter outbox, RateLimiter limiter) {
        this.jdbc = jdbc;
        this.outbox = outbox;
        this.limiter = limiter;
    }

    public record EntryRequest(String projectId, String jobId, String question, String answer) {
    }

    public record AskResult(boolean answered, String question, String answer, String matchedQuestion) {
    }

    // ================================================================= T-305 公司维护

    /** projectIds 为 null 表示全公司可见；否则只返回这些项目（含公司级通用条目）。 */
    public List<Map<String, Object>> list(String companyId, Collection<String> projectIds, String projectId, String jobId,
                                          String keyword) {
        StringBuilder sql = new StringBuilder("SELECT k.id, k.project_id, p.name AS project_name, k.job_id, j.title AS job_title, "
                + "k.question, k.answer, k.updated_by, k.updated_at FROM kb_entry k "
                + "LEFT JOIN project p ON p.project_id = k.project_id LEFT JOIN job j ON j.job_id = k.job_id "
                + "WHERE k.company_id = ? AND k.status = 'ACTIVE'");
        List<Object> args = new ArrayList<>(List.of(companyId));
        scope(sql, args, "k.project_id", projectIds, true);
        if (notBlank(projectId)) {
            sql.append(" AND k.project_id = ?");
            args.add(projectId);
        }
        if (notBlank(jobId)) {
            sql.append(" AND k.job_id = ?");
            args.add(jobId);
        }
        if (notBlank(keyword)) {
            sql.append(" AND (k.question LIKE ? OR k.answer LIKE ?)");
            args.add("%" + keyword.trim() + "%");
            args.add("%" + keyword.trim() + "%");
        }
        sql.append(" ORDER BY k.updated_at DESC LIMIT 500");
        return jdbc.queryForList(sql.toString(), args.toArray());
    }

    /** 校验作用域并补全：给了岗位就以岗位的项目为准。返回 [projectId, jobId]。 */
    public String[] resolveScope(String companyId, String projectId, String jobId) {
        if (notBlank(jobId)) {
            Map<String, Object> job = jobOf(jobId);
            BizException.check(companyId.equals(job.get("company_id")), ErrorCode.SYS_NOT_FOUND);
            return new String[]{(String) job.get("project_id"), jobId};
        }
        if (notBlank(projectId)) {
            Long n = jdbc.queryForObject("SELECT COUNT(*) FROM project WHERE project_id = ? AND company_id = ?",
                    Long.class, projectId, companyId);
            BizException.check(n != null && n > 0, ErrorCode.SYS_NOT_FOUND);
            return new String[]{projectId, null};
        }
        return new String[]{null, null};
    }

    @Transactional
    public long create(String companyId, String memberId, String projectId, String jobId, String question, String answer) {
        checkText(question, answer);
        GeneratedKeyHolder key = new GeneratedKeyHolder();
        jdbc.update(con -> {
            PreparedStatement ps = con.prepareStatement("INSERT INTO kb_entry (company_id, project_id, job_id, question, answer, updated_by) "
                    + "VALUES (?, ?, ?, ?, ?, ?)", Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, companyId);
            ps.setString(2, projectId);
            ps.setString(3, jobId);
            ps.setString(4, question.trim());
            ps.setString(5, answer.trim());
            ps.setString(6, memberId);
            return ps;
        }, key);
        return key.getKey().longValue();
    }

    public Map<String, Object> entry(String companyId, long id) {
        try {
            return jdbc.queryForMap("SELECT id, project_id, job_id, question, answer FROM kb_entry "
                    + "WHERE id = ? AND company_id = ? AND status = 'ACTIVE'", id, companyId);
        } catch (EmptyResultDataAccessException e) {
            throw new BizException(ErrorCode.SYS_NOT_FOUND);
        }
    }

    @Transactional
    public void update(String companyId, String memberId, long id, String question, String answer) {
        checkText(question, answer);
        int n = jdbc.update("UPDATE kb_entry SET question = ?, answer = ?, updated_by = ? WHERE id = ? AND company_id = ? AND status = 'ACTIVE'",
                question.trim(), answer.trim(), memberId, id, companyId);
        BizException.check(n == 1, ErrorCode.SYS_NOT_FOUND);
    }

    @Transactional
    public void delete(String companyId, String memberId, long id) {
        int n = jdbc.update("UPDATE kb_entry SET status = 'DELETED', updated_by = ? WHERE id = ? AND company_id = ? AND status = 'ACTIVE'",
                memberId, id, companyId);
        BizException.check(n == 1, ErrorCode.SYS_NOT_FOUND);
    }

    /** 未命中待补充的问题（按岗位 + 问题去重，附提问次数）。 */
    public List<Map<String, Object>> pending(String companyId, Collection<String> projectIds) {
        StringBuilder sql = new StringBuilder("SELECT MIN(q.id) AS id, q.job_id, j.title AS job_title, j.project_id, q.question, "
                + "COUNT(*) AS asked_times, MAX(q.created_at) AS last_asked_at FROM kb_query_log q JOIN job j ON j.job_id = q.job_id "
                + "WHERE q.company_id = ? AND q.answered_by = ? AND q.hit_entry_id IS NULL");
        List<Object> args = new ArrayList<>(List.of(companyId, PENDING));
        scope(sql, args, "j.project_id", projectIds, false);
        sql.append(" GROUP BY q.job_id, j.title, j.project_id, q.question ORDER BY asked_times DESC, last_asked_at DESC LIMIT 200");
        return jdbc.queryForList(sql.toString(), args.toArray());
    }

    /** 待补充问题的岗位与问题原文（按日志 id 定位，校验公司与项目范围由调用方处理）。 */
    public Map<String, Object> pendingItem(String companyId, long logId) {
        try {
            return jdbc.queryForMap("SELECT q.job_id, q.question, j.project_id, j.title FROM kb_query_log q JOIN job j ON j.job_id = q.job_id "
                    + "WHERE q.id = ? AND q.company_id = ? AND q.answered_by = ? AND q.hit_entry_id IS NULL", logId, companyId, PENDING);
        } catch (EmptyResultDataAccessException e) {
            throw new BizException(ErrorCode.SYS_NOT_FOUND);
        }
    }

    /** 补充答案：写入岗位级条目，回填同岗位同问题的待补日志，并通知提问人。 */
    @Transactional
    public long answerPending(String companyId, String memberId, long logId, String question, String answer) {
        Map<String, Object> item = pendingItem(companyId, logId);
        String jobId = (String) item.get("job_id");
        String original = (String) item.get("question");
        String q = notBlank(question) ? question : original;
        long entryId = create(companyId, memberId, (String) item.get("project_id"), jobId, q, answer);
        List<String> askers = jdbc.queryForList("SELECT DISTINCT user_id FROM kb_query_log WHERE company_id = ? AND job_id = ? "
                + "AND question = ? AND answered_by = ? AND hit_entry_id IS NULL", String.class, companyId, jobId, original, PENDING);
        jdbc.update("UPDATE kb_query_log SET hit_entry_id = ? WHERE company_id = ? AND job_id = ? AND question = ? "
                + "AND answered_by = ? AND hit_entry_id IS NULL", entryId, companyId, jobId, original, PENDING);
        for (String userId : askers) {
            outbox.publish("KB_ANSWERED", "kb_entry", String.valueOf(entryId), Map.of("userId", userId, "jobId", jobId,
                    "jobTitle", item.get("title"), "question", original, "answer", abbreviate(answer.trim(), 200)));
        }
        return entryId;
    }

    @Transactional
    public int ignorePending(String companyId, long logId) {
        Map<String, Object> item = pendingItem(companyId, logId);
        return jdbc.update("UPDATE kb_query_log SET answered_by = ? WHERE company_id = ? AND job_id = ? AND question = ? "
                + "AND answered_by = ? AND hit_entry_id IS NULL", IGNORED, companyId, item.get("job_id"), item.get("question"), PENDING);
    }

    // ================================================================= C-409 求职者提问

    @Transactional
    public AskResult ask(String userId, String jobId, String question) {
        String q = question == null ? "" : question.trim();
        BizException.check(q.length() >= 2 && q.length() <= 100, ErrorCode.SYS_BAD_REQUEST, "问题请写 2～100 个字");
        BizException.check(limiter.tryAcquire("kb:ask:" + userId, 30, Duration.ofHours(1)), ErrorCode.SYS_TOO_MANY_REQUESTS);
        Map<String, Object> job = jobOf(jobId);
        BizException.check("RECRUITING".equals(job.get("job_status")), ErrorCode.JOB_ILLEGAL_STATUS);
        String companyId = (String) job.get("company_id");
        Map<String, Object> hit = search(companyId, (String) job.get("project_id"), jobId, q);
        Long hitId = hit == null ? null : ((Number) hit.get("id")).longValue();
        // 同一人对同一岗位重复问同一未命中问题，只记一次待补
        boolean dup = hit == null && count("SELECT COUNT(*) FROM kb_query_log WHERE user_id = ? AND job_id = ? AND question = ? "
                + "AND answered_by = ? AND hit_entry_id IS NULL", userId, jobId, q, PENDING) > 0;
        if (!dup) {
            jdbc.update("INSERT INTO kb_query_log (company_id, user_id, job_id, question, hit_entry_id, answered_by) VALUES (?, ?, ?, ?, ?, ?)",
                    companyId, userId, jobId, q, hitId, hit == null ? PENDING : "KB");
        }
        if (hit != null) {
            return new AskResult(true, q, (String) hit.get("answer"), (String) hit.get("question"));
        }
        if (!dup && count("SELECT COUNT(*) FROM kb_query_log WHERE company_id = ? AND job_id = ? AND question = ? AND answered_by = ? "
                + "AND hit_entry_id IS NULL", companyId, jobId, q, PENDING) == 1) {
            outbox.publish("KB_QUESTION_PENDING", "job", jobId, Map.of("companyId", companyId, "projectId", job.get("project_id"),
                    "jobTitle", job.get("title"), "question", q));
        }
        return new AskResult(false, q, null, null);
    }

    Map<String, Object> search(String companyId, String projectId, String jobId, String q) {
        String scope = " FROM kb_entry WHERE company_id = ? AND status = 'ACTIVE' "
                + "AND (job_id = ? OR (job_id IS NULL AND (project_id = ? OR project_id IS NULL)))";
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT id, question, answer, job_id, "
                        + "MATCH(question, answer) AGAINST (? IN NATURAL LANGUAGE MODE) AS score" + scope
                        + " AND MATCH(question, answer) AGAINST (? IN NATURAL LANGUAGE MODE) "
                        + "ORDER BY score DESC, (job_id IS NOT NULL) DESC LIMIT 1",
                q, companyId, jobId, projectId, q);
        if (!rows.isEmpty() && ((Number) rows.get(0).get("score")).doubleValue() >= MIN_SCORE) {
            return rows.get(0);
        }
        // 问题原文完全一致（全文索引对极短问题可能打分为 0）
        List<Map<String, Object>> exact = jdbc.queryForList("SELECT id, question, answer" + scope
                + " AND question = ? ORDER BY (job_id IS NOT NULL) DESC LIMIT 1", companyId, jobId, projectId, q);
        return exact.isEmpty() ? null : exact.get(0);
    }

    // ================================================================= helpers

    private Map<String, Object> jobOf(String jobId) {
        try {
            return jdbc.queryForMap("SELECT job_id, company_id, project_id, title, job_status FROM job WHERE job_id = ?", jobId);
        } catch (EmptyResultDataAccessException e) {
            throw new BizException(ErrorCode.SYS_NOT_FOUND);
        }
    }

    private static void scope(StringBuilder sql, List<Object> args, String column, Collection<String> projectIds, boolean includeCompanyWide) {
        if (projectIds == null) {
            return;
        }
        if (projectIds.isEmpty()) {
            sql.append(includeCompanyWide ? " AND " + column + " IS NULL" : " AND 1 = 0");
            return;
        }
        sql.append(" AND (").append(column).append(" IN (").append(String.join(",", projectIds.stream().map(x -> "?").toList())).append(")");
        sql.append(includeCompanyWide ? " OR " + column + " IS NULL)" : ")");
        args.addAll(projectIds);
    }

    private long count(String sql, Object... args) {
        Long n = jdbc.queryForObject(sql, Long.class, args);
        return n == null ? 0 : n;
    }

    private static void checkText(String question, String answer) {
        BizException.check(notBlank(question) && question.trim().length() <= 255, ErrorCode.SYS_BAD_REQUEST, "问题必填，最多 255 字");
        BizException.check(notBlank(answer) && answer.trim().length() <= 2000, ErrorCode.SYS_BAD_REQUEST, "答案必填，最多 2000 字");
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }

    private static String abbreviate(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max) + "…";
    }

    static Map<String, Object> view(AskResult r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("answered", r.answered());
        m.put("question", r.question());
        m.put("answer", r.answered() ? r.answer() : "这个问题暂时没有现成答案，已转给岗位负责人，回复后会在消息里通知你。");
        m.put("matchedQuestion", r.matchedQuestion());
        return m;
    }
}
