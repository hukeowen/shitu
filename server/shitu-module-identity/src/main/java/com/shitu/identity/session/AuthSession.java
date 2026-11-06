package com.shitu.identity.session;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.shitu.common.enums.AuthDomain;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("auth_session")
public class AuthSession {

    @TableId(type = IdType.INPUT)
    private String sessionId;
    private AuthDomain domain;
    private String subjectId;
    private String companyId;
    private String refreshHash;
    private String prevRefreshHash;
    private LocalDateTime rotatedAt;
    private String status;
    private String revokeReason;
    private LocalDateTime expiresAt;
    private String ip;
    private String userAgent;
    private LocalDateTime createdAt;
    private LocalDateTime lastUsedAt;
}
