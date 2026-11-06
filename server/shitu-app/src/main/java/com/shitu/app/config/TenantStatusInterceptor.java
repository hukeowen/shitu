package com.shitu.app.config;

import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.security.CurrentUser;
import com.shitu.tenant.company.CompanyService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * 租户业务接口前置校验：公司必须处于正常 / 限流状态。审核中、被驳回、封禁的公司只能访问
 * 账号、公司资料、文件接口（看入驻进度、修改资料重新提交）。
 */
@Component
public class TenantStatusInterceptor implements HandlerInterceptor {

    private final CompanyService companies;

    public TenantStatusInterceptor(CompanyService companies) {
        this.companies = companies;
    }

    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse resp, Object handler) {
        CurrentUser.find().ifPresent(p -> {
            if (p.companyId() != null) {
                BizException.check(companies.isOperational(p.companyId()), ErrorCode.TEN_COMPANY_NOT_ACTIVE);
            }
        });
        return true;
    }
}
