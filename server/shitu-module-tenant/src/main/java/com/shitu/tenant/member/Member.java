package com.shitu.tenant.member;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.shitu.common.enums.ActorRole;
import com.shitu.common.enums.MemberStatus;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.Set;
import java.util.stream.Collectors;

@Data
@TableName("member")
public class Member {

    /** 租户角色（A-19 矩阵的四列）。 */
    public static final Set<ActorRole> TENANT_ROLES = EnumSet.of(ActorRole.SITE, ActorRole.BROKER, ActorRole.PM, ActorRole.OWNER);

    @TableId(type = IdType.INPUT)
    private String memberId;
    private String companyId;
    private String name;
    private String phoneEnc;
    private String phoneHash;
    /** 逗号分隔：SITE / BROKER / PM / OWNER */
    private String roles;
    private MemberStatus status;
    private LocalDateTime lastLoginAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public Set<ActorRole> roleSet() {
        if (roles == null || roles.isBlank()) {
            return EnumSet.noneOf(ActorRole.class);
        }
        return Arrays.stream(roles.split(",")).map(String::trim).filter(s -> !s.isEmpty())
                .map(ActorRole::valueOf).collect(Collectors.toCollection(() -> EnumSet.noneOf(ActorRole.class)));
    }

    public static String joinRoles(Set<ActorRole> roles) {
        return EnumSet.copyOf(roles).stream().map(Enum::name).collect(Collectors.joining(","));
    }
}
