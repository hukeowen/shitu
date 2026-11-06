package com.shitu.framework.security;

import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Optional;

/** 读取当前登录主体。 */
public final class CurrentUser {

    private CurrentUser() {
    }

    public static Optional<AuthPrincipal> find() {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        if (a != null && a.getPrincipal() instanceof AuthPrincipal p) {
            return Optional.of(p);
        }
        return Optional.empty();
    }

    public static AuthPrincipal get() {
        return find().orElseThrow(() -> new BizException(ErrorCode.SYS_UNAUTHORIZED));
    }

    public static String subjectId() {
        return get().subjectId();
    }

    /** TENANT 域：当前公司。 */
    public static String companyId() {
        String c = get().companyId();
        if (c == null) {
            throw new BizException(ErrorCode.SYS_FORBIDDEN);
        }
        return c;
    }
}
