package com.shitu.app.tenant;

import com.shitu.common.api.ApiResponse;
import com.shitu.common.api.PageResult;
import com.shitu.common.enums.JobStatus;
import com.shitu.common.enums.JobType;
import com.shitu.common.enums.ShiftType;
import com.shitu.framework.security.CurrentUser;
import com.shitu.job.JobService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.util.List;

/** 岗位管理 T-302 / T-303（项目经理；其他角色只读）。 */
@Tag(name = "公司后台 · 岗位")
@RestController
@RequestMapping("/api/v1/tenant/jobs")
public class TenantJobController {

    public record JobRequest(String projectId, String title, JobType jobType, Boolean factoryJob,
                             BigDecimal salaryMin, BigDecimal salaryMax, ShiftType shiftType, Boolean dormProvided,
                             Integer dormRoomSize, Boolean dormAircon, Boolean dormPrivateBath, Boolean mealProvided,
                             Integer minWorkYears, Integer ageMin, Integer ageMax, String duties, String benefits,
                             List<String> requiredDocuments, String notes, String interviewAddress,
                             String interviewTimeDesc, Integer quotaTotal) {
        JobService.JobCommand toCommand() {
            return new JobService.JobCommand(projectId, title, jobType, factoryJob, salaryMin, salaryMax, shiftType,
                    dormProvided, dormRoomSize, dormAircon, dormPrivateBath, mealProvided, minWorkYears, ageMin, ageMax,
                    duties, benefits, requiredDocuments, notes, interviewAddress, interviewTimeDesc, quotaTotal);
        }
    }

    public record QuotaRequest(@NotNull @Min(value = 1, message = "名额至少 1 个") @Max(9999) Integer quotaTotal) {
    }

    private final JobService jobs;

    public TenantJobController(JobService jobs) {
        this.jobs = jobs;
    }

    @Operation(summary = "岗位列表（驻场 / 项目经理按负责项目过滤）")
    @GetMapping
    public ApiResponse<PageResult<JobService.JobView>> list(@RequestParam(required = false) JobStatus status,
                                                          @RequestParam(required = false) String projectId,
                                                          @RequestParam(required = false) String keyword,
                                                          @RequestParam(required = false) Integer page,
                                                          @RequestParam(required = false) Integer pageSize) {
        return ApiResponse.ok(jobs.list(CurrentUser.get(), new JobService.JobQuery(status, projectId, keyword, null, page, pageSize)));
    }

    @Operation(summary = "各状态岗位数（状态页签角标）")
    @GetMapping("/stats")
    public ApiResponse<java.util.Map<JobStatus, Long>> stats(@RequestParam(required = false) String projectId) {
        return ApiResponse.ok(jobs.stats(CurrentUser.get(), projectId));
    }

    @Operation(summary = "岗位详情")
    @GetMapping("/{jobId}")
    public ApiResponse<JobService.JobView> get(@PathVariable String jobId) {
        return ApiResponse.ok(jobs.get(CurrentUser.get(), jobId));
    }

    @Operation(summary = "岗位审核记录")
    @GetMapping("/{jobId}/audits")
    public ApiResponse<List<JobService.AuditRecord>> audits(@PathVariable String jobId) {
        jobs.get(CurrentUser.get(), jobId);
        return ApiResponse.ok(jobs.auditTrail(jobId));
    }

    @Operation(summary = "发布岗位（提交即进入平台审核）")
    @PreAuthorize("hasRole('PM')")
    @PostMapping
    public ApiResponse<JobService.JobView> create(@RequestBody JobRequest req) {
        return ApiResponse.ok(jobs.create(CurrentUser.get(), req.toCommand()));
    }

    @Operation(summary = "编辑岗位（重新进入审核，审核期间不参与匹配）")
    @PreAuthorize("hasRole('PM')")
    @PutMapping("/{jobId}")
    public ApiResponse<JobService.JobView> update(@PathVariable String jobId, @RequestBody JobRequest req) {
        return ApiResponse.ok(jobs.update(CurrentUser.get(), jobId, req.toCommand()));
    }

    @Operation(summary = "调整名额（不需要重新审核）")
    @PreAuthorize("hasRole('PM')")
    @PutMapping("/{jobId}/quota")
    public ApiResponse<JobService.JobView> quota(@PathVariable String jobId, @Valid @RequestBody QuotaRequest req) {
        return ApiResponse.ok(jobs.adjustQuota(CurrentUser.get(), jobId, req.quotaTotal()));
    }

    @Operation(summary = "暂停招聘（移出匹配池，数据保留）")
    @PreAuthorize("hasRole('PM')")
    @PostMapping("/{jobId}/pause")
    public ApiResponse<JobService.JobView> pause(@PathVariable String jobId) {
        return ApiResponse.ok(jobs.pause(CurrentUser.get(), jobId));
    }

    @Operation(summary = "恢复招聘（挂岗天数重新计算）")
    @PreAuthorize("hasRole('PM')")
    @PostMapping("/{jobId}/resume")
    public ApiResponse<JobService.JobView> resume(@PathVariable String jobId) {
        return ApiResponse.ok(jobs.resume(CurrentUser.get(), jobId));
    }

    @Operation(summary = "下架")
    @PreAuthorize("hasRole('PM')")
    @PostMapping("/{jobId}/offline")
    public ApiResponse<JobService.JobView> offline(@PathVariable String jobId) {
        return ApiResponse.ok(jobs.offline(CurrentUser.get(), jobId));
    }
}
