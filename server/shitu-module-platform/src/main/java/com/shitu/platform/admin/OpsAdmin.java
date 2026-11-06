package com.shitu.platform.admin;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.shitu.common.enums.MemberStatus;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

@Data
@TableName("ops_admin")
public class OpsAdmin {

    @TableId(type = IdType.INPUT)
    private String adminId;
    private String username;
    private String passwordHash;
    private Boolean mustChangePassword;
    private String displayName;
    /** 逗号分隔：SUPER / OPERATOR / FINANCE / RISK */
    private String roles;
    private MemberStatus status;
    private LocalDateTime lastLoginAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public Set<String> roleSet() {
        if (roles == null || roles.isBlank()) {
            return Set.of();
        }
        return Arrays.stream(roles.split(",")).map(String::trim).filter(s -> !s.isEmpty()).collect(Collectors.toSet());
    }
}
