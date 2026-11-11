package com.shitu.app.support;

import com.shitu.framework.param.SysParams;
import com.shitu.lifecycle.seeker.FraudPenalty;
import com.shitu.risk.CreditService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** D-17：同一证件多手机号注册经人工确认为刷单后，引流公司扣诚信分（默认 30，可在系统参数调整）。 */
@Component
public class FraudPenaltyImpl implements FraudPenalty {

    private final CreditService credit;
    private final SysParams params;
    private final JdbcTemplate jdbc;

    public FraudPenaltyImpl(CreditService credit, SysParams params, JdbcTemplate jdbc) {
        this.credit = credit;
        this.params = params;
        this.jdbc = jdbc;
    }

    @Override
    public void penalize(String companyId, long reviewId, String remark, String operatorId) {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM company WHERE company_id = ?", Long.class, companyId);
        if (n == null || n == 0) {
            return;
        }
        credit.adjust(companyId, -Math.abs(params.getInt("kyc.fraud_credit_deduct", 30)), "FRAUD_REGISTER", "KYC_REVIEW",
                String.valueOf(reviewId), remark, operatorId);
    }
}
