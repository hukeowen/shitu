package com.shitu.app.tenant;

import com.shitu.common.api.ApiResponse;
import com.shitu.common.enums.ActorRole;
import com.shitu.common.enums.AuthDomain;
import com.shitu.common.enums.MemberStatus;
import com.shitu.common.enums.ProjectStatus;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.framework.security.CurrentUser;
import com.shitu.identity.session.AuthSessionService;
import com.shitu.job.JobService;
import com.shitu.tenant.client.ClientService;
import com.shitu.tenant.member.MemberService;
import com.shitu.tenant.project.ProjectService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
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
import java.time.LocalDate;
import java.util.List;
import java.util.Set;

/** 组织与权限 T-502、项目 T-301、甲方与合作合同。 */
@Tag(name = "公司后台 · 组织、项目、甲方")
@RestController
@RequestMapping("/api/v1/tenant")
public class TenantOrgController {

    public record MemberRequest(@NotBlank(message = "请填写姓名") String name, String phone,
                                @NotEmpty(message = "请选择角色") Set<ActorRole> roles, List<String> projectIds) {
        MemberService.MemberCommand toCommand() {
            return new MemberService.MemberCommand(name, phone == null ? null : phone.trim(), roles, projectIds);
        }
    }

    public record StatusRequest(@NotNull MemberStatus status) {
    }

    public record ProjectRequest(@NotBlank(message = "请填写项目名称") String name,
                                 @NotBlank(message = "请选择甲方企业") String clientId, String contractId,
                                 String province, @NotBlank(message = "请选择城市") String city, String district,
                                 @NotBlank(message = "请填写厂区地址") String address, BigDecimal lng, BigDecimal lat) {
        ProjectService.ProjectCommand toCommand() {
            return new ProjectService.ProjectCommand(name, clientId, contractId, province, city, district, address, lng, lat);
        }
    }

    public record ClientRequest(@NotBlank(message = "请填写甲方企业全称") String name, String unifiedCreditCode, String city) {
    }

    public record ContractRequest(@NotBlank(message = "请选择甲方企业") String clientId,
                                  @NotBlank(message = "请上传合作合同") String fileKey,
                                  @NotNull(message = "请填写合同开始日期") LocalDate validFrom,
                                  @NotNull(message = "请填写合同结束日期") LocalDate validTo) {
    }

    private final MemberService members;
    private final ProjectService projects;
    private final ClientService clients;
    private final JobService jobs;
    private final AuthSessionService sessions;
    private final com.shitu.app.support.FileFacade files;

    public TenantOrgController(MemberService members, ProjectService projects, ClientService clients, JobService jobs,
                               AuthSessionService sessions, com.shitu.app.support.FileFacade files) {
        this.members = members;
        this.projects = projects;
        this.clients = clients;
        this.jobs = jobs;
        this.sessions = sessions;
        this.files = files;
    }

    // ------------------------------------------------------------------ 成员 T-502

    @Operation(summary = "成员列表")
    @PreAuthorize("hasAnyRole('OWNER','PM')")
    @GetMapping("/members")
    public ApiResponse<List<MemberService.MemberView>> members(@RequestParam(required = false) String keyword,
                                                               @RequestParam(required = false) ActorRole role) {
        return ApiResponse.ok(members.list(keyword, role));
    }

    @Operation(summary = "新增成员")
    @PreAuthorize("hasRole('OWNER')")
    @PostMapping("/members")
    public ApiResponse<MemberService.MemberView> createMember(@Valid @RequestBody MemberRequest req) {
        return ApiResponse.ok(members.create(CurrentUser.companyId(), req.toCommand()));
    }

    @Operation(summary = "修改成员角色 / 负责项目（角色变更后该成员需重新登录生效）")
    @PreAuthorize("hasRole('OWNER')")
    @PutMapping("/members/{memberId}")
    public ApiResponse<MemberService.MemberView> updateMember(@PathVariable String memberId,
                                                             @Valid @RequestBody MemberRequest req) {
        MemberService.MemberView before = members.get(memberId);
        MemberService.MemberView after = members.update(CurrentUser.companyId(), memberId, req.toCommand());
        if (!before.roles().equals(after.roles())) {
            // 角色写在 access token 里：吊销会话，强制按新角色重新登录
            sessions.revokeAll(AuthDomain.TENANT, memberId, "ROLE_CHANGED");
        }
        return ApiResponse.ok(after);
    }

    @Operation(summary = "停用 / 启用成员（停用立即吊销其登录会话）")
    @PreAuthorize("hasRole('OWNER')")
    @PostMapping("/members/{memberId}/status")
    public ApiResponse<MemberService.MemberView> memberStatus(@PathVariable String memberId,
                                                             @Valid @RequestBody StatusRequest req) {
        MemberService.MemberView v = members.setStatus(memberId, req.status(), CurrentUser.subjectId());
        if (req.status() == MemberStatus.DISABLED) {
            sessions.revokeAll(AuthDomain.TENANT, memberId, "ACCOUNT_DISABLED");
        }
        return ApiResponse.ok(v);
    }

    // ------------------------------------------------------------------ 项目 T-301

    @Operation(summary = "项目列表（驻场 / 项目经理只看自己负责的）")
    @GetMapping("/projects")
    public ApiResponse<List<ProjectService.ProjectView>> projects(@RequestParam(required = false) ProjectStatus status,
                                                                 @RequestParam(required = false) String keyword) {
        return ApiResponse.ok(projects.list(CurrentUser.get(), status, keyword));
    }

    @Operation(summary = "项目详情")
    @GetMapping("/projects/{projectId}")
    public ApiResponse<ProjectService.ProjectView> project(@PathVariable String projectId) {
        return ApiResponse.ok(projects.get(CurrentUser.get(), projectId));
    }

    @Operation(summary = "新建项目")
    @PreAuthorize("hasAnyRole('OWNER','PM')")
    @PostMapping("/projects")
    public ApiResponse<ProjectService.ProjectView> createProject(@Valid @RequestBody ProjectRequest req) {
        return ApiResponse.ok(projects.create(CurrentUser.get(), req.toCommand()));
    }

    @Operation(summary = "修改项目")
    @PreAuthorize("hasAnyRole('OWNER','PM')")
    @PutMapping("/projects/{projectId}")
    public ApiResponse<ProjectService.ProjectView> updateProject(@PathVariable String projectId,
                                                                @Valid @RequestBody ProjectRequest req) {
        return ApiResponse.ok(projects.update(CurrentUser.get(), projectId, req.toCommand()));
    }

    @Operation(summary = "结束项目（项目下不能有待审核 / 招聘中 / 暂停的岗位）")
    @PreAuthorize("hasAnyRole('OWNER','PM')")
    @PostMapping("/projects/{projectId}/close")
    public ApiResponse<ProjectService.ProjectView> closeProject(@PathVariable String projectId) {
        BizException.check(!jobs.hasLiveJobs(projectId), ErrorCode.TEN_ILLEGAL_STATUS, "请先下架项目下的岗位");
        return ApiResponse.ok(projects.close(CurrentUser.get(), projectId));
    }

    // ------------------------------------------------------------------ 甲方与合作合同

    @Operation(summary = "搜索甲方企业（全平台共享主数据）")
    @PreAuthorize("hasAnyRole('OWNER','PM')")
    @GetMapping("/clients")
    public ApiResponse<List<ClientService.ClientView>> clients(@RequestParam(required = false) String keyword) {
        return ApiResponse.ok(clients.search(keyword));
    }

    @Operation(summary = "新增甲方企业（同名已存在则直接返回）")
    @PreAuthorize("hasAnyRole('OWNER','PM')")
    @PostMapping("/clients")
    public ApiResponse<ClientService.ClientView> createClient(@Valid @RequestBody ClientRequest req) {
        return ApiResponse.ok(clients.createOrGet(req.name(), req.unifiedCreditCode(), req.city()));
    }

    @Operation(summary = "合作合同列表")
    @PreAuthorize("hasAnyRole('OWNER','PM')")
    @GetMapping("/client-contracts")
    public ApiResponse<List<ClientService.ContractView>> contracts(@RequestParam(required = false) String clientId) {
        return ApiResponse.ok(clients.listContracts(clientId));
    }

    @Operation(summary = "上传合作合同（提交平台备案审核，通过后才能在该甲方下发布岗位）")
    @PreAuthorize("hasAnyRole('OWNER','PM')")
    @PostMapping("/client-contracts")
    public ApiResponse<ClientService.ContractView> submitContract(@Valid @RequestBody ContractRequest req) {
        AuthPrincipal p = CurrentUser.get();
        files.checkOwned(List.of(req.fileKey()), p.companyId(), p.companyId());
        return ApiResponse.ok(clients.submitContract(p.companyId(),
                new ClientService.ContractCommand(req.clientId(), req.fileKey(), req.validFrom(), req.validTo())));
    }
}
