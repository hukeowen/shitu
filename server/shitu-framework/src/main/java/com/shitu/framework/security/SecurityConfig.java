package com.shitu.framework.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.shitu.common.api.ApiResponse;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.web.TraceIdFilter;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

import java.io.IOException;

/**
 * 三套账号域按 URL 前缀隔离（02-架构 §11.3）。
 * <p>CSRF：业务接口只认 Authorization 头里的 token；唯一依赖 Cookie 的刷新 / 登出接口额外校验
 * {@code X-Requested-With} 头，且 Cookie 为 SameSite=Lax、路径限定在 /api/v1/{域}/auth。
 */
@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    /** 匿名可访问：登录 / 验证码 / 刷新、入驻申请（票据校验）、C 端公开信息、渠道跳转、字典、健康检查、接口文档。 */
    static final String[] PUBLIC = {
            "/api/v1/seeker/auth/**", "/api/v1/tenant/auth/**", "/api/v1/ops/auth/**",
            "/api/v1/seeker/public/**", "/api/v1/tenant/onboarding/**",
            "/api/v1/dict", "/r/**", "/api/v1/callback/**",
            "/actuator/health/**", "/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html", "/error"
    };

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http, JwtService jwt, ObjectMapper json) throws Exception {
        http.csrf(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .requestCache(AbstractHttpConfigurer::disable)
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .headers(h -> h.frameOptions(f -> f.deny()))
                .authorizeHttpRequests(a -> a
                        .requestMatchers(PUBLIC).permitAll()
                        .requestMatchers("/api/v1/seeker/**").hasAuthority("AUD_seeker")
                        .requestMatchers("/api/v1/tenant/**").hasAuthority("AUD_tenant")
                        .requestMatchers("/api/v1/ops/**").hasAuthority("AUD_ops")
                        .anyRequest().denyAll())
                .exceptionHandling(e -> e
                        .authenticationEntryPoint((req, resp, ex) ->
                                write(resp, json, HttpServletResponse.SC_UNAUTHORIZED, ErrorCode.SYS_UNAUTHORIZED))
                        .accessDeniedHandler((req, resp, ex) ->
                                write(resp, json, HttpServletResponse.SC_FORBIDDEN, ErrorCode.SYS_FORBIDDEN)))
                .addFilterBefore(new JwtAuthenticationFilter(jwt), UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(10);
    }

    private static void write(HttpServletResponse resp, ObjectMapper json, int status, ErrorCode code) throws IOException {
        resp.setStatus(status);
        resp.setContentType(MediaType.APPLICATION_JSON_VALUE);
        resp.setCharacterEncoding("UTF-8");
        json.writeValue(resp.getOutputStream(), ApiResponse.fail(code, null, TraceIdFilter.current()));
    }
}
