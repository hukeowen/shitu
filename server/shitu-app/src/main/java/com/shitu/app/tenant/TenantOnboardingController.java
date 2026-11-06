package com.shitu.app.tenant;

import com.shitu.common.api.ApiResponse;
import com.shitu.common.api.PageResult;
import com.shitu.framework.security.CurrentUser;
import com.shitu.lifecycle.employment.DutyAbsence;
import com.shitu.lifecycle.employment.EmploymentQueryService;
import com.shitu.lifecycle.employment.OnboardingService;
import com.shitu.lifecycle.seeker.ApplicationService;
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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;

/** 入职闭环（M-05 ~ M-10、M-15、T-103、T-307）。 */
@Tag(name = "驻场端 · 面试结果、确权签约、在岗管理")
@RestController
@RequestMapping("/api/v1/tenant")
public class TenantOnboardingController {

    public record ResultRequest(@NotNull Boolean pass, String remark) {
    }

    public record RemarkRequest(String remark) {
    }

    public record CancelRequest(@NotBlank(message = "请填写取消原因") String reason) {
    }

    public record ConfirmRequest(LocalDate startDate, String employeeNo, LocalDate termEnd) {
    }

    public record TransferRequest(@NotBlank(message = "请选择调入项目") String projectId, String jobId) {
    }

    /** type：LEAVE 请假 / ABSENT 旷工 / null 撤销 */
    public record AbsenceRequest(@NotNull(message = "请选择日期") LocalDate date, String type, String remark) {
    }

    private final OnboardingService onboarding;
    private final ApplicationService applications;
    private final EmploymentQueryService employments;

    public TenantOnboardingController(OnboardingService onboarding, ApplicationService applications,
                                      EmploymentQueryService employments) {
        this.onboarding = onboarding;
        this.applications = applications;
        this.employments = employments;
    }

    @Operation(summary = "到厂确认")
    @PreAuthorize("hasAnyRole('SITE','PM')")
    @PostMapping("/applications/{id}/arrive")
    public ApiResponse<ApplicationService.SiteApplication> arrive(@PathVariable String id) {
        onboarding.arrive(CurrentUser.get(), id);
        return ApiResponse.ok(applications.one(CurrentUser.get(), id));
    }

    @Operation(summary = "录入面试结果（通过 → 待确权；未通过须填原因，回到报名前归属，名额 +1）")
    @PreAuthorize("hasAnyRole('SITE','PM')")
    @PostMapping("/applications/{id}/result")
    public ApiResponse<Void> result(@PathVariable String id, @Valid @RequestBody ResultRequest req) {
        onboarding.interviewResult(CurrentUser.get(), id, req.pass(), req.remark());
        return ApiResponse.ok(null);
    }

    @Operation(summary = "标记爽约（仅驻场；当日释放至公域，名额 +1）")
    @PreAuthorize("hasRole('SITE')")
    @PostMapping("/applications/{id}/no-show")
    public ApiResponse<Void> noShow(@PathVariable String id, @RequestBody(required = false) RemarkRequest req) {
        onboarding.markNoShow(CurrentUser.get(), id, req == null ? null : req.remark());
        return ApiResponse.ok(null);
    }

    @Operation(summary = "后台取消报名（必填原因）")
    @PreAuthorize("hasAnyRole('SITE','PM')")
    @PostMapping("/applications/{id}/cancel")
    public ApiResponse<Void> cancel(@PathVariable String id, @Valid @RequestBody CancelRequest req) {
        onboarding.cancel(CurrentUser.get(), id, req.reason());
        return ApiResponse.ok(null);
    }

    @Operation(summary = "入职确权并发起电子签（已有待签合同时作废重发）")
    @PreAuthorize("hasAnyRole('SITE','PM')")
    @PostMapping("/applications/{id}/confirm")
    public ApiResponse<OnboardingService.ContractView> confirm(@PathVariable String id,
                                                              @RequestBody(required = false) ConfirmRequest req) {
        ConfirmRequest r = req == null ? new ConfirmRequest(null, null, null) : req;
        return ApiResponse.ok(onboarding.confirm(CurrentUser.get(), id,
                new OnboardingService.ConfirmCommand(r.startDate(), r.employeeNo(), r.termEnd())));
    }

    @Operation(summary = "人员管理（T-307；驻场 / 项目经理按负责项目；关键字支持工号或完整手机号）")
    @PreAuthorize("hasAnyRole('SITE','PM')")
    @GetMapping("/employments")
    public ApiResponse<PageResult<EmploymentQueryService.StaffRow>> staff(@RequestParam(required = false) Boolean active,
                                                                        @RequestParam(required = false) String projectId,
                                                                        @RequestParam(required = false) String keyword,
                                                                        @RequestParam(required = false) Integer page,
                                                                        @RequestParam(required = false) Integer pageSize) {
        return ApiResponse.ok(employments.staff(CurrentUser.get(), active, projectId, keyword, page, pageSize));
    }

    @Operation(summary = "内部调岗（仅项目经理；计费不中断）")
    @PreAuthorize("hasRole('PM')")
    @PostMapping("/employments/{id}/transfer")
    public ApiResponse<Void> transfer(@PathVariable String id, @Valid @RequestBody TransferRequest req) {
        onboarding.transfer(CurrentUser.get(), id, req.projectId(), req.jobId());
        return ApiResponse.ok(null);
    }

    @Operation(summary = "请假 / 旷工标记（M-15；type 为空表示撤销）")
    @PreAuthorize("hasAnyRole('SITE','PM')")
    @PutMapping("/employments/{id}/absences")
    public ApiResponse<Void> absence(@PathVariable String id, @Valid @RequestBody AbsenceRequest req) {
        onboarding.markAbsence(CurrentUser.get(), id, req.date(),
                req.type() == null || req.type().isBlank() ? null : req.type(), req.remark());
        return ApiResponse.ok(null);
    }

    @Operation(summary = "请假 / 旷工记录")
    @PreAuthorize("hasAnyRole('SITE','PM')")
    @GetMapping("/employments/{id}/absences")
    public ApiResponse<List<DutyAbsence>> absences(@PathVariable String id,
                                                   @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                                   @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return ApiResponse.ok(employments.absences(id, from, to));
    }
}
