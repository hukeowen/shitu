package com.shitu.framework.web;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/** 当前请求的客户端信息（IP / UA），用于审计、频控和告知书留痕。 */
public final class ClientInfo {

    private ClientInfo() {
    }

    public static HttpServletRequest request() {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes a) {
            return a.getRequest();
        }
        return null;
    }

    /**
     * 客户端 IP。生产环境在 SLB / Nginx 之后，取 X-Forwarded-For 第一个地址
     * （Nginx 必须用 {@code proxy_set_header X-Forwarded-For $remote_addr} 覆盖而不是追加，防止伪造）。
     */
    public static String ip() {
        HttpServletRequest r = request();
        if (r == null) {
            return null;
        }
        String xff = r.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            String first = xff.split(",")[0].trim();
            return first.length() > 45 ? first.substring(0, 45) : first;
        }
        return r.getRemoteAddr();
    }

    public static String userAgent() {
        HttpServletRequest r = request();
        if (r == null) {
            return null;
        }
        String ua = r.getHeader("User-Agent");
        return ua == null ? null : ua.length() > 255 ? ua.substring(0, 255) : ua;
    }
}
