package com.shitu.app.config;

import com.shitu.common.enums.AuthDomain;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.security.CurrentUser;
import com.shitu.platform.admin.OpsAdminService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * 平台账号首次登录 / 被重置密码后必须先改密（D-37）：改密前只能访问「当前账号」和「修改密码」，
 * 其他接口一律拒绝（不只靠前端拦截）。
 */
@Component
public class OpsPasswordInterceptor implements HandlerInterceptor {

    private final OpsAdminService admins;

    public OpsPasswordInterceptor(OpsAdminService admins) {
        this.admins = admins;
    }

    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse resp, Object handler) {
        CurrentUser.find().filter(p -> p.domain() == AuthDomain.OPS).ifPresent(p ->
                BizException.check(!admins.get(p.subjectId()).mustChangePassword(), ErrorCode.AUTH_PASSWORD_CHANGE_REQUIRED));
        return true;
    }
}
