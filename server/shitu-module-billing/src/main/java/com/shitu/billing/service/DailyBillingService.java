package com.shitu.billing.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.shitu.billing.domain.BillingRule;
import com.shitu.billing.domain.FreePeriod;
import com.shitu.billing.domain.GrowthFeeCalculator;
import com.shitu.billing.domain.Money;
import com.shitu.billing.domain.TransferFeeSplitter;
import com.shitu.common.Constants;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.sql.Date;
import java.time.Clock;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * J-01 每日计费 + J-07 存量基数锁定（R-09 ~ R-11，D-18 / D-24）。
 * <pre>
 * 增长技术服务费（按公司）= max(当日在岗人数 − 存量基数, 0) × 0.10；免费期内为 0；免费期满次日锁定存量基数
 * 人才流转费（按人）    = 10 元 / 天，接收方付；来源公司 8 元 / 平台 2 元；来源为平台、来源公司已注销或被取消收费权限 → 10 元全归平台
 * </pre>
 * 幂等：重算某天先删后写（同一事务）；该月账单已下发后不允许重算。
 */
@Service
public class DailyBillingService {

    private static final Logger log = LoggerFactory.getLogger(DailyBillingService.class);

    public record DayResult(LocalDate bizDate, int ruleVersion, int companies, int transferLines,
                            BigDecimal serviceFee, BigDecimal transferFee) {
    }

    private final BillingFacts facts;
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final Clock clock;

    public DailyBillingService(BillingFacts facts, JdbcTemplate jdbc, ObjectMapper json, Clock clock) {
        this.facts = facts;
        this.jdbc = jdbc;
        this.json = json;
        this.clock = clock;
    }

    /** 每天 00:30 计算昨天。 */
    @Scheduled(cron = "${shitu.jobs.daily-billing-cron:0 30 0 * * *}", zone = "Asia/Shanghai")
    @SchedulerLock(name = "daily_billing", lockAtMostFor = "PT30M")
    public void scheduled() {
        LocalDate yesterday = LocalDate.now(clock.withZone(Constants.ZONE)).minusDays(1);
        DayResult r = run(yesterday);
        log.info("每日计费 {}：{} 家公司，流转 {} 人次，服务费 {}，流转费 {}", r.bizDate(), r.companies(), r.transferLines(),
                r.serviceFee(), r.transferFee());
    }

    @Transactional
    public DayResult run(LocalDate d) {
        BizException.check(d.isBefore(LocalDate.now(clock.withZone(Constants.ZONE))), ErrorCode.SYS_BAD_REQUEST, "只能计算已结束的日期");
        Long issued = jdbc.queryForObject("SELECT COUNT(*) FROM monthly_bill WHERE bill_month = ? AND status <> 'GENERATED'",
                Long.class, YearMonth.from(d).toString());
        BizException.check(issued == null || issued == 0, ErrorCode.SYS_CONFLICT, d + " 所在月份账单已下发，不能重算");

        BillingRule rule = facts.ruleAt(d);
        Map<String, BillingFacts.Co> cos = facts.companies();
        lockStockBases(d, rule, cos);
        Map<String, Integer> bases = facts.stockBases();
        List<BillingFacts.Emp> emps = facts.billableOn(d);

        jdbc.update("DELETE FROM billing_daily WHERE biz_date = ?", Date.valueOf(d));
        jdbc.update("DELETE FROM company_fee_daily WHERE biz_date = ?", Date.valueOf(d));

        Map<String, Integer> employed = new HashMap<>();
        Map<String, BigDecimal> payable = new HashMap<>();
        Map<String, BigDecimal> receivable = new HashMap<>();
        List<Object[]> lines = new ArrayList<>();
        for (BillingFacts.Emp e : emps) {
            employed.merge(e.companyId(), 1, Integer::sum);
            BillingFacts.Co source = cos.get(e.sourceCompanyId());
            TransferFeeSplitter.SourceEligibility elig = source == null ? TransferFeeSplitter.SourceEligibility.ELIGIBLE
                    : source.closed() ? TransferFeeSplitter.SourceEligibility.CLOSED
                    : source.feeRightsRevoked() ? TransferFeeSplitter.SourceEligibility.REVOKED
                    : TransferFeeSplitter.SourceEligibility.ELIGIBLE;
            Optional<TransferFeeSplitter.Split> split = TransferFeeSplitter.daily(e.sourceCompanyId(), elig, e.companyId(), rule);
            if (split.isEmpty()) {
                continue;
            }
            TransferFeeSplitter.Split s = split.get();
            payable.merge(e.companyId(), s.payerAmount(), BigDecimal::add);
            if (s.supplyCompanyId() != null && s.supplyAmount().signum() > 0) {
                receivable.merge(s.supplyCompanyId(), s.supplyAmount(), BigDecimal::add);
            }
            lines.add(new Object[]{Date.valueOf(d), e.companyId(), e.userId(), e.employmentId(), "TRANSFER", rule.version(),
                    rule.transferUnitPrice(), s.payerAmount(), s.supplyCompanyId(), s.supplyAmount(), s.platformAmount(),
                    e.stock()});
        }
        if (!lines.isEmpty()) {
            jdbc.batchUpdate("INSERT INTO billing_daily (biz_date, company_id, user_id, employment_id, fee_type, rule_version, "
                    + "unit_price, payer_amount, supply_company_id, supply_amount, platform_amount, is_stock) "
                    + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", lines);
        }

        Set<String> companyIds = new HashSet<>(employed.keySet());
        companyIds.addAll(receivable.keySet());
        companyIds.remove(Constants.PLATFORM);
        BigDecimal totalService = Money.zero();
        BigDecimal totalTransfer = Money.zero();
        List<Object[]> rows = new ArrayList<>();
        for (String cid : companyIds) {
            BillingFacts.Co co = cos.get(cid);
            boolean free = co == null || co.onboardDate() == null
                    || FreePeriod.isInFreePeriod(co.onboardDate(), rule.freeMonths(), d);
            int count = employed.getOrDefault(cid, 0);
            int base = bases.getOrDefault(cid, 0);
            GrowthFeeCalculator.Result g = GrowthFeeCalculator.daily(count, base, free, rule);
            BigDecimal pay = Money.round(payable.getOrDefault(cid, Money.zero()));
            BigDecimal recv = Money.round(receivable.getOrDefault(cid, Money.zero()));
            rows.add(new Object[]{Date.valueOf(d), cid, rule.version(), free, count, g.stockBase(), g.incrementCount(),
                    g.fee(), pay, recv});
            totalService = totalService.add(g.fee());
            totalTransfer = totalTransfer.add(pay);
        }
        if (!rows.isEmpty()) {
            jdbc.batchUpdate("INSERT INTO company_fee_daily (biz_date, company_id, rule_version, in_free_period, employed_count, "
                    + "stock_base, increment_count, service_fee, transfer_payable, transfer_receivable) "
                    + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows);
        }
        return new DayResult(d, rule.version(), rows.size(), lines.size(), Money.round(totalService), Money.round(totalTransfer));
    }

    /**
     * J-07：免费期满（锁定日 ≤ d）且尚未锁定的公司，按免费期最后一天的在岗人数锁定存量基数，锁定后不可变。
     * 存量人员（免费期内导入 / 入职的）永久免费。
     */
    void lockStockBases(LocalDate d, BillingRule rule, Map<String, BillingFacts.Co> cos) {
        Map<String, Integer> locked = facts.stockBases();
        for (BillingFacts.Co co : cos.values()) {
            if (co.onboardDate() == null || locked.containsKey(co.companyId())) {
                continue;
            }
            LocalDate lockDate = FreePeriod.lockDate(co.onboardDate(), rule.freeMonths());
            if (lockDate.isAfter(d)) {
                continue;
            }
            LocalDate asOf = FreePeriod.lastFreeDay(co.onboardDate(), rule.freeMonths());
            int base = (int) facts.billableOn(asOf).stream().filter(e -> e.companyId().equals(co.companyId())).count();
            String detail;
            try {
                detail = json.writeValueAsString(Map.of("asOf", asOf.toString(), "ruleVersion", rule.version(),
                        "rule", "start_date < asOf AND (end_date IS NULL OR end_date > asOf)"));
            } catch (Exception e) {
                detail = null;
            }
            jdbc.update("INSERT IGNORE INTO stock_base (company_id, base_count, locked_at, locked_by, detail) VALUES (?, ?, ?, 'SYSTEM', ?)",
                    co.companyId(), base, java.time.LocalDateTime.now(clock), detail);
            log.info("锁定存量基数 {} = {}（截至 {}）", co.companyId(), base, asOf);
        }
    }
}
