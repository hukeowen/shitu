package com.shitu.app.tenant;

import com.shitu.circulation.BrokerService;
import com.shitu.common.api.ApiResponse;
import com.shitu.framework.security.CurrentUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 人才经纪人流转池（T-201 ~ T-204）与驻场一键流转（M-09）。 */
@Tag(name = "公司后台 · 人才经纪人")
@RestController
@RequestMapping("/api/v1/tenant")
public class TenantBrokerController {

    public record RecommendRequest(@NotBlank(message = "请选择岗位") String jobId, String note) {
    }

    public record ReleaseRequest(@NotBlank(message = "请选择或填写释放原因") String reason) {
    }

    private final BrokerService brokers;

    public TenantBrokerController(BrokerService brokers) {
        this.brokers = brokers;
    }

    @Operation(summary = "流转池（默认未结工单，按 24h 截止时间排序）")
    @PreAuthorize("hasAnyRole('BROKER','SITE','PM')")
    @GetMapping("/broker/cases")
    public ApiResponse<List<BrokerService.CaseRow>> pool(@RequestParam(required = false) String status) {
        return ApiResponse.ok(brokers.pool(CurrentUser.get(), status));
    }

    @Operation(summary = "标记已联系（满足 2 小时联系时限）")
    @PreAuthorize("hasRole('BROKER')")
    @PostMapping("/broker/cases/{id}/contact")
    public ApiResponse<BrokerService.CaseRow> contact(@PathVariable long id) {
        return ApiResponse.ok(brokers.contact(CurrentUser.get(), id));
    }

    @Operation(summary = "生成 AI 分析报告（画像摘要 + 本公司 3 个推荐岗位）")
    @PreAuthorize("hasRole('BROKER')")
    @PostMapping("/broker/cases/{id}/report")
    public ApiResponse<BrokerService.Report> report(@PathVariable long id) {
        return ApiResponse.ok(brokers.generateReport(CurrentUser.get(), id));
    }

    @Operation(summary = "最近一份 AI 分析报告（没有返回空）")
    @PreAuthorize("hasAnyRole('BROKER','SITE','PM')")
    @GetMapping("/broker/cases/{id}/report")
    public ApiResponse<BrokerService.Report> latestReport(@PathVariable long id) {
        return ApiResponse.ok(brokers.latestReport(id).orElse(null));
    }

    @Operation(summary = "二次推荐岗位（用户在 C 端确认后走实名 + 告知书报名）")
    @PreAuthorize("hasRole('BROKER')")
    @PostMapping("/broker/cases/{id}/recommend")
    public ApiResponse<BrokerService.CaseRow> recommend(@PathVariable long id, @Valid @RequestBody RecommendRequest req) {
        return ApiResponse.ok(brokers.recommend(CurrentUser.get(), id, req.jobId(), req.note()));
    }

    @Operation(summary = "释放至公域（必填原因；bound 清空、source 保留；通知用户）")
    @PreAuthorize("hasAnyRole('BROKER','SITE')")
    @PostMapping("/broker/cases/{id}/release")
    public ApiResponse<Void> release(@PathVariable long id, @Valid @RequestBody ReleaseRequest req) {
        brokers.release(CurrentUser.get(), id, req.reason());
        return ApiResponse.ok(null);
    }

    @Operation(summary = "一键流转至人才经纪人（M-09，私域待匹配用户）")
    @PreAuthorize("hasAnyRole('SITE','PM')")
    @PostMapping("/seekers/{userId}/transfer-to-broker")
    public ApiResponse<Long> transfer(@PathVariable String userId) {
        return ApiResponse.ok(brokers.transferFromSite(CurrentUser.get(), userId));
    }
}
