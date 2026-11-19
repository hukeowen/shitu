package com.shitu.app.seeker;

import com.shitu.app.tenant.CancelRequestService;
import com.shitu.common.api.ApiResponse;
import com.shitu.framework.security.CurrentUser;
import com.shitu.lifecycle.employment.ResignService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;

/** C 端自助申请：申请取消报名、申请离职。都只是提出申请，由驻场 / 项目经理处理（R-04 不变）。 */
@Tag(name = "C 端 · 自助申请")
@RestController
@RequestMapping("/api/v1/seeker")
public class SeekerRequestController {

    public record CancelRequest(@NotBlank(message = "请填写取消原因") String reason) {
    }

    public record ResignRequest(@NotNull(message = "请选择离职日期") LocalDate resignDate,
                                @NotBlank(message = "请填写离职原因") String reason) {
    }

    private final CancelRequestService cancelRequests;
    private final ResignService resign;

    public SeekerRequestController(CancelRequestService cancelRequests, ResignService resign) {
        this.cancelRequests = cancelRequests;
        this.resign = resign;
    }

    @Operation(summary = "这条报名最近的一次取消申请（没有返回空）")
    @GetMapping("/applications/{applicationId}/cancel-request")
    public ApiResponse<CancelRequestService.Mine> cancelRequest(@PathVariable String applicationId) {
        return ApiResponse.ok(cancelRequests.mine(CurrentUser.subjectId(), applicationId).orElse(null));
    }

    @Operation(summary = "申请取消报名（驻场 / 项目经理同意后才取消；同一条报名同时只能有一条待处理的申请）")
    @PostMapping("/applications/{applicationId}/cancel-request")
    public ApiResponse<CancelRequestService.Mine> requestCancel(@PathVariable String applicationId, @Valid @RequestBody CancelRequest req) {
        return ApiResponse.ok(cancelRequests.submit(CurrentUser.subjectId(), applicationId, req.reason()));
    }

    @Operation(summary = "我当前这份工作的离职申请（没有返回空）")
    @GetMapping("/resign-request")
    public ApiResponse<ResignService.MyResign> resignRequest() {
        return ApiResponse.ok(resign.mine(CurrentUser.subjectId()).orElse(null));
    }

    @Operation(summary = "申请离职（离职日期：今天到 30 天内；由项目经理审核）")
    @PostMapping("/resign-request")
    public ApiResponse<ResignService.MyResign> requestResign(@Valid @RequestBody ResignRequest req) {
        resign.requestBySeeker(CurrentUser.subjectId(), req.resignDate(), req.reason());
        return ApiResponse.ok(resign.mine(CurrentUser.subjectId()).orElse(null));
    }

    @Operation(summary = "撤回还没审核的离职申请")
    @PostMapping("/resign-request/withdraw")
    public ApiResponse<Void> withdrawResign() {
        resign.withdrawBySeeker(CurrentUser.subjectId());
        return ApiResponse.ok(null);
    }
}
