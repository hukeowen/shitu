package com.shitu.app.tenant;

import com.shitu.common.api.ApiResponse;
import com.shitu.common.exception.BizException;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.framework.security.CurrentUser;
import com.shitu.lifecycle.employment.OnboardingService;
import com.shitu.lifecycle.seeker.ApplicationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.function.Consumer;

/**
 * 驻场批量操作：一批人同一场面试时一次知悉、一次到厂确认。逐条调用单条操作的同一套业务逻辑（各自独立事务），
 * 某一条不满足条件只影响它自己，返回里逐条说明成功或失败原因。
 */
@Tag(name = "驻场端 · 批量操作")
@RestController
@RequestMapping("/api/v1/tenant/applications/batch")
public class TenantBatchController {

    private static final Logger log = LoggerFactory.getLogger(TenantBatchController.class);
    static final int MAX = 50;

    public record IdsRequest(@NotEmpty(message = "请选择报名") @Size(max = MAX, message = "一次最多处理 50 条") List<String> applicationIds) {
    }

    public record AcknowledgeRequest(@NotEmpty(message = "请选择报名") @Size(max = MAX, message = "一次最多处理 50 条") List<String> applicationIds,
                                     @NotNull(message = "请选择面试时间") LocalDateTime interviewAt,
                                     @NotBlank(message = "请填写面试地点") String address, String routeTips,
                                     List<String> documents, String contactName, String contactPhone) {
    }

    public record Item(String applicationId, boolean ok, String message) {
    }

    public record Result(int succeeded, int failed, List<Item> items) {
    }

    private final OnboardingService onboarding;
    private final ApplicationService applications;

    public TenantBatchController(OnboardingService onboarding, ApplicationService applications) {
        this.onboarding = onboarding;
        this.applications = applications;
    }

    @Operation(summary = "批量到厂确认（最多 50 条；逐条返回结果）")
    @PreAuthorize("hasAnyRole('SITE','PM')")
    @PostMapping("/arrive")
    public ApiResponse<Result> arrive(@Valid @RequestBody IdsRequest req) {
        AuthPrincipal p = CurrentUser.get();
        return ApiResponse.ok(each(req.applicationIds(), id -> onboarding.arrive(p, id)));
    }

    @Operation(summary = "批量知悉并推送同一场面试信息（最多 50 条；逐条返回结果）")
    @PreAuthorize("hasAnyRole('SITE','PM')")
    @PostMapping("/acknowledge")
    public ApiResponse<Result> acknowledge(@Valid @RequestBody AcknowledgeRequest req) {
        AuthPrincipal p = CurrentUser.get();
        ApplicationService.AcknowledgeCommand cmd = new ApplicationService.AcknowledgeCommand(req.interviewAt(), req.address(),
                req.routeTips(), req.documents(), req.contactName(), req.contactPhone());
        return ApiResponse.ok(each(req.applicationIds(), id -> applications.acknowledge(p, id, cmd)));
    }

    private static Result each(List<String> ids, Consumer<String> action) {
        List<Item> items = new ArrayList<>();
        int ok = 0;
        for (String id : new LinkedHashSet<>(ids)) {
            try {
                action.accept(id);
                items.add(new Item(id, true, null));
                ok++;
            } catch (BizException e) {
                items.add(new Item(id, false, e.getMessage()));
            } catch (RuntimeException e) {
                log.error("批量操作失败 applicationId={}", id, e);
                items.add(new Item(id, false, "处理失败，请单独重试"));
            }
        }
        return new Result(ok, items.size() - ok, items);
    }
}
