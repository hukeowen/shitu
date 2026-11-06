package com.shitu.app.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final TenantStatusInterceptor tenantStatus;
    private final OpsPasswordInterceptor opsPassword;

    public WebConfig(TenantStatusInterceptor tenantStatus, OpsPasswordInterceptor opsPassword) {
        this.tenantStatus = tenantStatus;
        this.opsPassword = opsPassword;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(tenantStatus)
                .addPathPatterns("/api/v1/tenant/**")
                .excludePathPatterns("/api/v1/tenant/auth/**", "/api/v1/tenant/onboarding/**",
                        "/api/v1/tenant/me", "/api/v1/tenant/company", "/api/v1/tenant/company/**",
                        "/api/v1/tenant/files");
        registry.addInterceptor(opsPassword)
                .addPathPatterns("/api/v1/ops/**")
                .excludePathPatterns("/api/v1/ops/auth/**", "/api/v1/ops/me", "/api/v1/ops/me/password");
    }
}
