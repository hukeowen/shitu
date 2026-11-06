package com.shitu.app.tenant;

import com.shitu.advance.service.AdvanceService;
import com.shitu.advance.service.PayrollService;
import com.shitu.common.api.ApiResponse;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.framework.security.CurrentUser;
import com.shitu.tenant.scope.DataScope;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.math.BigDecimal;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** 薪酬预支审批（M-11 驻场初审 / T-309 项目经理终审 / 登记拨款）与工资表导入（D-28）。 */
@Tag(name = "公司后台 · 薪酬预支与工资")
@RestController
@RequestMapping("/api/v1/tenant")
public class TenantAdvanceController {

    public record ReviewRequest(@NotNull Boolean approve, String opinion) {
    }

    private static final DataFormatter FMT = new DataFormatter();

    private final AdvanceService advances;
    private final PayrollService payroll;
    private final DataScope scope;

    public TenantAdvanceController(AdvanceService advances, PayrollService payroll, DataScope scope) {
        this.advances = advances;
        this.payroll = payroll;
        this.scope = scope;
    }

    @Operation(summary = "预支申请列表（驻场 / 项目经理按负责项目；老板全公司）")
    @PreAuthorize("hasAnyRole('SITE','PM','OWNER')")
    @GetMapping("/advances")
    public ApiResponse<List<AdvanceService.AdvanceRow>> list(@RequestParam(required = false) String status) {
        AuthPrincipal p = CurrentUser.get();
        DataScope.Scope s = scope.of(p);
        return ApiResponse.ok(advances.forTenant(p, s.projectIds(), s.all(), status));
    }

    @Operation(summary = "驻场初审（驳回须填原因，退回机会）")
    @PreAuthorize("hasRole('SITE')")
    @PostMapping("/advances/{id}/site-review")
    public ApiResponse<Void> siteReview(@PathVariable String id, @Valid @RequestBody ReviewRequest req) {
        advances.siteReview(CurrentUser.get(), id, req.approve(), req.opinion());
        return ApiResponse.ok(null);
    }

    @Operation(summary = "项目经理终审")
    @PreAuthorize("hasRole('PM')")
    @PostMapping("/advances/{id}/pm-review")
    public ApiResponse<Void> pmReview(@PathVariable String id, @Valid @RequestBody ReviewRequest req) {
        advances.pmReview(CurrentUser.get(), id, req.approve(), req.opinion());
        return ApiResponse.ok(null);
    }

    @Operation(summary = "登记拨款（线下转账完成后登记，记入欠款）")
    @PreAuthorize("hasAnyRole('PM','OWNER')")
    @PostMapping("/advances/{id}/payout")
    public ApiResponse<Void> payout(@PathVariable String id) {
        advances.payout(CurrentUser.get(), id);
        return ApiResponse.ok(null);
    }

    @Operation(summary = "导入工资表（.xlsx：手机号、工号、应发、社保、个税、其他扣款；自动抵扣预支欠款）")
    @PreAuthorize("hasAnyRole('PM','OWNER')")
    @PostMapping("/payroll/import")
    public ApiResponse<PayrollService.BatchResult> importPayroll(@RequestParam("file") MultipartFile file,
                                                                @RequestParam String month) throws IOException {
        BizException.check(file != null && !file.isEmpty() && file.getSize() <= 5L * 1024 * 1024, ErrorCode.TEN_FILE_INVALID,
                "请上传 5MB 以内的 .xlsx 文件");
        YearMonth m = YearMonth.parse(month);
        return ApiResponse.ok(payroll.importBatch(CurrentUser.get(), m, file.getOriginalFilename(), parse(file)));
    }

    @Operation(summary = "工资表批次")
    @PreAuthorize("hasAnyRole('PM','OWNER')")
    @GetMapping("/payroll/batches")
    public ApiResponse<List<Map<String, Object>>> batches() {
        return ApiResponse.ok(payroll.batches(CurrentUser.companyId()));
    }

    private static List<PayrollService.PayRow> parse(MultipartFile file) throws IOException {
        try (Workbook wb = WorkbookFactory.create(file.getInputStream())) {
            Sheet sh = wb.getSheetAt(0);
            List<PayrollService.PayRow> rows = new ArrayList<>();
            for (int i = 1; i <= sh.getLastRowNum(); i++) {
                Row r = sh.getRow(i);
                if (r == null || (cell(r, 0).isEmpty() && cell(r, 1).isEmpty())) {
                    continue;
                }
                rows.add(new PayrollService.PayRow(i + 1, cell(r, 0).replaceAll("\\.0$", ""), cell(r, 1), money(cell(r, 2)),
                        money(cell(r, 3)), money(cell(r, 4)), money(cell(r, 5))));
            }
            return rows;
        } catch (RuntimeException e) {
            throw new BizException(ErrorCode.SYS_BAD_REQUEST, "无法读取工资表，请检查格式（第一行为表头）");
        }
    }

    private static String cell(Row r, int c) {
        return r.getCell(c) == null ? "" : FMT.formatCellValue(r.getCell(c)).trim();
    }

    private static BigDecimal money(String s) {
        String v = s.replace(",", "").replace("¥", "").trim();
        return v.isEmpty() ? null : new BigDecimal(v);
    }
}
