package com.shitu.billing.service;

import com.shitu.billing.domain.BillingRule;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.Date;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 计费的事实来源（只读 SQL）。计费模块不依赖生命周期模块的代码（ArchitectureTest），任职记录是唯一事实依据（02-架构 §6.2）。
 */
@Component
public class BillingFacts {

    /** 任职事实。 */
    public record Emp(String employmentId, String userId, String companyId, LocalDate startDate, LocalDate endDate,
                      String sourceCompanyId, boolean transfer, boolean stock) {
    }

    /** 公司事实。 */
    public record Co(String companyId, LocalDate onboardDate, String status, boolean feeRightsRevoked) {
        public boolean closed() {
            return "DEREGISTERED".equals(status) || "BANKRUPT".equals(status);
        }
    }

    private final JdbcTemplate jdbc;

    public BillingFacts(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** biz_date 当天生效的计费规则（版本化）。 */
    public BillingRule ruleAt(LocalDate d) {
        List<BillingRule> r = jdbc.query("SELECT version, effective_from, service_unit_price, transfer_unit_price, supply_share, "
                        + "free_months FROM billing_rule WHERE effective_from <= ? ORDER BY effective_from DESC LIMIT 1",
                (rs, i) -> new BillingRule(rs.getInt(1), rs.getDate(2).toLocalDate(), rs.getBigDecimal(3), rs.getBigDecimal(4),
                        rs.getBigDecimal(5), rs.getInt(6)), Date.valueOf(d));
        BizException.check(!r.isEmpty(), ErrorCode.BIL_RULE_MISSING);
        return r.get(0);
    }

    /** 在 d 当天计费的任职：入职日 &lt; d 且（未离职 或 离职日 &gt; d）——与 BillableDays 口径一致（当日入职、当日离职都不计）。 */
    public List<Emp> billableOn(LocalDate d) {
        return jdbc.query("SELECT employment_id, user_id, company_id, start_date, end_date, source_company_id_snapshot, "
                        + "is_transfer, is_stock FROM employment WHERE start_date < ? AND (end_date IS NULL OR end_date > ?)",
                (rs, i) -> new Emp(rs.getString(1), rs.getString(2), rs.getString(3), rs.getDate(4).toLocalDate(),
                        rs.getDate(5) == null ? null : rs.getDate(5).toLocalDate(), rs.getString(6), rs.getBoolean(7),
                        rs.getBoolean(8)), Date.valueOf(d), Date.valueOf(d));
    }

    public Map<String, Co> companies() {
        Map<String, Co> m = new HashMap<>();
        jdbc.query("SELECT company_id, onboard_date, company_status, fee_rights_revoked FROM company", rs -> {
            m.put(rs.getString(1), new Co(rs.getString(1), rs.getDate(2) == null ? null : rs.getDate(2).toLocalDate(),
                    rs.getString(3), rs.getBoolean(4)));
        });
        return m;
    }

    public Map<String, Integer> stockBases() {
        Map<String, Integer> m = new HashMap<>();
        jdbc.query("SELECT company_id, base_count FROM stock_base", rs -> {
            m.put(rs.getString(1), rs.getInt(2));
        });
        return m;
    }
}
