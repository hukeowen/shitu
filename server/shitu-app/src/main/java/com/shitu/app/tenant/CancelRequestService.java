package com.shitu.app.tenant;

import com.shitu.common.enums.ActorRole;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.common.util.Masks;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.outbox.OutboxWriter;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.lifecycle.employment.OnboardingService;
import com.shitu.tenant.scope.DataScope;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 求职者申请取消报名。R-04 不变——取消仍由驻场 / 项目经理执行：求职者提交申请和原因，驻场或项目经理「同意并取消」
 * （走后台取消报名的同一条路径：释放、名额 +1、可重新匹配）或「不同意」（必须给出说明）。
 * 报名因其他原因结束（超时释放、面试未过、被后台直接取消等）时，还没处理的申请自动关闭。
 */
@Service
public class CancelRequestService {

    /** 求职者看到的自己的申请 */
    public record Mine(long id, String applicationId, String reason, String status, String reply, LocalDateTime createdAt,
                       LocalDateTime handledAt) {
    }

    /** 驻场 / 项目经理看到的申请 */
    public record Row(long id, String applicationId, String userId, String seekerName, String jobTitle, String projectId,
                      String projectName, String applicationStatus, String reason, String status, String reply,
                      String handledByName, LocalDateTime createdAt, LocalDateTime handledAt) {
    }

    private final JdbcTemplate jdbc;
    private final OnboardingService onboarding;
    private final DataScope scope;
    private final FieldCipher cipher;
    private final OutboxWriter outbox;
    private final AuditLogger audit;
    private final Clock clock;

    public CancelRequestService(JdbcTemplate jdbc, OnboardingService onboarding, DataScope scope, FieldCipher cipher,
                                OutboxWriter outbox, AuditLogger audit, Clock clock) {
        this.jdbc = jdbc;
        this.onboarding = onboarding;
        this.scope = scope;
        this.cipher = cipher;
        this.outbox = outbox;
        this.audit = audit;
        this.clock = clock;
    }

    // ------------------------------------------------------------------ 求职者

    @Transactional
    public Mine submit(String userId, String applicationId, String reason) {
        BizException.check(reason != null && !reason.isBlank() && reason.trim().length() <= 255, ErrorCode.SYS_BAD_REQUEST,
                "请填写取消原因（255 字以内）");
        List<Map<String, Object>> a = jdbc.queryForList("SELECT a.company_id, a.project_id, a.status, j.title FROM application a "
                + "LEFT JOIN job j ON j.job_id = a.job_id WHERE a.application_id = ? AND a.user_id = ? FOR UPDATE", applicationId, userId);
        BizException.check(!a.isEmpty(), ErrorCode.SYS_NOT_FOUND);
        String status = (String) a.get(0).get("status");
        BizException.check("PENDING_INTERVIEW".equals(status) || "PENDING_CONFIRM".equals(status), ErrorCode.SYS_BAD_REQUEST, "这条报名已经结束，不需要取消");
        Integer pending = jdbc.queryForObject("SELECT COUNT(*) FROM application_cancel_request WHERE application_id = ? AND status = 'PENDING'",
                Integer.class, applicationId);
        BizException.check(pending == null || pending == 0, ErrorCode.SYS_CONFLICT, "你已经提交过取消申请，驻场老师正在处理");
        jdbc.update("INSERT INTO application_cancel_request (application_id, user_id, company_id, project_id, reason) VALUES (?, ?, ?, ?, ?)",
                applicationId, userId, a.get(0).get("company_id"), a.get(0).get("project_id"), reason.trim());
        audit.logForCompany((String) a.get(0).get("company_id"), "APPLICATION_CANCEL_REQUEST", "APPLICATION", applicationId,
                Map.of("reason", reason.trim()));
        Map<String, Object> payload = new HashMap<>();
        payload.put("companyId", a.get(0).get("company_id"));
        payload.put("projectId", a.get(0).get("project_id"));
        payload.put("userId", userId);
        payload.put("to", "STAFF");
        payload.put("content", "{name} 申请取消报名「" + (a.get(0).get("title") == null ? "" : a.get(0).get("title")) + "」：" + reason.trim()
                + "。请到「取消申请」里处理。");
        payload.put("link", "/cancel-requests");
        outbox.publish("STAFF_NOTICE", "APPLICATION", applicationId, payload);
        return mine(userId, applicationId).orElseThrow();
    }

    /** 这条报名最近的一次取消申请。 */
    public Optional<Mine> mine(String userId, String applicationId) {
        closeStale("r.application_id = ?", applicationId);
        return jdbc.query("SELECT id, application_id, reason, status, reply, created_at, handled_at FROM application_cancel_request "
                        + "WHERE application_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1",
                (rs, i) -> new Mine(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                        rs.getTimestamp(6).toLocalDateTime(), rs.getTimestamp(7) == null ? null : rs.getTimestamp(7).toLocalDateTime()),
                applicationId, userId).stream().findFirst();
    }

    // ------------------------------------------------------------------ 驻场 / 项目经理

    /** @param status PENDING 待处理；为空返回最近 200 条 */
    public List<Row> list(AuthPrincipal p, String status) {
        closeStale("r.company_id = ?", p.companyId());
        DataScope.Scope s = scope.of(p);
        return jdbc.query("SELECT r.id, r.application_id, r.user_id, u.real_name_enc, j.title, r.project_id, pr.name, a.status, r.reason, "
                        + "r.status, r.reply, m.name, r.created_at, r.handled_at FROM application_cancel_request r "
                        + "JOIN application a ON a.application_id = r.application_id LEFT JOIN job j ON j.job_id = a.job_id "
                        + "LEFT JOIN project pr ON pr.project_id = r.project_id LEFT JOIN user u ON u.user_id = r.user_id "
                        + "LEFT JOIN member m ON m.member_id = r.handled_by WHERE r.company_id = ?"
                        + (status == null || status.isBlank() ? "" : " AND r.status = ?") + " ORDER BY r.status = 'PENDING' DESC, r.id DESC LIMIT 200",
                (rs, i) -> new Row(rs.getLong(1), rs.getString(2), rs.getString(3),
                        rs.getString(4) == null ? "未实名" : Masks.name(cipher.decrypt(rs.getString(4))), rs.getString(5), rs.getString(6),
                        rs.getString(7), rs.getString(8), rs.getString(9), rs.getString(10), rs.getString(11), rs.getString(12),
                        rs.getTimestamp(13).toLocalDateTime(), rs.getTimestamp(14) == null ? null : rs.getTimestamp(14).toLocalDateTime()),
                status == null || status.isBlank() ? new Object[]{p.companyId()} : new Object[]{p.companyId(), status})
                .stream().filter(r -> s.covers(r.projectId())).toList();
    }

    /** 自己负责的项目里待处理的申请数（工作台角标）。 */
    public long pendingCount(AuthPrincipal p) {
        return list(p, "PENDING").size();
    }

    /** 同意（立即取消这条报名）或不同意（必须写说明，通知求职者）。 */
    @Transactional
    public void decide(AuthPrincipal p, long id, boolean approve, String reply) {
        BizException.check(p.hasAnyRole(ActorRole.SITE.name(), ActorRole.PM.name()), ErrorCode.LC_ACTOR_NOT_ALLOWED);
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT application_id, user_id, project_id, reason, status FROM application_cancel_request "
                + "WHERE id = ? AND company_id = ? FOR UPDATE", id, p.companyId());
        BizException.check(!rows.isEmpty(), ErrorCode.SYS_NOT_FOUND);
        Map<String, Object> r = rows.get(0);
        scope.checkProject(p, (String) r.get("project_id"));
        BizException.check("PENDING".equals(r.get("status")), ErrorCode.SYS_CONFLICT, "这条申请已处理过");
        String applicationId = (String) r.get("application_id");
        String text = reply == null ? "" : reply.trim();
        BizException.check(text.length() <= 255, ErrorCode.SYS_BAD_REQUEST, "说明最多 255 个字");
        if (approve) {
            // 走后台取消报名的同一条路径（R-04：由后台操作人取消）
            onboarding.cancel(p, applicationId, "求职者申请取消：" + r.get("reason"));
        } else {
            BizException.check(!text.isEmpty(), ErrorCode.SYS_BAD_REQUEST, "不同意时请写明原因，求职者会看到");
            outbox.publish("SEEKER_NOTICE", "APPLICATION", applicationId, Map.of("userId", r.get("user_id"),
                    "content", "你的取消报名申请未获同意：" + text + "。如有疑问请联系驻场老师。", "link", "/reports/" + applicationId));
        }
        jdbc.update("UPDATE application_cancel_request SET status = ?, reply = ?, handled_by = ?, handled_at = ? WHERE id = ?",
                approve ? "APPROVED" : "REJECTED", text.isEmpty() ? null : text, p.subjectId(), LocalDateTime.now(clock), id);
        audit.log(approve ? "APPLICATION_CANCEL_REQUEST_APPROVE" : "APPLICATION_CANCEL_REQUEST_REJECT", "APPLICATION", applicationId,
                text.isEmpty() ? null : Map.of("reply", text));
    }

    /** 报名已经因为别的原因结束的，待处理申请自动关闭。只处理调用方相关的范围（某条报名 / 某家公司），走索引。 */
    private void closeStale(String scopeSql, String scopeArg) {
        jdbc.update("UPDATE application_cancel_request r JOIN application a ON a.application_id = r.application_id "
                + "SET r.status = 'CLOSED', r.handled_at = ? WHERE r.status = 'PENDING' AND " + scopeSql
                + " AND a.status NOT IN ('PENDING_INTERVIEW', 'PENDING_CONFIRM')", LocalDateTime.now(clock), scopeArg);
    }
}
