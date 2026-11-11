package com.shitu.app.tenant;

import com.shitu.common.Constants;
import com.shitu.common.util.Masks;
import com.shitu.framework.crypto.FieldCipher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.sql.Date;
import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * 流转人员台账（T-404 的按人累计视图）：逐人看流转费从哪天计到哪天、每天多少、本月多少、累计多少。
 * <p>数据边界与流转账本一致：流入（我付费）的人在我司任职，展示脱敏姓名、岗位和来源公司；
 * 流出（我收费）的人已在别的公司任职，只给用户 ID、天数和金额，不透露去向公司、岗位和姓名。
 */
@Service
public class CirculationPeopleService {

    public record PersonLine(String direction, String userId, String name, String counterpartCompanyId, String counterpartCompanyName,
                             String jobTitle, LocalDate firstDate, LocalDate lastDate, int days, BigDecimal dailyAmount,
                             BigDecimal monthAmount, BigDecimal totalAmount, boolean active) {
    }

    private final JdbcTemplate jdbc;
    private final FieldCipher cipher;
    private final Clock clock;

    public CirculationPeopleService(JdbcTemplate jdbc, FieldCipher cipher, Clock clock) {
        this.jdbc = jdbc;
        this.cipher = cipher;
        this.clock = clock;
    }

    public List<PersonLine> people(String companyId) {
        Date monthStart = Date.valueOf(LocalDate.now(clock).withDayOfMonth(1));
        // 「在计费」= 最近一个计费日仍有这个人的记录
        Date latest = jdbc.queryForObject("SELECT MAX(biz_date) FROM billing_daily WHERE fee_type = 'TRANSFER'", Date.class);
        List<PersonLine> out = new ArrayList<>();
        out.addAll(jdbc.query("SELECT b.user_id, MAX(b.supply_company_id), MAX(COALESCE(c.short_name, c.name)), MAX(j.title), MAX(u.real_name_enc), "
                        + "MIN(b.biz_date), MAX(b.biz_date), COUNT(*), "
                        + "SUBSTRING_INDEX(GROUP_CONCAT(b.payer_amount ORDER BY b.biz_date DESC), ',', 1), "
                        + "SUM(IF(b.biz_date >= ?, b.payer_amount, 0)), SUM(b.payer_amount) FROM billing_daily b "
                        + "LEFT JOIN company c ON c.company_id = b.supply_company_id "
                        + "LEFT JOIN employment e ON e.employment_id = b.employment_id LEFT JOIN job j ON j.job_id = e.job_id "
                        + "LEFT JOIN `user` u ON u.user_id = b.user_id "
                        + "WHERE b.company_id = ? AND b.fee_type = 'TRANSFER' GROUP BY b.user_id, b.employment_id ORDER BY MAX(b.biz_date) DESC, SUM(b.payer_amount) DESC LIMIT 2000",
                (rs, i) -> new PersonLine("PAYABLE", rs.getString(1), rs.getString(5) == null ? null : Masks.name(cipher.decrypt(rs.getString(5))),
                        rs.getString(2), rs.getString(3) != null ? rs.getString(3) : Constants.PLATFORM.equals(rs.getString(2)) ? "平台" : null,
                        rs.getString(4), rs.getDate(6).toLocalDate(), rs.getDate(7).toLocalDate(), rs.getInt(8),
                        new BigDecimal(rs.getString(9)), rs.getBigDecimal(10), rs.getBigDecimal(11),
                        latest != null && !rs.getDate(7).before(latest)),
                monthStart, companyId));
        out.addAll(jdbc.query("SELECT user_id, MIN(biz_date), MAX(biz_date), COUNT(*), "
                        + "SUBSTRING_INDEX(GROUP_CONCAT(supply_amount ORDER BY biz_date DESC), ',', 1), "
                        + "SUM(IF(biz_date >= ?, supply_amount, 0)), SUM(supply_amount) FROM billing_daily "
                        + "WHERE supply_company_id = ? AND fee_type = 'TRANSFER' GROUP BY user_id, employment_id ORDER BY MAX(biz_date) DESC, SUM(supply_amount) DESC LIMIT 2000",
                (rs, i) -> new PersonLine("RECEIVABLE", rs.getString(1), null, null, null, null, rs.getDate(2).toLocalDate(),
                        rs.getDate(3).toLocalDate(), rs.getInt(4), new BigDecimal(rs.getString(5)), rs.getBigDecimal(6),
                        rs.getBigDecimal(7), latest != null && !rs.getDate(3).before(latest)),
                monthStart, companyId));
        return out;
    }
}
