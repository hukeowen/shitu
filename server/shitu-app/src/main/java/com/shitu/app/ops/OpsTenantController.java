package com.shitu.app.ops;

import com.shitu.app.support.FileFacade;
import com.shitu.common.Constants;
import com.shitu.common.api.ApiResponse;
import com.shitu.common.api.PageResult;
import com.shitu.common.enums.ClientContractStatus;
import com.shitu.common.enums.CompanyStatus;
import com.shitu.common.enums.JobStatus;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.billing.domain.FreePeriod;
import com.shitu.framework.security.CurrentUser;
import com.shitu.job.JobService;
import com.shitu.tenant.client.ClientService;
import com.shitu.tenant.company.CompanyService;
import com.shitu.tenant.member.MemberService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.util.List;

/** 平台中台：公司管理与入驻审核 P-02、合作合同备案、岗位审核 P-04、待办统计。 */
@Tag(name = "平台中台 · 公司与岗位审核")
@RestController
@RequestMapping("/api/v1/ops")
@PreAuthorize("hasAnyRole('SUPER','OPERATOR')")
public class OpsTenantController {

    public record AuditRequest(String remark) {
    }

    public record StatusRequest(@NotNull CompanyStatus status, String remark) {
    }

    public record CompanyDetail(CompanyService.CompanyView company, List<MemberService.MemberView> members,
                                List<ClientService.ContractView> contracts) {
    }

    public record OpsJobDetail(JobService.JobView job, BigDecimal matchWeight, List<JobService.AuditRecord> audits,
                               List<ClientService.ContractView> contracts) {
    }

    public record Pending(long companies, long contracts, long jobs) {
    }

    private final CompanyService companies;
    private final MemberService members;
    private final ClientService clients;
    private final JobService jobs;
    private final FileFacade files;
    private final JdbcTemplate jdbc;
    private final Clock clock;

    public OpsTenantController(CompanyService companies, MemberService members, ClientService clients, JobService jobs,
                               FileFacade files, JdbcTemplate jdbc, Clock clock) {
        this.companies = companies;
        this.members = members;
        this.clients = clients;
        this.jobs = jobs;
        this.files = files;
        this.jdbc = jdbc;
        this.clock = clock;
    }

    @Operation(summary = "待办数量（入驻审核 / 合同备案 / 岗位审核）")
    @GetMapping("/pending")
    public ApiResponse<Pending> pending() {
        long contracts = clients.listForOps(ClientContractStatus.PENDING, null, 1, 1).total();
        return ApiResponse.ok(new Pending(companies.countByStatus().getOrDefault(CompanyStatus.PENDING_AUDIT, 0L),
                contracts, jobs.countByStatus(JobStatus.PENDING_AUDIT)));
    }

    // ------------------------------------------------------------------ 公司 P-02

    @Operation(summary = "公司列表")
    @GetMapping("/companies")
    public ApiResponse<PageResult<CompanyService.CompanyView>> companies(@RequestParam(required = false) CompanyStatus status,
                                                                       @RequestParam(required = false) String keyword,
                                                                       @RequestParam(required = false) Integer page,
                                                                       @RequestParam(required = false) Integer pageSize) {
        return ApiResponse.ok(companies.list(new CompanyService.OpsQuery(status, keyword, page, pageSize)));
    }

    @Operation(summary = "公司详情（含成员、合作合同）")
    @GetMapping("/companies/{companyId}")
    public ApiResponse<CompanyDetail> company(@PathVariable String companyId) {
        CompanyService.CompanyView c = companies.get(companyId, true);
        List<MemberService.MemberView> ms = com.shitu.framework.tenant.TenantContext.runAs(
                com.shitu.framework.tenant.TenantContext.Mode.TENANT, companyId, () -> members.list(null, null));
        List<ClientService.ContractView> cs = clients.listForOps(null, companyId, 1, 100).records();
        return ApiResponse.ok(new CompanyDetail(c, ms, cs));
    }

    @Operation(summary = "入驻审核通过（入驻日 = 今天，免费期按生效计费规则计算）")
    @PostMapping("/companies/{companyId}/approve")
    public ApiResponse<CompanyService.CompanyView> approve(@PathVariable String companyId, @RequestBody(required = false) AuditRequest req) {
        LocalDate today = LocalDate.now(clock.withZone(Constants.ZONE));
        Integer months = jdbc.query("SELECT free_months FROM billing_rule WHERE effective_from <= ? ORDER BY effective_from DESC LIMIT 1",
                rs -> rs.next() ? rs.getInt(1) : null, today);
        BizException.check(months != null, ErrorCode.BIL_RULE_MISSING);
        return ApiResponse.ok(companies.approve(companyId, today, FreePeriod.lastFreeDay(today, months),
                req == null ? null : req.remark(), CurrentUser.subjectId()));
    }

    @Operation(summary = "入驻审核驳回")
    @PostMapping("/companies/{companyId}/reject")
    public ApiResponse<CompanyService.CompanyView> reject(@PathVariable String companyId, @RequestBody AuditRequest req) {
        return ApiResponse.ok(companies.reject(companyId, req.remark(), CurrentUser.subjectId()));
    }

    @Operation(summary = "调整公司状态：正常 / 限流 / 封禁")
    @PostMapping("/companies/{companyId}/status")
    public ApiResponse<CompanyService.CompanyView> status(@PathVariable String companyId, @Valid @RequestBody StatusRequest req) {
        return ApiResponse.ok(companies.changeStatus(companyId, req.status(), req.remark(), CurrentUser.subjectId()));
    }

    // ------------------------------------------------------------------ 合作合同备案

    @Operation(summary = "合作合同列表")
    @GetMapping("/client-contracts")
    public ApiResponse<PageResult<ClientService.ContractView>> contracts(@RequestParam(required = false) ClientContractStatus status,
                                                                       @RequestParam(required = false) String companyId,
                                                                       @RequestParam(required = false) Integer page,
                                                                       @RequestParam(required = false) Integer pageSize) {
        return ApiResponse.ok(clients.listForOps(status, companyId, page, pageSize));
    }

    @Operation(summary = "合同备案通过")
    @PostMapping("/client-contracts/{contractId}/approve")
    public ApiResponse<ClientService.ContractView> approveContract(@PathVariable String contractId,
                                                                  @RequestBody(required = false) AuditRequest req) {
        return ApiResponse.ok(clients.audit(contractId, true, req == null ? null : req.remark(), CurrentUser.subjectId()));
    }

    @Operation(summary = "合同备案驳回")
    @PostMapping("/client-contracts/{contractId}/reject")
    public ApiResponse<ClientService.ContractView> rejectContract(@PathVariable String contractId, @RequestBody AuditRequest req) {
        return ApiResponse.ok(clients.audit(contractId, false, req.remark(), CurrentUser.subjectId()));
    }

    // ------------------------------------------------------------------ 岗位审核 P-04

    @Operation(summary = "岗位列表（默认按提交时间排队）")
    @GetMapping("/jobs")
    public ApiResponse<PageResult<JobService.JobView>> jobs(@RequestParam(required = false) JobStatus status,
                                                          @RequestParam(required = false) String companyId,
                                                          @RequestParam(required = false) String keyword,
                                                          @RequestParam(required = false) Integer page,
                                                          @RequestParam(required = false) Integer pageSize) {
        return ApiResponse.ok(jobs.listForOps(new JobService.JobQuery(status, null, keyword, companyId, page, pageSize)));
    }

    @Operation(summary = "岗位审核详情（含平台权重、审核记录、该公司与甲方的合同）")
    @GetMapping("/jobs/{jobId}")
    public ApiResponse<OpsJobDetail> job(@PathVariable String jobId) {
        JobService.JobView j = jobs.getForOps(jobId);
        List<ClientService.ContractView> cs = clients.listForOps(null, j.companyId(), 1, 100).records().stream()
                .filter(c -> c.clientId().equals(j.clientId())).toList();
        return ApiResponse.ok(new OpsJobDetail(j, jobs.matchWeightOf(jobId), jobs.auditTrail(jobId), cs));
    }

    @Operation(summary = "岗位审核通过（上架招聘）")
    @PostMapping("/jobs/{jobId}/approve")
    public ApiResponse<JobService.JobView> approveJob(@PathVariable String jobId, @RequestBody(required = false) AuditRequest req) {
        return ApiResponse.ok(jobs.approve(jobId, req == null ? null : req.remark(), CurrentUser.subjectId()));
    }

    @Operation(summary = "岗位审核驳回")
    @PostMapping("/jobs/{jobId}/reject")
    public ApiResponse<JobService.JobView> rejectJob(@PathVariable String jobId, @RequestBody AuditRequest req) {
        return ApiResponse.ok(jobs.reject(jobId, req.remark(), CurrentUser.subjectId()));
    }

    @Operation(summary = "强制下架")
    @PostMapping("/jobs/{jobId}/force-offline")
    public ApiResponse<JobService.JobView> forceOffline(@PathVariable String jobId, @RequestBody AuditRequest req) {
        return ApiResponse.ok(jobs.forceOffline(jobId, req.remark(), CurrentUser.subjectId()));
    }

    // ------------------------------------------------------------------ 文件

    @Operation(summary = "查看营业执照 / 合同等文件")
    @GetMapping("/files")
    public ResponseEntity<InputStreamResource> file(@RequestParam String key) {
        return files.viewForOps(key);
    }

}
