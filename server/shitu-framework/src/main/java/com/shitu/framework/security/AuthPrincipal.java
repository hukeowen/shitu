package com.shitu.framework.security;

import com.shitu.common.enums.ActorRole;
import com.shitu.common.enums.AuthDomain;

import java.util.EnumSet;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 已登录主体（来自 access token）。
 *
 * @param domain    账号域
 * @param subjectId user_id / member_id / admin_id
 * @param companyId TENANT 域必填
 * @param roles     TENANT：SITE / BROKER / PM / OWNER；OPS：SUPER / OPERATOR / FINANCE / RISK；SEEKER：空
 * @param sessionId 会话 ID（登出 / 吊销用）
 * @param name      展示名
 */
public record AuthPrincipal(AuthDomain domain, String subjectId, String companyId, Set<String> roles,
                            String sessionId, String name) {

    public AuthPrincipal {
        roles = roles == null ? Set.of() : Set.copyOf(roles);
        if (domain == AuthDomain.TENANT && (companyId == null || companyId.isBlank())) {
            throw new IllegalArgumentException("tenant principal requires companyId");
        }
    }

    public boolean hasRole(String role) {
        return roles.contains(role);
    }

    public boolean hasAnyRole(String... rs) {
        for (String r : rs) {
            if (roles.contains(r)) {
                return true;
            }
        }
        return false;
    }

    /** 租户成员的角色（用于脱敏和状态机操作方）。 */
    public Set<ActorRole> actorRoles() {
        return switch (domain) {
            case SEEKER -> EnumSet.of(ActorRole.USER);
            case OPS -> EnumSet.of(ActorRole.OPS);
            case TENANT -> roles.stream()
                    .map(ActorRole::valueOf)
                    .collect(Collectors.toCollection(() -> EnumSet.noneOf(ActorRole.class)));
        };
    }

    public AuthPrincipal withSession(String sid) {
        return new AuthPrincipal(domain, subjectId, companyId, roles, sid, name);
    }
}
