package com.shitu.framework.security;

import com.shitu.framework.mask.ViewerContext;
import com.shitu.framework.tenant.TenantContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * 解析 Bearer token → SecurityContext、TenantContext、ViewerContext。请求结束时全部清除。
 * <p>权限：{@code AUD_seeker / AUD_tenant / AUD_ops}（账号域）+ {@code ROLE_xxx}（角色）。
 * 未带 token 或 token 无效时不设置任何上下文：受保护接口由 Spring Security 返回 401，
 * 匿名接口访问数据库必须显式 {@code TenantContext.runAsSystem}（fail-closed）。
 */
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtService jwt;

    public JwtAuthenticationFilter(JwtService jwt) {
        this.jwt = jwt;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse resp, FilterChain chain)
            throws ServletException, IOException {
        String h = req.getHeader("Authorization");
        try {
            if (h != null && h.startsWith("Bearer ")) {
                jwt.parse(h.substring(7).trim()).ifPresent(this::bind);
            }
            chain.doFilter(req, resp);
        } finally {
            SecurityContextHolder.clearContext();
            TenantContext.clear();
            ViewerContext.clear();
        }
    }

    private void bind(AuthPrincipal p) {
        List<SimpleGrantedAuthority> auths = new ArrayList<>();
        auths.add(new SimpleGrantedAuthority("AUD_" + p.domain().audience()));
        p.roles().forEach(r -> auths.add(new SimpleGrantedAuthority("ROLE_" + r)));
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(p, null, auths));
        switch (p.domain()) {
            case TENANT -> TenantContext.setTenant(p.companyId());
            case SEEKER -> TenantContext.set(TenantContext.Mode.SEEKER);
            case OPS -> TenantContext.set(TenantContext.Mode.OPS);
        }
        ViewerContext.set(p.actorRoles());
    }
}
