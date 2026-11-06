package com.shitu.app.support;

import com.shitu.common.enums.AuthDomain;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * refresh token Cookie（02-架构 §10）：HttpOnly、SameSite=Lax、路径限定 /api/v1/{域}/auth，
 * 三个账号域各自一个 Cookie，互不覆盖。生产环境 {@code shitu.auth.cookie-secure=true}。
 */
@Component
public class AuthCookies {

    public static final String REFRESH = "shitu_rt";
    public static final String CHANNEL = "shitu_ch";
    public static final String VISITOR = "shitu_vk";

    private final boolean secure;

    public AuthCookies(@Value("${shitu.auth.cookie-secure:false}") boolean secure) {
        this.secure = secure;
    }

    public void setRefresh(HttpServletResponse resp, AuthDomain domain, String token, Duration ttl) {
        add(resp, ResponseCookie.from(REFRESH, token).httpOnly(true).secure(secure).sameSite("Lax")
                .path(path(domain)).maxAge(ttl).build());
    }

    public void clearRefresh(HttpServletResponse resp, AuthDomain domain) {
        add(resp, ResponseCookie.from(REFRESH, "").httpOnly(true).secure(secure).sameSite("Lax")
                .path(path(domain)).maxAge(0).build());
    }

    public void set(HttpServletResponse resp, String name, String value, Duration ttl) {
        add(resp, ResponseCookie.from(name, value).httpOnly(true).secure(secure).sameSite("Lax").path("/").maxAge(ttl).build());
    }

    public void clear(HttpServletResponse resp, String name) {
        set(resp, name, "", Duration.ZERO);
    }

    public static String read(HttpServletRequest req, String name) {
        if (req.getCookies() == null) {
            return null;
        }
        for (Cookie c : req.getCookies()) {
            if (name.equals(c.getName()) && c.getValue() != null && !c.getValue().isBlank()) {
                return c.getValue();
            }
        }
        return null;
    }

    /** 依赖 Cookie 的接口必须带自定义头（跨站表单无法设置），防 CSRF。 */
    public static void requireXhr(HttpServletRequest req) {
        BizException.check(req.getHeader("X-Requested-With") != null, ErrorCode.SYS_FORBIDDEN);
    }

    private static String path(AuthDomain d) {
        return "/api/v1/" + d.audience() + "/auth";
    }

    private static void add(HttpServletResponse resp, ResponseCookie c) {
        resp.addHeader(HttpHeaders.SET_COOKIE, c.toString());
    }
}
