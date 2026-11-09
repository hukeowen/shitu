package com.shitu.risk;

import com.shitu.common.util.Rows;
import com.shitu.common.Constants;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.outbox.OutboxWriter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Date;
import java.time.Clock;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * 诚信分与三级处罚（P-07，文档 13.1 / 13.2，D-24）。
 * <ul>
 *   <li>诚信分 0–100；规则扣分（陈旧岗位 −5、虚假状态 −10、私下导流 −30…）与人工调分（必须留痕）；</li>
 *   <li>诚信分 &lt; 30 或 3 级处罚 → 永久取消收费服务权限：岗位移出匹配池、不再参与流转分账（8 元改归平台），在岗计费照常；</li>
 *   <li>处罚：1 级警告；2 级限流 30 天（匹配权重 × 0.5）；3 级封禁（公司状态封禁 + 取消收费权限）。</li>
 * </ul>
 * 公司表为租户表，这里由平台 / 系统调用，用 JDBC 显式按公司操作。
 */
@Service
public class CreditService {

    public static final int REVOKE_BELOW = 30;

    private final JdbcTemplate jdbc;
    private final OutboxWriter outbox;
    private final AuditLogger audit;
    private final com.shitu.tenant.company.CompanyService companies;
    private final Clock clock;

    public CreditService(JdbcTemplate jdbc, OutboxWriter outbox, AuditLogger audit,
                         com.shitu.tenant.company.CompanyService companies, Clock clock) {
        this.jdbc = jdbc;
        this.outbox = outbox;
        this.audit = audit;
        this.companies = companies;
        this.clock = clock;
    }

    /** @return 调整后的分数 */
    @Transactional
    public int adjust(String companyId, int delta, String ruleCode, String refType, String refId, String remark, String operatorId) {
        BizException.check(!"MANUAL".equals(ruleCode) || (operatorId != null && remark != null && !remark.isBlank()),
                ErrorCode.SYS_BAD_REQUEST, "人工调分必须填写原因");
        List<Integer> cur = jdbc.queryForList("SELECT credit_score FROM company WHERE company_id = ? FOR UPDATE", Integer.class, companyId);
        BizException.check(!cur.isEmpty(), ErrorCode.SYS_NOT_FOUND);
        int after = Math.max(0, Math.min(100, cur.get(0) + delta));
        jdbc.update("UPDATE company SET credit_score = ?, version = version + 1 WHERE company_id = ?", after, companyId);
        jdbc.update("INSERT INTO credit_score_log (company_id, delta, score_after, rule_code, ref_type, ref_id, remark, operator_id) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", companyId, after - cur.get(0), after, ruleCode, refType, refId, remark, operatorId);
        if (delta < 0) {
            event(companyId, "CREDIT_DEDUCT_" + ruleCode, refType, refId);
        }
        if (after < REVOKE_BELOW) {
            revokeFeeRights(companyId, "诚信分低于 " + REVOKE_BELOW);
        }
        audit.logForCompany(companyId, "CREDIT_ADJUST", "COMPANY", companyId, Map.of("delta", delta, "after", after, "rule", ruleCode));
        return after;
    }

    /** 处罚（人工或 J-08 自动升级）。 */
    @Transactional
    public void penalize(String companyId, int level, String reason, String operatorId) {
        BizException.check(level >= 1 && level <= 3, ErrorCode.SYS_BAD_REQUEST, "处罚等级为 1–3");
        BizException.check(reason != null && !reason.isBlank(), ErrorCode.SYS_BAD_REQUEST, "请填写处罚原因");
        LocalDate today = LocalDate.now(clock.withZone(Constants.ZONE));
        LocalDate end = level == 2 ? today.plusDays(30) : null;
        jdbc.update("INSERT INTO penalty (company_id, level, reason, start_date, end_date, created_by) VALUES (?, ?, ?, ?, ?, ?)",
                companyId, level, reason.trim(), Date.valueOf(today), end == null ? null : Date.valueOf(end), operatorId);
        jdbc.update("UPDATE company SET penalty_level = GREATEST(penalty_level, ?), penalty_until = ?, version = version + 1 WHERE company_id = ?",
                level, end == null ? null : Date.valueOf(end), companyId);
        if (level == 3) {
            jdbc.update("UPDATE company SET company_status = 'BANNED', status_remark = ? WHERE company_id = ? "
                    + "AND company_status NOT IN ('DEREGISTERED','BANKRUPT')", "三级处罚：" + reason.trim(), companyId);
            revokeFeeRights(companyId, "三级处罚");
            companies.evictStatus(companyId);
        }
        outbox.publish("COMPANY_PENALIZED", "COMPANY", companyId, Map.of("companyId", companyId, "level", level, "reason", reason.trim()));
        audit.logForCompany(companyId, "PENALTY", "COMPANY", companyId, Map.of("level", level, "reason", reason.trim()));
    }

    /** J-08：2 级限流到期自动解除；单月异常事件满 3 次自动升一级（最高 2 级，3 级只能人工）。 */
    @Transactional
    public int[] dailyReview() {
        LocalDate today = LocalDate.now(clock.withZone(Constants.ZONE));
        int lifted = jdbc.update("UPDATE company SET penalty_level = 0, penalty_until = NULL WHERE penalty_level = 2 "
                + "AND penalty_until IS NOT NULL AND penalty_until < ?", Date.valueOf(today));
        int escalated = 0;
        for (Map<String, Object> r : jdbc.queryForList("SELECT e.company_id, COUNT(*) AS n, MAX(c.penalty_level) AS lvl FROM risk_event e "
                + "JOIN company c ON c.company_id = e.company_id WHERE e.created_at >= ? AND e.event_type NOT LIKE 'STALE%' "
                + "GROUP BY e.company_id HAVING n >= 3",
                Date.valueOf(today.withDayOfMonth(1)))) {
            String cid = (String) r.get("company_id");
            Long punishedThisMonth = jdbc.queryForObject("SELECT COUNT(*) FROM penalty WHERE company_id = ? AND start_date >= ? AND created_by = 'SYSTEM'",
                    Long.class, cid, Date.valueOf(today.withDayOfMonth(1)));
            int lvl = ((Number) r.get("lvl")).intValue();
            if ((punishedThisMonth == null || punishedThisMonth == 0) && lvl < 2) {
                penalize(cid, lvl + 1, "本月风控异常 " + r.get("n") + " 次（自动）", "SYSTEM");
                escalated++;
            }
        }
        return new int[]{lifted, escalated};
    }

    public void event(String companyId, String type, String refType, String refId) {
        jdbc.update("INSERT INTO risk_event (company_id, event_type, ref_type, ref_id) VALUES (?, ?, ?, ?)", companyId, type, refType, refId);
    }

    private void revokeFeeRights(String companyId, String why) {
        int changed = jdbc.update("UPDATE company SET fee_rights_revoked = 1 WHERE company_id = ? AND fee_rights_revoked = 0", companyId);
        if (changed > 0) {
            audit.logForCompany(companyId, "FEE_RIGHTS_REVOKE", "COMPANY", companyId, Map.of("reason", why));
            outbox.publish("FEE_RIGHTS_REVOKED", "COMPANY", companyId, Map.of("companyId", companyId, "reason", why));
        }
    }

    public List<Map<String, Object>> logs(String companyId) {
        return Rows.camel(jdbc.queryForList("SELECT delta, score_after, rule_code, ref_type, ref_id, remark, operator_id, created_at FROM credit_score_log "
                + "WHERE company_id = ? ORDER BY id DESC LIMIT 200", companyId));
    }

    public List<Map<String, Object>> penalties(String companyId) {
        return Rows.camel(jdbc.queryForList("SELECT p.company_id, COALESCE(c.short_name, c.name) AS company_name, p.level, p.reason, p.start_date, p.end_date, p.created_by, p.created_at "
                + "FROM penalty p LEFT JOIN company c ON c.company_id = p.company_id "
                + (companyId == null ? "" : "WHERE p.company_id = ? ") + "ORDER BY p.id DESC LIMIT 200",
                companyId == null ? new Object[0] : new Object[]{companyId}));
    }
}
