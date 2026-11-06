package com.shitu.lifecycle.domain;

import com.shitu.common.enums.UserStatus;

import java.util.Objects;

/**
 * 状态机判断所需的最小用户视图。
 *
 * @param status           当前状态
 * @param sourceCompanyId  来源归属，永不为空（平台为 {@code PLATFORM}）；GUEST 尚未注册时为 null
 * @param boundCompanyId   当前归属，null = 公域
 */
public record UserSnapshot(UserStatus status, String sourceCompanyId, String boundCompanyId) {

    public UserSnapshot {
        Objects.requireNonNull(status, "status");
    }

    public static UserSnapshot guest() {
        return new UserSnapshot(UserStatus.GUEST, null, null);
    }

    public boolean isBound() {
        return boundCompanyId != null;
    }
}
