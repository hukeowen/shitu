package com.shitu.app.tenant;

import com.shitu.app.ops.BillCollectionService;
import com.shitu.app.support.FileFacade;
import com.shitu.billing.service.BillPaymentService;
import com.shitu.billing.service.MonthlyBillService;
import com.shitu.common.api.ApiResponse;
import com.shitu.common.api.PageResult;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.framework.security.CurrentUser;
import com.shitu.lifecycle.employment.ResignService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
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

/** 公司后台：费用账单 T-403 与流转账本 T-404（老板）、离职申请与审核 T-308。 */
@Tag(name = "公司后台 · 账单与离职")
@RestController
@RequestMapping("/api/v1/tenant")
public class TenantBillingController {

    public record DisputeRequest(@NotBlank(message = "请填写异议内容") String content) {
    }

    public record ResignRequest(@NotNull(message = "请选择离职日期") LocalDate resignDate, String reason) {
    }

    public record DecideRequest(@NotNull Boolean approve, String remark) {
    }

    public record BillDetail(MonthlyBillService.Bill bill, List<MonthlyBillService.DayLine> days,
                             List<MonthlyBillService.Dispute> disputes, List<BillPaymentService.Payment> payments,
                             BillCollectionService.Payee payee, com.shitu.app.ops.ReceivablePayoutService.Payout receivablePayout) {
    }

    public record PayeeRequest(@NotBlank(message = "请填写收款户名") String accountName, @NotBlank(message = "请填写开户行") String bankName,
                               @NotBlank(message = "请填写收款账号") String accountNo) {
    }

    public record PaymentRequest(@NotNull(message = "请填写付款金额") java.math.BigDecimal amount,
                                 @NotNull(message = "请选择付款日期") LocalDate paidDate,
                                 @NotBlank(message = "请填写付款户名") String payerName, String bankRef,
                                 @NotBlank(message = "请上传付款凭证") String voucherKey, String remark) {
    }

    private final MonthlyBillService bills;
    private final ResignService resign;

    @org.springframework.beans.factory.annotation.Autowired
    private BillPaymentService payments;
    @org.springframework.beans.factory.annotation.Autowired
    private BillCollectionService collection;
    @org.springframework.beans.factory.annotation.Autowired
    private FileFacade files;
    @org.springframework.beans.factory.annotation.Autowired
    private com.shitu.app.ops.ReceivablePayoutService receivables;

    public TenantBillingController(MonthlyBillService bills, ResignService resign) {
        this.bills = bills;
        this.resign = resign;
    }

    @Operation(summary = "费用账单（T-403，老板）")
    @PreAuthorize("hasRole('OWNER')")
    @GetMapping("/bills")
    public ApiResponse<PageResult<MonthlyBillService.Bill>> bills(@RequestParam(defaultValue = "1") int page,
                                                                @RequestParam(defaultValue = "12") int pageSize) {
        return ApiResponse.ok(bills.list(CurrentUser.companyId(), null, null, page, pageSize));
    }

    @Operation(summary = "账单详情：每日计费明细 + 异议记录")
    @PreAuthorize("hasRole('OWNER')")
    @GetMapping("/bills/{billId}")
    public ApiResponse<BillDetail> bill(@PathVariable String billId) {
        String cid = CurrentUser.companyId();
        MonthlyBillService.Bill b = bills.get(billId, cid);
        return ApiResponse.ok(new BillDetail(b, bills.days(cid, YearMonth.parse(b.billMonth())), bills.disputes(billId),
                payments.ofBill(billId), collection.payee(), receivables.ofBill(billId).orElse(null)));
    }

    @Operation(summary = "本公司收款账户（平台付流转分成时使用；没登记返回空）")
    @PreAuthorize("hasRole('OWNER')")
    @GetMapping("/payee")
    public ApiResponse<com.shitu.app.ops.ReceivablePayoutService.Payee> companyPayee() {
        return ApiResponse.ok(receivables.payee(CurrentUser.companyId()).orElse(null));
    }

    @Operation(summary = "登记 / 修改本公司收款账户")
    @PreAuthorize("hasRole('OWNER')")
    @org.springframework.web.bind.annotation.PutMapping("/payee")
    public ApiResponse<com.shitu.app.ops.ReceivablePayoutService.Payee> savePayee(@Valid @RequestBody PayeeRequest req) {
        AuthPrincipal p = CurrentUser.get();
        return ApiResponse.ok(receivables.savePayee(p.companyId(), req.accountName(), req.bankName(), req.accountNo(), p.subjectId()));
    }

    @Operation(summary = "提交付款凭证（一次付清，金额须等于应付；平台确认到账后账单结清）")
    @PreAuthorize("hasRole('OWNER')")
    @PostMapping("/bills/{billId}/payments")
    public ApiResponse<BillPaymentService.Payment> submitPayment(@PathVariable String billId, @Valid @RequestBody PaymentRequest req) {
        AuthPrincipal p = CurrentUser.get();
        files.checkOwned(List.of(req.voucherKey()), p.companyId(), p.companyId());
        return ApiResponse.ok(payments.submit(p.companyId(), billId, new BillPaymentService.SubmitCommand(req.amount(), req.paidDate(),
                req.payerName(), req.bankRef(), req.voucherKey(), req.remark()), p.subjectId()));
    }

    @Operation(summary = "提出账单异议（下发后 5 个工作日内）")
    @PreAuthorize("hasRole('OWNER')")
    @PostMapping("/bills/{billId}/disputes")
    public ApiResponse<MonthlyBillService.Dispute> dispute(@PathVariable String billId, @Valid @RequestBody DisputeRequest req) {
        AuthPrincipal p = CurrentUser.get();
        return ApiResponse.ok(bills.raiseDispute(p.companyId(), billId, req.content(), p.subjectId()));
    }

    @Operation(summary = "流转账本（T-404）：流入应付 / 流出应收，按人汇总")
    @PreAuthorize("hasRole('OWNER')")
    @GetMapping("/ledger")
    public ApiResponse<List<MonthlyBillService.LedgerLine>> ledger(@RequestParam String month) {
        return ApiResponse.ok(bills.ledger(CurrentUser.companyId(), YearMonth.parse(month)));
    }

    @org.springframework.beans.factory.annotation.Autowired
    private CirculationPeopleService circulationPeople;

    @Operation(summary = "流转人员台账：逐人的计费起止、日金额、本月与累计（与流转账本同权限）")
    @PreAuthorize("hasRole('OWNER')")
    @GetMapping("/ledger/people")
    public ApiResponse<List<CirculationPeopleService.PersonLine>> ledgerPeople() {
        return ApiResponse.ok(circulationPeople.people(CurrentUser.companyId()));
    }

    @Operation(summary = "发起离职（驻场 / 项目经理）")
    @PreAuthorize("hasAnyRole('SITE','PM')")
    @PostMapping("/employments/{employmentId}/resign")
    public ApiResponse<Long> requestResign(@PathVariable String employmentId, @Valid @RequestBody ResignRequest req) {
        return ApiResponse.ok(resign.request(CurrentUser.get(), employmentId, req.resignDate(), req.reason()));
    }

    @Operation(summary = "离职申请列表（T-308）")
    @PreAuthorize("hasAnyRole('SITE','PM')")
    @GetMapping("/resign-requests")
    public ApiResponse<List<ResignService.ResignRow>> resignRequests(@RequestParam(required = false) String status) {
        return ApiResponse.ok(resign.list(CurrentUser.get(), status));
    }

    @Operation(summary = "离职审核（仅项目经理；有预支欠款须先结清）")
    @PreAuthorize("hasRole('PM')")
    @PostMapping("/resign-requests/{id}/decide")
    public ApiResponse<Void> decide(@PathVariable long id, @Valid @RequestBody DecideRequest req) {
        resign.decide(CurrentUser.get(), id, req.approve(), req.remark());
        return ApiResponse.ok(null);
    }
}
