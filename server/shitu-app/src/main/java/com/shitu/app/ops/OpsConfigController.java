package com.shitu.app.ops;

import com.fasterxml.jackson.databind.JsonNode;
import com.shitu.common.api.ApiResponse;
import com.shitu.framework.security.CurrentUser;
import com.shitu.lifecycle.seeker.KycReviewService;
import com.shitu.matching.quiz.EngineAdminService;
import com.shitu.notify.TemplateAdminService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/** 平台中台配置：匹配引擎参数 P-13、实名复核与黑名单 P-14、通知模板 P-16。 */
@Tag(name = "平台中台 · 引擎参数 / 实名风控 / 通知模板")
@RestController
@RequestMapping("/api/v1/ops")
public class OpsConfigController {

    private final EngineAdminService engine;
    private final KycReviewService kyc;
    private final TemplateAdminService templates;

    public OpsConfigController(EngineAdminService engine, KycReviewService kyc, TemplateAdminService templates) {
        this.engine = engine;
        this.kyc = kyc;
        this.templates = templates;
    }

    // ------------------------------------------------------------------ P-13

    @Operation(summary = "引擎参数版本列表")
    @PreAuthorize("hasAnyRole('SUPER','OPERATOR')")
    @GetMapping("/engine/versions")
    public ApiResponse<List<EngineAdminService.EngineVersion>> engineVersions() {
        return ApiResponse.ok(engine.list());
    }

    @Operation(summary = "引擎参数版本详情")
    @PreAuthorize("hasAnyRole('SUPER','OPERATOR')")
    @GetMapping("/engine/versions/{versionId}")
    public ApiResponse<EngineAdminService.EngineVersion> engineVersion(@PathVariable int versionId) {
        return ApiResponse.ok(engine.get(versionId));
    }

    @Operation(summary = "新建草稿（body 为空则复制生效版本）")
    @PreAuthorize("hasAnyRole('SUPER','OPERATOR')")
    @PostMapping("/engine/drafts")
    public ApiResponse<EngineAdminService.EngineVersion> engineDraft(@RequestBody(required = false) JsonNode config) {
        return ApiResponse.ok(engine.createDraft(config, CurrentUser.subjectId()));
    }

    @Operation(summary = "修改草稿")
    @PreAuthorize("hasAnyRole('SUPER','OPERATOR')")
    @PutMapping("/engine/versions/{versionId}")
    public ApiResponse<EngineAdminService.EngineVersion> engineUpdate(@PathVariable int versionId, @RequestBody JsonNode config) {
        return ApiResponse.ok(engine.updateDraft(versionId, config));
    }

    @Operation(summary = "删除草稿")
    @PreAuthorize("hasAnyRole('SUPER','OPERATOR')")
    @DeleteMapping("/engine/versions/{versionId}")
    public ApiResponse<Void> engineDelete(@PathVariable int versionId) {
        engine.deleteDraft(versionId);
        return ApiResponse.ok(null);
    }

    @Operation(summary = "发布 / 回滚（仅超管）")
    @PreAuthorize("hasRole('SUPER')")
    @PostMapping("/engine/versions/{versionId}/publish")
    public ApiResponse<EngineAdminService.EngineVersion> enginePublish(@PathVariable int versionId) {
        return ApiResponse.ok(engine.publish(versionId, CurrentUser.subjectId()));
    }

    // ------------------------------------------------------------------ P-14

    public record DecideRequest(@NotNull Boolean approve, @NotBlank(message = "请填写处理意见") String remark) {
    }

    public record BlacklistRequest(@NotBlank String userId, @NotBlank(message = "请选择拉黑原因") String reasonCode,
                                   @NotBlank(message = "请填写事实说明") String detail) {
    }

    public record LiftRequest(@NotBlank(message = "请填写解除原因") String remark) {
    }

    @Operation(summary = "实名复核队列（身份证占用申诉 / 失信申诉）")
    @PreAuthorize("hasAnyRole('SUPER','RISK')")
    @GetMapping("/kyc-reviews")
    public ApiResponse<List<Map<String, Object>>> kycReviews(@RequestParam(required = false) String status,
                                                            @RequestParam(required = false) String type) {
        return ApiResponse.ok(kyc.queue(status, type));
    }

    @Operation(summary = "实名拦截记录（未成年 / 证件被占用 / 失信 / 核验不一致），最近 300 条")
    @PreAuthorize("hasAnyRole('SUPER','RISK')")
    @GetMapping("/kyc-records")
    public ApiResponse<List<Map<String, Object>>> kycRecords(@RequestParam(required = false) String result) {
        return ApiResponse.ok(kyc.interceptions(result));
    }

    @Operation(summary = "处理申诉")
    @PreAuthorize("hasAnyRole('SUPER','RISK')")
    @PostMapping("/kyc-reviews/{id}/decide")
    public ApiResponse<Void> kycDecide(@PathVariable long id, @Valid @RequestBody DecideRequest req) {
        kyc.decide(id, req.approve(), req.remark(), CurrentUser.subjectId());
        return ApiResponse.ok(null);
    }

    @Operation(summary = "平台黑名单")
    @PreAuthorize("hasAnyRole('SUPER','RISK')")
    @GetMapping("/blacklist")
    public ApiResponse<List<Map<String, Object>>> blacklist(@RequestParam(required = false) String status) {
        return ApiResponse.ok(kyc.blacklist(status));
    }

    @Operation(summary = "拉黑（对外只显示「平台级失信」，D-16）")
    @PreAuthorize("hasAnyRole('SUPER','RISK')")
    @PostMapping("/blacklist")
    public ApiResponse<Long> blacklistAdd(@Valid @RequestBody BlacklistRequest req) {
        return ApiResponse.ok(kyc.addBlacklist(req.userId(), req.reasonCode(), req.detail(), CurrentUser.subjectId()));
    }

    @Operation(summary = "解除黑名单")
    @PreAuthorize("hasAnyRole('SUPER','RISK')")
    @PostMapping("/blacklist/{id}/lift")
    public ApiResponse<Void> blacklistLift(@PathVariable long id, @Valid @RequestBody LiftRequest req) {
        kyc.lift(id, req.remark(), CurrentUser.subjectId());
        return ApiResponse.ok(null);
    }

    // ------------------------------------------------------------------ P-16

    @Operation(summary = "通知模板列表")
    @PreAuthorize("hasAnyRole('SUPER','OPERATOR')")
    @GetMapping("/notify-templates")
    public ApiResponse<List<TemplateAdminService.TemplateView>> templateList() {
        return ApiResponse.ok(templates.list());
    }

    @Operation(summary = "修改模板（文案只能使用模板已有变量）")
    @PreAuthorize("hasAnyRole('SUPER','OPERATOR')")
    @PutMapping("/notify-templates/{code}")
    public ApiResponse<TemplateAdminService.TemplateView> templateUpdate(@PathVariable String code,
                                                                       @RequestBody TemplateAdminService.TemplateUpdate req) {
        return ApiResponse.ok(templates.update(code, req, CurrentUser.subjectId()));
    }

    public record PreviewRequest(String title, String content) {
    }

    @Operation(summary = "模板预览（变量以示例值替换）")
    @PreAuthorize("hasAnyRole('SUPER','OPERATOR')")
    @PostMapping("/notify-templates/{code}/preview")
    public ApiResponse<Map<String, String>> templatePreview(@PathVariable String code, @RequestBody PreviewRequest req) {
        return ApiResponse.ok(templates.preview(code, req.title(), req.content()));
    }
}
