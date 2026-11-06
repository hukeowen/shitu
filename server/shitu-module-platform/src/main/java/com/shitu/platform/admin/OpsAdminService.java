package com.shitu.platform.admin;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.shitu.common.api.PageResult;
import com.shitu.common.enums.AuthDomain;
import com.shitu.common.enums.MemberStatus;
import com.shitu.common.enums.OpsRole;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.id.BizIdGenerator;
import com.shitu.framework.kv.RateLimiter;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.framework.web.Pages;
import com.shitu.platform.mapper.OpsAdminMapper;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 平台运营账号（P-15）。与租户账号完全隔离：用户名 + 密码 + 图形验证码登录，连续错误 5 次锁定 15 分钟。
 */
@Service
public class OpsAdminService {

    private static final int MAX_FAILS = 5;
    private static final Duration LOCK = Duration.ofMinutes(15);

    public record AdminView(String adminId, String username, String displayName, Set<String> roles,
                            MemberStatus status, boolean mustChangePassword, LocalDateTime lastLoginAt,
                            LocalDateTime createdAt) {
        static AdminView of(OpsAdmin a) {
            return new AdminView(a.getAdminId(), a.getUsername(), a.getDisplayName(), a.roleSet(), a.getStatus(),
                    Boolean.TRUE.equals(a.getMustChangePassword()), a.getLastLoginAt(), a.getCreatedAt());
        }
    }

    public record Created(AdminView admin, String initialPassword) {
    }

    private final OpsAdminMapper mapper;
    private final PasswordEncoder encoder;
    private final RateLimiter limiter;
    private final BizIdGenerator ids;
    private final AuditLogger audit;
    private final Clock clock;

    public OpsAdminService(OpsAdminMapper mapper, PasswordEncoder encoder, RateLimiter limiter, BizIdGenerator ids,
                           AuditLogger audit, Clock clock) {
        this.mapper = mapper;
        this.encoder = encoder;
        this.limiter = limiter;
        this.ids = ids;
        this.audit = audit;
        this.clock = clock;
    }

    /** 校验用户名密码，成功返回主体（尚未建会话）。匿名调用，内部以 SYSTEM 模式访问。 */
    @Transactional(noRollbackFor = BizException.class)
    public AuthPrincipal authenticate(String username, String password) {
        String u = username == null ? "" : username.trim().toLowerCase();
        String failKey = "ops:fail:" + u;
        BizException.check(limiter.count(failKey) < MAX_FAILS, ErrorCode.AUTH_LOCKED);
        OpsAdmin a = TenantContext.runAsSystem(() ->
                mapper.selectOne(new LambdaQueryWrapper<OpsAdmin>().eq(OpsAdmin::getUsername, u)));
        if (a == null || password == null || !encoder.matches(password, a.getPasswordHash())) {
            limiter.tryAcquire(failKey, Integer.MAX_VALUE, LOCK);
            audit.logAs("OPS", a == null ? null : a.getAdminId(), null, "OPS_LOGIN_FAILED", "OPS_ADMIN", u, null);
            throw new BizException(ErrorCode.AUTH_PASSWORD_INVALID);
        }
        BizException.check(a.getStatus() == MemberStatus.NORMAL, ErrorCode.AUTH_ACCOUNT_DISABLED);
        limiter.reset(failKey);
        TenantContext.runAsSystem(() -> {
            OpsAdmin upd = new OpsAdmin();
            upd.setAdminId(a.getAdminId());
            upd.setLastLoginAt(LocalDateTime.now(clock));
            return mapper.updateById(upd);
        });
        audit.logAs("OPS", a.getAdminId(), null, "OPS_LOGIN", "OPS_ADMIN", a.getAdminId(), null);
        return principalOf(a);
    }

    /** 刷新会话时重新加载。 */
    public AuthPrincipal load(String adminId) {
        OpsAdmin a = TenantContext.runAsSystem(() -> mapper.selectById(adminId));
        BizException.check(a != null && a.getStatus() == MemberStatus.NORMAL, ErrorCode.AUTH_ACCOUNT_DISABLED);
        return principalOf(a);
    }

    public AdminView get(String adminId) {
        OpsAdmin a = TenantContext.runAsSystem(() -> mapper.selectById(adminId));
        BizException.check(a != null, ErrorCode.SYS_NOT_FOUND);
        return AdminView.of(a);
    }

    public PageResult<AdminView> list(String keyword, Integer page, Integer pageSize) {
        Page<OpsAdmin> p = mapper.selectPage(Pages.of(page, pageSize), new LambdaQueryWrapper<OpsAdmin>()
                .and(keyword != null && !keyword.isBlank(), w -> w.like(OpsAdmin::getUsername, keyword)
                        .or().like(OpsAdmin::getDisplayName, keyword))
                .orderByAsc(OpsAdmin::getCreatedAt));
        return Pages.map(p, AdminView::of);
    }

    @Transactional
    public Created create(String username, String displayName, Set<OpsRole> roles) {
        String u = normalizeUsername(username);
        BizException.check(roles != null && !roles.isEmpty(), ErrorCode.SYS_BAD_REQUEST, "至少选择一个角色");
        BizException.check(mapper.selectCount(new LambdaQueryWrapper<OpsAdmin>().eq(OpsAdmin::getUsername, u)) == 0,
                ErrorCode.PLT_USERNAME_TAKEN);
        String pwd = Passwords.random(12);
        OpsAdmin a = new OpsAdmin();
        a.setAdminId(ids.global("A", 1001));
        a.setUsername(u);
        a.setDisplayName(displayName.trim());
        a.setPasswordHash(encoder.encode(pwd));
        a.setMustChangePassword(true);
        a.setRoles(joinRoles(roles));
        a.setStatus(MemberStatus.NORMAL);
        a.setCreatedAt(LocalDateTime.now(clock));
        mapper.insert(a);
        audit.log("OPS_ADMIN_CREATE", "OPS_ADMIN", a.getAdminId(), Map.of("username", u, "roles", a.getRoles()));
        return new Created(AdminView.of(a), pwd);
    }

    @Transactional
    public AdminView update(String adminId, String displayName, Set<OpsRole> roles, String operatorId) {
        OpsAdmin a = mustGet(adminId);
        BizException.check(roles != null && !roles.isEmpty(), ErrorCode.SYS_BAD_REQUEST, "至少选择一个角色");
        if (a.roleSet().contains(OpsRole.SUPER.name()) && !roles.contains(OpsRole.SUPER)) {
            ensureAnotherSuper(adminId);
        }
        String before = a.getRoles();
        a.setDisplayName(displayName.trim());
        a.setRoles(joinRoles(roles));
        mapper.updateById(a);
        if (!before.equals(a.getRoles())) {
            audit.log("ROLE_CHANGE", "OPS_ADMIN", adminId, Map.of("before", before, "after", a.getRoles()));
        }
        return AdminView.of(a);
    }

    /** @return 是否需要吊销其会话（停用时） */
    @Transactional
    public AdminView setStatus(String adminId, MemberStatus status, String operatorId) {
        BizException.check(!adminId.equals(operatorId), ErrorCode.SYS_BAD_REQUEST, "不能停用自己的账号");
        OpsAdmin a = mustGet(adminId);
        if (status == MemberStatus.DISABLED && a.roleSet().contains(OpsRole.SUPER.name())) {
            ensureAnotherSuper(adminId);
        }
        a.setStatus(status);
        mapper.updateById(a);
        audit.log(status == MemberStatus.DISABLED ? "OPS_ADMIN_DISABLE" : "OPS_ADMIN_ENABLE", "OPS_ADMIN", adminId, null);
        return AdminView.of(a);
    }

    @Transactional
    public String resetPassword(String adminId) {
        OpsAdmin a = mustGet(adminId);
        String pwd = Passwords.random(12);
        a.setPasswordHash(encoder.encode(pwd));
        a.setMustChangePassword(true);
        mapper.updateById(a);
        audit.log("OPS_ADMIN_RESET_PASSWORD", "OPS_ADMIN", adminId, null);
        return pwd;
    }

    @Transactional
    public void changePassword(String adminId, String oldPassword, String newPassword) {
        OpsAdmin a = TenantContext.runAsSystem(() -> mapper.selectById(adminId));
        BizException.check(a != null, ErrorCode.SYS_NOT_FOUND);
        BizException.check(oldPassword != null && encoder.matches(oldPassword, a.getPasswordHash()), ErrorCode.AUTH_PASSWORD_INVALID, "原密码错误");
        Passwords.checkStrength(newPassword);
        BizException.check(!oldPassword.equals(newPassword), ErrorCode.SYS_BAD_REQUEST, "新密码不能与原密码相同");
        a.setPasswordHash(encoder.encode(newPassword));
        a.setMustChangePassword(false);
        TenantContext.runAsSystem(() -> mapper.updateById(a));
        audit.log("OPS_ADMIN_CHANGE_PASSWORD", "OPS_ADMIN", adminId, null);
    }

    /** 首次部署：没有任何平台账号时创建超级管理员。 */
    @Transactional
    public boolean bootstrapIfEmpty(String username, String password) {
        return TenantContext.runAsSystem(() -> {
            if (mapper.selectCount(null) > 0) {
                return false;
            }
            OpsAdmin a = new OpsAdmin();
            a.setAdminId(ids.global("A", 1001));
            a.setUsername(normalizeUsername(username));
            a.setDisplayName("超级管理员");
            a.setPasswordHash(encoder.encode(password));
            a.setMustChangePassword(true);
            a.setRoles(OpsRole.SUPER.name());
            a.setStatus(MemberStatus.NORMAL);
            a.setCreatedAt(LocalDateTime.now(clock));
            mapper.insert(a);
            audit.logAs("SYSTEM", null, null, "OPS_ADMIN_BOOTSTRAP", "OPS_ADMIN", a.getAdminId(), Map.of("username", a.getUsername()));
            return true;
        });
    }

    private OpsAdmin mustGet(String adminId) {
        OpsAdmin a = mapper.selectById(adminId);
        BizException.check(a != null, ErrorCode.SYS_NOT_FOUND);
        return a;
    }

    private void ensureAnotherSuper(String exceptId) {
        List<OpsAdmin> supers = mapper.selectList(new LambdaQueryWrapper<OpsAdmin>()
                .eq(OpsAdmin::getStatus, MemberStatus.NORMAL)
                .like(OpsAdmin::getRoles, OpsRole.SUPER.name())
                .ne(OpsAdmin::getAdminId, exceptId));
        BizException.check(!supers.isEmpty(), ErrorCode.PLT_LAST_SUPER);
    }

    private static AuthPrincipal principalOf(OpsAdmin a) {
        return new AuthPrincipal(AuthDomain.OPS, a.getAdminId(), null, a.roleSet(), null, a.getDisplayName());
    }

    private static String normalizeUsername(String username) {
        String u = username == null ? "" : username.trim().toLowerCase();
        BizException.check(u.matches("^[a-z0-9_.]{3,32}$"), ErrorCode.SYS_BAD_REQUEST, "用户名为 3–32 位字母、数字、下划线或点");
        return u;
    }

    private static String joinRoles(Set<OpsRole> roles) {
        return EnumSet.copyOf(roles).stream().map(Enum::name).collect(Collectors.joining(","));
    }
}
