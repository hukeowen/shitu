package com.shitu.framework.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;

/** 每个请求一个 traceId：写入 MDC（日志）、响应头 X-Trace-Id、统一返回体。 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class TraceIdFilter extends OncePerRequestFilter {
    public static final String HEADER = "X-Trace-Id";
    public static final String MDC_KEY = "traceId";
    private static final Pattern SAFE = Pattern.compile("^[A-Za-z0-9-]{8,64}$");

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse resp, FilterChain chain)
            throws ServletException, IOException {
        String incoming = req.getHeader(HEADER);
        String traceId = incoming != null && SAFE.matcher(incoming).matches()
                ? incoming : UUID.randomUUID().toString().replace("-", "");
        MDC.put(MDC_KEY, traceId);
        resp.setHeader(HEADER, traceId);
        try {
            chain.doFilter(req, resp);
        } finally {
            MDC.remove(MDC_KEY);
        }
    }

    public static String current() {
        return MDC.get(MDC_KEY);
    }
}
