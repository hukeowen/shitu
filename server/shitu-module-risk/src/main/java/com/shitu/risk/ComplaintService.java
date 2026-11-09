package com.shitu.risk;

import com.shitu.common.util.Rows;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.outbox.OutboxWriter;
import com.shitu.job.JobService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 岗位投诉（C-402 / P-06）：求职者投诉 → 平台核实 / 驳回；同一岗位属实满 3 次 → 自动强制下架 + 公司扣 10 分。
 * 投诉内容与处理结果对企业不可见（只在平台中台处理），避免对投诉人打击报复。
 */
@Service
public class ComplaintService {

    public static final Set<String> CATEGORIES = Set.of("FULL_STILL_HIRING", "INFO_FALSE", "MISMATCH_AFTER_INTERVIEW");
    static final int AUTO_OFFLINE_AT = 3;
    static final int DEDUCT = -10;

    private final JdbcTemplate jdbc;
    private final CreditService credit;
    private final JobService jobs;
    private final OutboxWriter outbox;
    private final AuditLogger audit;
    private final Clock clock;

    public ComplaintService(JdbcTemplate jdbc, CreditService credit, JobService jobs, OutboxWriter outbox, AuditLogger audit, Clock clock) {
        this.jdbc = jdbc;
        this.credit = credit;
        this.jobs = jobs;
        this.outbox = outbox;
        this.audit = audit;
        this.clock = clock;
    }

    /** 求职者只能投诉自己匹配到或报名过的岗位；同一岗位同一类别待处理的只能有一条。 */
    @Transactional
    public long submit(String userId, String jobId, String category, String content) {
        BizException.check(CATEGORIES.contains(category), ErrorCode.SYS_BAD_REQUEST, "请选择投诉类型");
        BizException.check(content == null || content.length() <= 500, ErrorCode.SYS_BAD_REQUEST, "说明不超过 500 字");
        List<String> company = jdbc.queryForList("SELECT company_id FROM job WHERE job_id = ?", String.class, jobId);
        BizException.check(!company.isEmpty(), ErrorCode.SYS_NOT_FOUND);
        Long related = jdbc.queryForObject("SELECT (SELECT COUNT(*) FROM application WHERE user_id = ? AND job_id = ?) + "
                + "(SELECT COUNT(*) FROM match_result r JOIN match_session s ON s.session_id = r.session_id WHERE s.user_id = ? AND r.job_id = ?)",
                Long.class, userId, jobId, userId, jobId);
        BizException.check(related != null && related > 0, ErrorCode.APP_NOT_FROM_MATCH, "只能投诉你匹配到或报名过的岗位");
        Long dup = jdbc.queryForObject("SELECT COUNT(*) FROM complaint WHERE user_id = ? AND job_id = ? AND category = ? AND status = 'PENDING'",
                Long.class, userId, jobId, category);
        BizException.check(dup == null || dup == 0, ErrorCode.SYS_CONFLICT, "你已投诉过，平台正在核实");
        jdbc.update("INSERT INTO complaint (job_id, company_id, user_id, category, content) VALUES (?, ?, ?, ?, ?)",
                jobId, company.get(0), userId, category, content);
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        outbox.publish("COMPLAINT_SUBMITTED", "COMPLAINT", String.valueOf(id), Map.of("jobId", jobId));
        return id == null ? 0 : id;
    }

    public List<Map<String, Object>> list(String status) {
        return Rows.camel(jdbc.queryForList("SELECT c.id, c.job_id, j.title, c.company_id, c.user_id, c.category, c.content, c.status, c.handle_remark, "
                + "c.created_at, c.handled_at, j.complaint_verified FROM complaint c JOIN job j ON j.job_id = c.job_id "
                + (status == null ? "" : "WHERE c.status = ? ") + "ORDER BY c.id DESC LIMIT 200",
                status == null ? new Object[0] : new Object[]{status}));
    }

    /** P-06 核实（属实 / 驳回）。属实累计满 3 次：强制下架 + 扣分（每个岗位只触发一次）。 */
    @Transactional
    public void handle(long id, boolean verified, String remark, String operatorId) {
        BizException.check(remark != null && !remark.isBlank(), ErrorCode.SYS_BAD_REQUEST, "请填写处理说明");
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT job_id, company_id, status FROM complaint WHERE id = ? FOR UPDATE", id);
        BizException.check(!rows.isEmpty(), ErrorCode.SYS_NOT_FOUND);
        BizException.check("PENDING".equals(rows.get(0).get("status")), ErrorCode.SYS_CONFLICT, "该投诉已处理");
        String jobId = (String) rows.get(0).get("job_id");
        String companyId = (String) rows.get(0).get("company_id");
        jdbc.update("UPDATE complaint SET status = ?, handled_by = ?, handle_remark = ?, handled_at = ? WHERE id = ?",
                verified ? "VERIFIED" : "REJECTED", operatorId, remark.trim(), LocalDateTime.now(clock), id);
        if (verified) {
            jdbc.update("UPDATE job SET complaint_verified = complaint_verified + 1 WHERE job_id = ?", jobId);
            Integer n = jdbc.queryForObject("SELECT complaint_verified FROM job WHERE job_id = ?", Integer.class, jobId);
            credit.event(companyId, "COMPLAINT_VERIFIED", "COMPLAINT", String.valueOf(id));
            if (n != null && n == AUTO_OFFLINE_AT) {
                String status = jdbc.queryForObject("SELECT job_status FROM job WHERE job_id = ?", String.class, jobId);
                if (Set.of("RECRUITING", "PAUSED", "PENDING_AUDIT").contains(status)) {
                    jobs.forceOffline(jobId, "岗位投诉核实属实累计 " + AUTO_OFFLINE_AT + " 次，系统自动下架", "SYSTEM");
                }
                credit.adjust(companyId, DEDUCT, "COMPLAINT_3X", "JOB", jobId, "岗位投诉属实累计 3 次", null);
            }
        }
        audit.log(verified ? "COMPLAINT_VERIFY" : "COMPLAINT_REJECT", "COMPLAINT", String.valueOf(id), Map.of("remark", remark.trim()));
    }
}
