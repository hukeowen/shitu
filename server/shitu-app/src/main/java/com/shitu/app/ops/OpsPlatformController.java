package com.shitu.app.ops;

import com.shitu.common.api.ApiResponse;
import com.shitu.common.api.PageResult;
import com.shitu.common.enums.AuthDomain;
import com.shitu.common.enums.MemberStatus;
import com.shitu.common.enums.OpsRole;
import com.shitu.framework.security.CurrentUser;
import com.shitu.identity.session.AuthSessionService;
import com.shitu.platform.admin.OpsAdminService;
import com.shitu.platform.audit.AuditLogEntry;
import com.shitu.platform.audit.AuditQueryService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
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
import java.util.Set;

/** 平台账号与权限 P-15、审计日志 P-11。 */
@Tag(name = "平台中台 · 账号与审计")
@RestController
@RequestMapping("/api/v1/ops")
public class OpsPlatformController {

    public record CreateAdminRequest(@NotBlank(message = "请填写用户名") String username,
                                     @NotBlank(message = "请填写姓名") String displayName,
                                     @NotEmpty(message = "请选择角色") Set<OpsRole> roles) {
    }

    public record UpdateAdminRequest(@NotBlank(message = "请填写姓名") String displayName,
                                     @NotEmpty(message = "请选择角色") Set<OpsRole> roles) {
    }

    public record StatusRequest(@NotNull MemberStatus status) {
    }

    public record PasswordIssued(String initialPassword) {
    }

    private final OpsAdminService admins;
    private final AuditQueryService auditQuery;
    private final AuthSessionService sessions;

    public OpsPlatformController(OpsAdminService admins, AuditQueryService auditQuery, AuthSessionService sessions) {
        this.admins = admins;
        this.auditQuery = auditQuery;
        this.sessions = sessions;
    }

    @Operation(summary = "平台账号列表")
    @PreAuthorize("hasRole('SUPER')")
    @GetMapping("/admins")
    public ApiResponse<PageResult<OpsAdminService.AdminView>> admins(@RequestParam(required = false) String keyword,
                                                                   @RequestParam(required = false) Integer page,
                                                                   @RequestParam(required = false) Integer pageSize) {
        return ApiResponse.ok(admins.list(keyword, page, pageSize));
    }

    @Operation(summary = "新建平台账号（返回一次性初始密码，首次登录须修改）")
    @PreAuthorize("hasRole('SUPER')")
    @PostMapping("/admins")
    public ApiResponse<OpsAdminService.Created> create(@Valid @RequestBody CreateAdminRequest req) {
        return ApiResponse.ok(admins.create(req.username(), req.displayName(), req.roles()));
    }

    @Operation(summary = "修改姓名 / 角色（角色变更后该账号需重新登录）")
    @PreAuthorize("hasRole('SUPER')")
    @PutMapping("/admins/{adminId}")
    public ApiResponse<OpsAdminService.AdminView> update(@PathVariable String adminId, @Valid @RequestBody UpdateAdminRequest req) {
        Set<String> before = admins.get(adminId).roles();
        OpsAdminService.AdminView v = admins.update(adminId, req.displayName(), req.roles(), CurrentUser.subjectId());
        if (!before.equals(v.roles())) {
            sessions.revokeAll(AuthDomain.OPS, adminId, "ROLE_CHANGED");
        }
        return ApiResponse.ok(v);
    }

    @Operation(summary = "停用 / 启用")
    @PreAuthorize("hasRole('SUPER')")
    @PostMapping("/admins/{adminId}/status")
    public ApiResponse<OpsAdminService.AdminView> status(@PathVariable String adminId, @Valid @RequestBody StatusRequest req) {
        OpsAdminService.AdminView v = admins.setStatus(adminId, req.status(), CurrentUser.subjectId());
        if (req.status() == MemberStatus.DISABLED) {
            sessions.revokeAll(AuthDomain.OPS, adminId, "ACCOUNT_DISABLED");
        }
        return ApiResponse.ok(v);
    }

    @Operation(summary = "重置密码（返回一次性新密码）")
    @PreAuthorize("hasRole('SUPER')")
    @PostMapping("/admins/{adminId}/reset-password")
    public ApiResponse<PasswordIssued> resetPassword(@PathVariable String adminId) {
        String pwd = admins.resetPassword(adminId);
        sessions.revokeAll(AuthDomain.OPS, adminId, "PASSWORD_CHANGED");
        return ApiResponse.ok(new PasswordIssued(pwd));
    }

    @Operation(summary = "审计日志")
    @PreAuthorize("hasAnyRole('SUPER','RISK')")
    @GetMapping("/audit-logs")
    public ApiResponse<PageResult<AuditLogEntry>> auditLogs(@RequestParam(required = false) String actorDomain,
                                                           @RequestParam(required = false) String actorId,
                                                           @RequestParam(required = false) String companyId,
                                                           @RequestParam(required = false) String action,
                                                           @RequestParam(required = false) String targetType,
                                                           @RequestParam(required = false) String targetId,
                                                           @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                                           @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                                           @RequestParam(required = false) Integer page,
                                                           @RequestParam(required = false) Integer pageSize) {
        return ApiResponse.ok(auditQuery.query(new AuditQueryService.Query(actorDomain, actorId, companyId, action,
                targetType, targetId, from, to, page, pageSize)));
    }
}
