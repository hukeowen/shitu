package com.shitu.app.tenant;

import com.shitu.common.enums.ActorRole;

import java.util.EnumMap;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * 角色 → 权限点（原型 A-19 矩阵，预支审批按 D-02 双级修正）。前端据此显示菜单和按钮；
 * 后端接口另用 {@code @PreAuthorize} 按角色校验，二者口径一致。
 */
public final class TenantPermissions {

    private static final Map<ActorRole, Set<String>> MATRIX = new EnumMap<>(ActorRole.class);

    static {
        MATRIX.put(ActorRole.SITE, Set.of("SITE_WORKBENCH", "PROFILE_VIEW", "AI_PROFILE_VIEW", "PHONE_FULL_VIEW",
                "ONBOARD_CONFIRM", "NO_SHOW_MARK", "APPLICATION_CANCEL", "TRANSFER_TO_BROKER", "RELEASE",
                "ADVANCE_FIRST_REVIEW", "PROJECT_VIEW", "CHANNEL_MINE"));
        MATRIX.put(ActorRole.BROKER, Set.of("BROKER_WORKBENCH", "PROFILE_VIEW", "AI_PROFILE_VIEW", "RELEASE",
                "PROJECT_VIEW", "JOB_VIEW", "CHANNEL_MINE"));
        MATRIX.put(ActorRole.PM, Set.of("PM_WORKBENCH", "PROFILE_VIEW", "ONBOARD_CONFIRM", "APPLICATION_CANCEL",
                "TRANSFER_TO_BROKER", "JOB_MANAGE", "JOB_VIEW", "KB_MANAGE", "RESIGN_AUDIT", "ADVANCE_FINAL_REVIEW",
                "PROJECT_MANAGE", "PROJECT_VIEW", "CLIENT_CONTRACT_MANAGE", "CHANNEL_MANAGE", "CHANNEL_MINE", "ROSTER_IMPORT",
                "STAFF_MANAGE"));
        MATRIX.put(ActorRole.OWNER, Set.of("OWNER_DASHBOARD", "BILL_VIEW", "ORG_MANAGE", "COMPANY_PROFILE",
                "PROJECT_MANAGE", "PROJECT_VIEW", "JOB_VIEW", "CLIENT_CONTRACT_MANAGE", "CHANNEL_MANAGE",
                "CHANNEL_MINE"));
    }

    private TenantPermissions() {
    }

    public static Set<String> of(Set<ActorRole> roles) {
        Set<String> s = new TreeSet<>();
        roles.forEach(r -> s.addAll(MATRIX.getOrDefault(r, Set.of())));
        return s;
    }
}
