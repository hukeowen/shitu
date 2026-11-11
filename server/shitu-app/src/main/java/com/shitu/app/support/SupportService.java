package com.shitu.app.support;

import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.common.util.Masks;
import com.shitu.common.util.Rows;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.kv.RateLimiter;
import com.shitu.framework.outbox.OutboxWriter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 求职者的两类求助：
 * <ul>
 *   <li>问题反馈（C-508）：发给平台，运营中台处理并回复；</li>
 *   <li>工资申诉（C-702，D-28）：针对某张工资条，发给发薪公司，项目经理 / 老板处理并回复。</li>
 * </ul>
 * JDBC 不经过租户拦截器：工资申诉的语句显式带 company_id；feedback 是平台表，只有平台与本人能读。
 */
@Service
public class SupportService {

    static final Set<String> CATEGORIES = Set.of("ACCOUNT", "JOB", "PAY", "CONTRACT", "SUGGEST", "OTHER");
    static final Set<String> ITEMS = Set.of("GROSS", "SOCIAL", "TAX", "OTHER_DEDUCT", "ADVANCE_DEDUCT", "NET", "OTHER");

    private final JdbcTemplate jdbc;
    private final OutboxWriter outbox;
    private final RateLimiter limiter;
    private final FieldCipher cipher;
    private final AuditLogger audit;

    public SupportService(JdbcTemplate jdbc, OutboxWriter outbox, RateLimiter limiter, FieldCipher cipher, AuditLogger audit) {
        this.jdbc = jdbc;
        this.outbox = outbox;
        this.limiter = limiter;
        this.cipher = cipher;
        this.audit = audit;
    }

    // ================================================================= 问题反馈（C-508）

    @Transactional
    public long submitFeedback(String userId, String category, String content, String contact) {
        BizException.check(CATEGORIES.contains(category), ErrorCode.SYS_BAD_REQUEST, "请选择问题类型");
        String text = content == null ? "" : content.trim();
        BizException.check(text.length() >= 5 && text.length() <= 1000, ErrorCode.SYS_BAD_REQUEST, "请用 5–1000 个字描述问题");
        BizException.check(contact == null || contact.isBlank() || Masks.isMobile(contact.trim()), ErrorCode.SYS_BAD_REQUEST, "回访电话格式不正确");
        BizException.check(limiter.tryAcquire("feedback:" + userId, 5, Duration.ofHours(1)), ErrorCode.SYS_TOO_MANY_REQUESTS, "提交太频繁，请稍后再试");
        jdbc.update("INSERT INTO feedback (user_id, category, content, contact) VALUES (?, ?, ?, ?)",
                userId, category, text, contact == null || contact.isBlank() ? null : contact.trim());
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return id == null ? 0 : id;
    }

    public List<Map<String, Object>> myFeedback(String userId) {
        return Rows.camel(jdbc.queryForList("SELECT id, category, content, status, reply, created_at, handled_at FROM feedback "
                + "WHERE user_id = ? ORDER BY id DESC LIMIT 50", userId));
    }

    /** 运营中台：工单列表（手机号脱敏；回访电话是用户主动留的，完整展示）。 */
    public List<Map<String, Object>> feedbackQueue(String status) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT f.id, f.user_id, f.category, f.content, f.contact, f.status, f.reply, "
                + "f.created_at, f.handled_at, a.display_name AS handled_by_name, u.phone_enc, u.real_name_enc, c.name AS bound_company_name "
                + "FROM feedback f JOIN `user` u ON u.user_id = f.user_id LEFT JOIN ops_admin a ON a.admin_id = f.handled_by "
                + "LEFT JOIN company c ON c.company_id = u.bound_company_id "
                + (status == null || status.isBlank() ? "" : "WHERE f.status = ? ") + "ORDER BY f.id DESC LIMIT 200",
                status == null || status.isBlank() ? new Object[0] : new Object[]{status});
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            Object phone = r.remove("phone_enc");
            Object name = r.remove("real_name_enc");
            r.put("phone_masked", phone == null ? null : Masks.phone(cipher.decrypt((String) phone)));
            r.put("seeker_name", name == null ? "未实名" : Masks.name(cipher.decrypt((String) name)));
            out.add(r);
        }
        return Rows.camel(out);
    }

    @Transactional
    public void replyFeedback(String adminId, long id, String reply, boolean close) {
        String text = reply == null ? "" : reply.trim();
        BizException.check(close || !text.isEmpty(), ErrorCode.SYS_BAD_REQUEST, "请填写回复内容");
        BizException.check(text.length() <= 1000, ErrorCode.SYS_BAD_REQUEST, "回复不能超过 1000 字");
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT user_id, status FROM feedback WHERE id = ? FOR UPDATE", id);
        BizException.check(!rows.isEmpty(), ErrorCode.SYS_NOT_FOUND);
        BizException.check("OPEN".equals(rows.get(0).get("status")), ErrorCode.SYS_CONFLICT, "该反馈已处理");
        jdbc.update("UPDATE feedback SET status = ?, reply = ?, handled_by = ?, handled_at = NOW(3) WHERE id = ?",
                text.isEmpty() ? "CLOSED" : "REPLIED", text.isEmpty() ? null : text, adminId, id);
        audit.log("FEEDBACK_REPLY", "FEEDBACK", String.valueOf(id), null);
        if (!text.isEmpty()) {
            outbox.publish("FEEDBACK_REPLIED", "FEEDBACK", String.valueOf(id), Map.of("userId", rows.get(0).get("user_id"), "reply", text));
        }
    }

    // ================================================================= 工资申诉（C-702）

    @Transactional
    public long appealPayslip(String userId, String payslipId, String itemCode, String content) {
        BizException.check(itemCode == null || itemCode.isBlank() || ITEMS.contains(itemCode), ErrorCode.SYS_BAD_REQUEST, "请选择有疑问的项目");
        String text = content == null ? "" : content.trim();
        BizException.check(text.length() >= 5 && text.length() <= 500, ErrorCode.SYS_BAD_REQUEST, "请用 5–500 个字说明问题");
        // 只能申诉本人的、已发布的工资条
        List<Map<String, Object>> slip = jdbc.queryForList("SELECT p.company_id, p.pay_month, e.project_id FROM payslip p "
                + "JOIN payroll_batch b ON b.batch_id = p.batch_id AND b.status = 'PUBLISHED' "
                + "LEFT JOIN employment e ON e.employment_id = p.employment_id WHERE p.payslip_id = ? AND p.user_id = ?", payslipId, userId);
        BizException.check(!slip.isEmpty(), ErrorCode.SYS_NOT_FOUND);
        Integer open = jdbc.queryForObject("SELECT COUNT(*) FROM payslip_appeal WHERE payslip_id = ? AND user_id = ? AND status = 'OPEN'",
                Integer.class, payslipId, userId);
        BizException.check(open == null || open == 0, ErrorCode.SYS_CONFLICT, "这张工资条已有处理中的申诉");
        String companyId = (String) slip.get(0).get("company_id");
        jdbc.update("INSERT INTO payslip_appeal (company_id, payslip_id, user_id, item_code, content) VALUES (?, ?, ?, ?, ?)",
                companyId, payslipId, userId, itemCode == null || itemCode.isBlank() ? null : itemCode, text);
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        Map<String, Object> payload = new java.util.HashMap<>(Map.of("userId", userId, "companyId", companyId,
                "month", slip.get(0).get("pay_month"), "content", text.length() > 60 ? text.substring(0, 60) + "…" : text));
        if (slip.get(0).get("project_id") != null) {
            payload.put("projectId", slip.get(0).get("project_id"));
        }
        outbox.publish("PAYSLIP_APPEAL_SUBMITTED", "PAYSLIP", payslipId, payload);
        return id == null ? 0 : id;
    }

    public List<Map<String, Object>> myPayslipAppeals(String userId, String payslipId) {
        return Rows.camel(jdbc.queryForList("SELECT id, payslip_id, item_code, content, status, reply, created_at, handled_at "
                + "FROM payslip_appeal WHERE user_id = ? AND payslip_id = ? ORDER BY id DESC", userId, payslipId));
    }

    /** 公司后台：本公司的工资申诉（姓名、手机号脱敏）。 */
    public List<Map<String, Object>> payslipAppeals(String companyId, String status) {
        List<Object> args = new ArrayList<>(List.of(companyId));
        String sql = "SELECT a.id, a.payslip_id, a.item_code, a.content, a.status, a.reply, a.created_at, a.handled_at, m.name AS handled_by_name, "
                + "p.pay_month, p.gross_pay, p.social_insurance, p.income_tax, p.other_deduct, p.advance_deduct, p.net_pay, "
                + "e.employee_no, pr.name AS project_name, u.real_name_enc, u.phone_enc "
                + "FROM payslip_appeal a JOIN payslip p ON p.payslip_id = a.payslip_id AND p.company_id = a.company_id "
                + "JOIN `user` u ON u.user_id = a.user_id LEFT JOIN employment e ON e.employment_id = p.employment_id "
                + "LEFT JOIN project pr ON pr.project_id = e.project_id LEFT JOIN member m ON m.member_id = a.handled_by "
                + "WHERE a.company_id = ?";
        if (status != null && !status.isBlank()) {
            sql += " AND a.status = ?";
            args.add(status);
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : jdbc.queryForList(sql + " ORDER BY a.id DESC LIMIT 200", args.toArray())) {
            Object phone = r.remove("phone_enc");
            Object name = r.remove("real_name_enc");
            r.put("phone_masked", phone == null ? null : Masks.phone(cipher.decrypt((String) phone)));
            r.put("seeker_name", name == null ? "未实名" : Masks.name(cipher.decrypt((String) name)));
            out.add(r);
        }
        return Rows.camel(out);
    }

    @Transactional
    public void handlePayslipAppeal(String companyId, String memberId, long id, boolean accept, String reply) {
        String text = reply == null ? "" : reply.trim();
        BizException.check(text.length() >= 2 && text.length() <= 500, ErrorCode.SYS_BAD_REQUEST, "请填写处理说明");
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT a.user_id, a.status, a.payslip_id, p.pay_month FROM payslip_appeal a "
                + "JOIN payslip p ON p.payslip_id = a.payslip_id WHERE a.id = ? AND a.company_id = ? FOR UPDATE", id, companyId);
        BizException.check(!rows.isEmpty(), ErrorCode.SYS_NOT_FOUND);
        BizException.check("OPEN".equals(rows.get(0).get("status")), ErrorCode.SYS_CONFLICT, "该申诉已处理");
        jdbc.update("UPDATE payslip_appeal SET status = ?, reply = ?, handled_by = ?, handled_at = NOW(3) WHERE id = ?",
                accept ? "RESOLVED" : "REJECTED", text, memberId, id);
        audit.log(accept ? "PAYSLIP_APPEAL_RESOLVE" : "PAYSLIP_APPEAL_REJECT", "PAYSLIP", (String) rows.get(0).get("payslip_id"), null);
        outbox.publish("PAYSLIP_APPEAL_HANDLED", "PAYSLIP", (String) rows.get(0).get("payslip_id"), Map.of(
                "userId", rows.get(0).get("user_id"), "month", rows.get(0).get("pay_month"),
                "reply", (accept ? "已受理。" : "未受理。") + text));
    }
}
