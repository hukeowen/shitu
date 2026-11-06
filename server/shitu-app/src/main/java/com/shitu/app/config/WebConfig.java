package com.shitu.app.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final TenantStatusInterceptor tenantStatus;

    public WebConfig(TenantStatusInterceptor tenantStatus) {
        this.tenantStatus = tenantStatus;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(tenantStatus)
                .addPathPatterns("/api/v1/tenant/**")
                .excludePathPatterns("/api/v1/tenant/auth/**", "/api/v1/tenant/onboarding/**",
                        "/api/v1/tenant/me", "/api/v1/tenant/company", "/api/v1/tenant/company/**",
                        "/api/v1/tenant/files");
    }
}
