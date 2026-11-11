package com.shitu.app.report;

import com.shitu.common.api.ApiResponse;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.framework.security.CurrentUser;
import com.shitu.tenant.scope.DataScope;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/** 看板与报表：项目经理看板 T-306、老板总览 T-401、渠道转化 T-402、运营总览 P-01。 */
@Tag(name = "看板与报表")
@RestController
public class ReportController {

    private final ReportService reports;
    private final DataScope scope;

    public ReportController(ReportService reports, DataScope scope) {
        this.reports = reports;
        this.scope = scope;
    }

    @Operation(summary = "项目经理 / 驻场看板（按负责项目）")
    @PreAuthorize("hasAnyRole('PM','SITE','OWNER')")
    @GetMapping("/api/v1/tenant/reports/board")
    public ApiResponse<Map<String, Object>> board() {
        AuthPrincipal p = CurrentUser.get();
        DataScope.Scope s = scope.of(p);
        if (!s.all() && s.projectIds().isEmpty()) {
            // 没有负责项目：返回全 0（不能把空项目列表当成「全公司」）
            Map<String, Object> zero = new java.util.LinkedHashMap<>();
            for (String k : List.of("pendingInterview", "pendingConfirm", "employed", "resignedThisMonth", "arrivedToday", "hiredThisMonth",
                    "recruitingJobs")) {
                zero.put(k, 0L);
            }
            return ApiResponse.ok(zero);
        }
        return ApiResponse.ok(reports.pmBoard(p.companyId(), s.all() ? List.of() : s.projectIds()));
    }

    @Operation(summary = "老板数据总览（仅聚合，不含个人明细）")
    @PreAuthorize("hasRole('OWNER')")
    @GetMapping("/api/v1/tenant/reports/overview")
    public ApiResponse<Map<String, Object>> overview() {
        return ApiResponse.ok(reports.ownerOverview(CurrentUser.companyId()));
    }

    @Operation(summary = "渠道转化报表：访问 → 注册 → 报名 → 入职")
    @PreAuthorize("hasAnyRole('OWNER','PM')")
    @GetMapping("/api/v1/tenant/reports/channels")
    public ApiResponse<List<Map<String, Object>>> channels() {
        return ApiResponse.ok(reports.channelFunnel(CurrentUser.companyId()));
    }

    @Operation(summary = "本月超时释放与获客损失（T-102）")
    @PreAuthorize("hasAnyRole('OWNER','PM','SITE')")
    @GetMapping("/api/v1/tenant/reports/timeouts")
    public ApiResponse<Map<String, Object>> timeouts() {
        return ApiResponse.ok(reports.timeoutReleases(CurrentUser.companyId()));
    }

    @Operation(summary = "答题漏斗（P-12）：打开 → 提交 → 匹配到岗位 → 报名")
    @PreAuthorize("hasAnyRole('SUPER','OPERATOR')")
    @GetMapping("/api/v1/ops/reports/quiz-funnel")
    public ApiResponse<Map<String, Object>> quizFunnel(@org.springframework.web.bind.annotation.RequestParam(defaultValue = "7") int days) {
        return ApiResponse.ok(reports.quizFunnel(Math.max(1, Math.min(days, 90))));
    }

    @Operation(summary = "运营总览（P-01）")
    @PreAuthorize("hasAnyRole('SUPER','OPERATOR','FINANCE','RISK')")
    @GetMapping("/api/v1/ops/reports/overview")
    public ApiResponse<Map<String, Object>> ops() {
        return ApiResponse.ok(reports.opsOverview());
    }
}
