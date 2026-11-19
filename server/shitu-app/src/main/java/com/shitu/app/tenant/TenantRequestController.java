package com.shitu.app.tenant;

import com.shitu.common.api.ApiResponse;
import com.shitu.framework.security.CurrentUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 公司后台 / 驻场端：求职者提出的取消报名申请。 */
@Tag(name = "公司后台 · 求职者申请")
@RestController
@RequestMapping("/api/v1/tenant")
public class TenantRequestController {

    public record DecideRequest(@NotNull Boolean approve, String reply) {
    }

    private final CancelRequestService cancelRequests;

    public TenantRequestController(CancelRequestService cancelRequests) {
        this.cancelRequests = cancelRequests;
    }

    @Operation(summary = "取消报名申请列表（status=PENDING 只看待处理；只含自己负责的项目）")
    @PreAuthorize("hasAnyRole('SITE','PM')")
    @GetMapping("/cancel-requests")
    public ApiResponse<List<CancelRequestService.Row>> list(@RequestParam(required = false) String status) {
        return ApiResponse.ok(cancelRequests.list(CurrentUser.get(), status));
    }

    @Operation(summary = "待处理的取消报名申请数（角标）")
    @PreAuthorize("hasAnyRole('SITE','PM')")
    @GetMapping("/cancel-requests/pending-count")
    public ApiResponse<Long> pendingCount() {
        return ApiResponse.ok(cancelRequests.pendingCount(CurrentUser.get()));
    }

    @Operation(summary = "处理取消报名申请：同意（立即取消报名）或不同意（必须写说明）")
    @PreAuthorize("hasAnyRole('SITE','PM')")
    @PostMapping("/cancel-requests/{id}/decide")
    public ApiResponse<Void> decide(@PathVariable long id, @Valid @RequestBody DecideRequest req) {
        cancelRequests.decide(CurrentUser.get(), id, req.approve(), req.reply());
        return ApiResponse.ok(null);
    }
}
