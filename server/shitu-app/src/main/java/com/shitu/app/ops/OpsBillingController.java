package com.shitu.app.ops;

import com.shitu.billing.service.DailyBillingService;
import com.shitu.billing.service.MonthlyBillService;
import com.shitu.common.api.ApiResponse;
import com.shitu.common.api.PageResult;
import com.shitu.common.enums.CompanyStatus;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.security.CurrentUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;

/** 平台中台：对账管理 P-10、计费重算、公司注销（归属治理 P-08）。 */
@Tag(name = "平台中台 · 计费与对账")
@RestController
@RequestMapping("/api/v1/ops")
public class OpsBillingController {

    public record ReplyRequest(@NotNull Boolean accept, @NotBlank(message = "请填写处理说明") String reply) {
    }

    public record CloseRequest(@NotNull CompanyStatus status, @NotBlank(message = "请填写说明") String remark) {
    }

    private final MonthlyBillService bills;
    private final DailyBillingService daily;
    private final CompanyClosureFacade closure;

    public OpsBillingController(MonthlyBillService bills, DailyBillingService daily, CompanyClosureFacade closure) {
        this.bills = bills;
        this.daily = daily;
        this.closure = closure;
    }

    @Operation(summary = "月账单列表")
    @PreAuthorize("hasAnyRole('SUPER','FINANCE')")
    @GetMapping("/bills")
    public ApiResponse<PageResult<MonthlyBillService.Bill>> list(@RequestParam(required = false) String companyId,
                                                               @RequestParam(required = false) String status,
                                                               @RequestParam(required = false) String month,
                                                               @RequestParam(defaultValue = "1") int page,
                                                               @RequestParam(defaultValue = "20") int pageSize) {
        return ApiResponse.ok(bills.list(companyId, status, month, page, pageSize));
    }

    @Operation(summary = "账单详情 + 每日明细 + 异议")
    @PreAuthorize("hasAnyRole('SUPER','FINANCE')")
    @GetMapping("/bills/{billId}")
    public ApiResponse<TenantBillDetail> detail(@PathVariable String billId) {
        MonthlyBillService.Bill b = bills.get(billId, null);
        return ApiResponse.ok(new TenantBillDetail(b, bills.days(b.companyId(), YearMonth.parse(b.billMonth())),
                bills.disputes(billId)));
    }

    public record TenantBillDetail(MonthlyBillService.Bill bill, List<MonthlyBillService.DayLine> days,
                                   List<MonthlyBillService.Dispute> disputes) {
    }

    @Operation(summary = "处理异议（接受 → 账单退回待修正；驳回 → 恢复已下发）")
    @PreAuthorize("hasAnyRole('SUPER','FINANCE')")
    @PostMapping("/disputes/{id}/reply")
    public ApiResponse<Void> reply(@PathVariable long id, @Valid @RequestBody ReplyRequest req) {
        bills.replyDispute(id, req.accept(), req.reply(), CurrentUser.subjectId());
        return ApiResponse.ok(null);
    }

    @Operation(summary = "登记结算")
    @PreAuthorize("hasAnyRole('SUPER','FINANCE')")
    @PostMapping("/bills/{billId}/settle")
    public ApiResponse<Void> settle(@PathVariable String billId) {
        bills.markSettled(billId, CurrentUser.subjectId());
        return ApiResponse.ok(null);
    }

    @Operation(summary = "重算某天的计费（幂等；所在月账单已下发则拒绝）")
    @PreAuthorize("hasAnyRole('SUPER','FINANCE')")
    @PostMapping("/billing/daily")
    public ApiResponse<DailyBillingService.DayResult> rerun(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return ApiResponse.ok(daily.run(date));
    }

    @Operation(summary = "生成并下发某月账单（通常由每月 1 日的定时任务执行）")
    @PreAuthorize("hasRole('SUPER')")
    @PostMapping("/billing/monthly")
    public ApiResponse<Integer> monthly(@RequestParam String month) {
        YearMonth m = YearMonth.parse(month);
        BizException.check(m.isBefore(YearMonth.now()), ErrorCode.SYS_BAD_REQUEST, "只能生成已结束月份的账单");
        bills.generate(m);
        return ApiResponse.ok(bills.issueAll(m));
    }

    @Operation(summary = "公司注销 / 倒闭（不可逆：批量解绑、岗位下架、成员停用）")
    @PreAuthorize("hasRole('SUPER')")
    @PostMapping("/companies/{companyId}/close")
    public ApiResponse<CompanyClosureFacade.Result> close(@PathVariable String companyId, @Valid @RequestBody CloseRequest req) {
        BizException.check(req.status().isClosed(), ErrorCode.SYS_BAD_REQUEST, "状态只能是已注销或已倒闭");
        return ApiResponse.ok(closure.close(companyId, req.status(), req.remark(), CurrentUser.subjectId()));
    }
}
