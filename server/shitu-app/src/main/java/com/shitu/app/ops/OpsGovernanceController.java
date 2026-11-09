package com.shitu.app.ops;

import com.shitu.common.util.Rows;
import com.shitu.common.Constants;
import com.shitu.common.api.ApiResponse;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.common.util.Masks;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.security.CurrentUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.sql.Date;
import java.time.Clock;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** 平台中台：计费规则 P-09（版本化）、花名册与存量基数 P-03、归属治理查询 P-08。 */
@Tag(name = "平台中台 · 计费规则与归属治理")
@RestController
@RequestMapping("/api/v1/ops")
public class OpsGovernanceController {

    public record RuleRequest(@NotNull LocalDate effectiveFrom,
                              @NotNull @DecimalMin("0.00") @DecimalMax("99.99") BigDecimal serviceUnitPrice,
                              @NotNull @DecimalMin("0.00") @DecimalMax("999.99") BigDecimal transferUnitPrice,
                              @NotNull @DecimalMin("0.00") @DecimalMax("1.00") BigDecimal supplyShare,
                              @NotNull @Min(0) @Max(24) Integer freeMonths) {
    }

    private final JdbcTemplate jdbc;
    private final FieldCipher cipher;
    private final AuditLogger audit;
    private final Clock clock;

    public OpsGovernanceController(JdbcTemplate jdbc, FieldCipher cipher, AuditLogger audit, Clock clock) {
        this.jdbc = jdbc;
        this.cipher = cipher;
        this.audit = audit;
        this.clock = clock;
    }

    @Operation(summary = "计费规则版本列表（P-09）")
    @PreAuthorize("hasAnyRole('SUPER','FINANCE')")
    @GetMapping("/billing/rules")
    public ApiResponse<List<Map<String, Object>>> rules() {
        return ApiResponse.ok(Rows.camel(jdbc.queryForList("SELECT version, effective_from, service_unit_price, transfer_unit_price, supply_share, "
                + "free_months, created_by, created_at FROM billing_rule ORDER BY effective_from DESC")));
    }

    @Operation(summary = "新增计费规则版本（只能从明天及以后生效，历史计费不受影响）")
    @PreAuthorize("hasRole('SUPER')")
    @PostMapping("/billing/rules")
    @Transactional
    public ApiResponse<Integer> addRule(@Valid @RequestBody RuleRequest req) {
        LocalDate tomorrow = LocalDate.now(clock.withZone(Constants.ZONE)).plusDays(1);
        BizException.check(!req.effectiveFrom().isBefore(tomorrow), ErrorCode.SYS_BAD_REQUEST, "生效日期最早为明天");
        Integer v = jdbc.queryForObject("SELECT COALESCE(MAX(version), 0) + 1 FROM billing_rule", Integer.class);
        jdbc.update("INSERT INTO billing_rule (version, effective_from, service_unit_price, transfer_unit_price, supply_share, "
                        + "free_months, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)", v, Date.valueOf(req.effectiveFrom()),
                req.serviceUnitPrice(), req.transferUnitPrice(), req.supplyShare(), req.freeMonths(), CurrentUser.subjectId());
        audit.log("BILLING_RULE_ADD", "BILLING_RULE", String.valueOf(v), Map.of("effectiveFrom", req.effectiveFrom().toString(),
                "service", req.serviceUnitPrice(), "transfer", req.transferUnitPrice(), "supplyShare", req.supplyShare()));
        return ApiResponse.ok(v);
    }

    @Operation(summary = "存量基数与免费期（P-03）：免费期倒计时、锁定记录、在岗人数")
    @PreAuthorize("hasAnyRole('SUPER','FINANCE','OPERATOR')")
    @GetMapping("/stock-bases")
    public ApiResponse<List<Map<String, Object>>> stockBases(@RequestParam(required = false) String companyId) {
        LocalDate today = LocalDate.now(clock.withZone(Constants.ZONE));
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT c.company_id, c.name, c.company_status, c.onboard_date, c.free_period_end, "
                + "s.base_count, s.locked_at, s.locked_by, "
                + "(SELECT COUNT(*) FROM employment e WHERE e.company_id = c.company_id AND e.end_date IS NULL) AS active_count, "
                + "(SELECT COUNT(*) FROM employment e WHERE e.company_id = c.company_id AND e.is_stock = 1) AS stock_imported "
                + "FROM company c LEFT JOIN stock_base s ON s.company_id = c.company_id "
                + "WHERE c.onboard_date IS NOT NULL" + (companyId == null ? "" : " AND c.company_id = ?")
                + " ORDER BY c.free_period_end LIMIT 500", companyId == null ? new Object[0] : new Object[]{companyId});
        rows.forEach(r -> {
            Object end = r.get("free_period_end");
            if (end != null) {
                long left = ChronoUnit.DAYS.between(today, ((Date) end).toLocalDate());
                r.put("free_days_left", Math.max(0, left));
            }
        });
        return ApiResponse.ok(Rows.camel(rows));
    }

    @Operation(summary = "归属治理（P-08）：按手机号或用户 ID 查当前状态、来源 / 当前归属、状态迁移日志、报名与任职")
    @PreAuthorize("hasAnyRole('SUPER','OPERATOR','RISK')")
    @GetMapping("/attribution")
    public ApiResponse<Map<String, Object>> attribution(@RequestParam(required = false) String phone,
                                                        @RequestParam(required = false) String userId) {
        BizException.check(phone != null || userId != null, ErrorCode.SYS_BAD_REQUEST, "请输入手机号或用户 ID");
        List<Map<String, Object>> us = phone != null
                ? jdbc.queryForList("SELECT * FROM `user` WHERE phone_hash = ?", cipher.blindIndex(phone.trim()))
                : jdbc.queryForList("SELECT * FROM `user` WHERE user_id = ?", userId.trim());
        BizException.check(!us.isEmpty(), ErrorCode.SYS_NOT_FOUND, "未找到该用户");
        Map<String, Object> u = us.get(0);
        String uid = (String) u.get("user_id");
        Map<String, Object> out = new HashMap<>();
        out.put("userId", uid);
        out.put("phoneMasked", Masks.phone(cipher.decrypt((String) u.get("phone_enc"))));
        out.put("realNameMasked", u.get("real_name_enc") == null ? null : Masks.name(cipher.decrypt((String) u.get("real_name_enc"))));
        for (String k : List.of("user_status", "source_company_id", "bound_company_id", "last_release_reason", "kyc_status",
                "register_channel_type", "register_channel_code", "registered_at", "match_cycle_count", "blacklist_flag")) {
            out.put(Rows.camel(k), u.get(k));
        }
        out.put("statusLog", Rows.camel(jdbc.queryForList("SELECT event, from_status, to_status, bound_before, bound_after, release_reason, "
                + "actor_role, actor_id, actor_company_id, remark, created_at FROM user_status_log WHERE user_id = ? ORDER BY id DESC LIMIT 200", uid)));
        out.put("applications", Rows.camel(jdbc.queryForList("SELECT application_id, company_id, job_id, status, created_at, ended_at, end_reason "
                + "FROM application WHERE user_id = ? ORDER BY created_at DESC", uid)));
        out.put("employments", Rows.camel(jdbc.queryForList("SELECT employment_id, company_id, project_id, start_date, end_date, end_reason, "
                + "source_company_id_snapshot, is_transfer, origin FROM employment WHERE user_id = ? ORDER BY start_date DESC", uid)));
        audit.log("ATTRIBUTION_QUERY", "USER", uid, null);
        return ApiResponse.ok(out);
    }
}
