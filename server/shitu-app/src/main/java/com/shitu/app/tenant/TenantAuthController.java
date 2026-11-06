package com.shitu.app.tenant;

import com.shitu.app.support.AuthCookies;
import com.shitu.app.support.FileFacade;
import com.shitu.app.support.TokenResponse;
import com.shitu.common.api.ApiResponse;
import com.shitu.common.enums.AuthDomain;
import com.shitu.common.exception.BizException;
import com.shitu.framework.kv.RateLimiter;
import com.shitu.identity.captcha.CaptchaService;
import com.shitu.identity.session.AuthSessionService;
import com.shitu.identity.session.AuthSessionService.TokenPair;
import com.shitu.identity.sms.SmsCodeService;
import com.shitu.tenant.company.CompanyService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.time.Duration;
import java.util.List;

@Tag(name = "公司后台 · 登录与入驻")
@RestController
public class TenantAuthController {

    public record SmsCodeRequest(@NotBlank(message = "请输入手机号") String phone, String captchaId, String captchaCode) {
    }

    public record LoginRequest(@NotBlank(message = "请输入手机号") String phone,
                               @NotBlank(message = "请输入验证码") @Pattern(regexp = "\\d{6}", message = "验证码为 6 位数字") String code) {
    }

    /** status = OK：已登录；NOT_MEMBER：该手机号未加入任何公司，可凭 onboardingTicket 申请入驻。 */
    public record LoginResponse(TenantAuthFacade.LoginStatus status, String accessToken, Long expiresIn,
                                String onboardingTicket, String phoneMasked) {
    }

    public record ApplyRequest(@NotBlank(message = "请填写公司全称") String name, String shortName,
                               @NotBlank(message = "请填写统一社会信用代码") String unifiedCreditCode,
                               String dispatchLicenseNo, List<String> licenseFiles,
                               @NotBlank(message = "请填写联系人") String contactName) {
        CompanyService.ApplyCommand toCommand() {
            return new CompanyService.ApplyCommand(name, shortName, unifiedCreditCode, dispatchLicenseNo, licenseFiles, contactName);
        }
    }

    private final CaptchaService captcha;
    private final SmsCodeService sms;
    private final TenantAuthFacade facade;
    private final AuthSessionService sessions;
    private final FileFacade files;
    private final RateLimiter limiter;
    private final AuthCookies cookies;

    public TenantAuthController(CaptchaService captcha, SmsCodeService sms, TenantAuthFacade facade,
                                AuthSessionService sessions, FileFacade files, RateLimiter limiter, AuthCookies cookies) {
        this.captcha = captcha;
        this.sms = sms;
        this.facade = facade;
        this.sessions = sessions;
        this.files = files;
        this.limiter = limiter;
        this.cookies = cookies;
    }

    @Operation(summary = "图形验证码")
    @GetMapping("/api/v1/tenant/auth/captcha")
    public ApiResponse<CaptchaService.Captcha> captcha() {
        return ApiResponse.ok(captcha.create());
    }

    @Operation(summary = "发送短信验证码")
    @PostMapping("/api/v1/tenant/auth/sms-code")
    public ApiResponse<SmsCodeService.SendResult> smsCode(@Valid @RequestBody SmsCodeRequest req) {
        return ApiResponse.ok(sms.send(AuthDomain.TENANT, req.phone().trim(), req.captchaId(), req.captchaCode()));
    }

    @Operation(summary = "短信验证码登录")
    @PostMapping("/api/v1/tenant/auth/sms-login")
    public ApiResponse<LoginResponse> login(@Valid @RequestBody LoginRequest req, HttpServletResponse resp) {
        TenantAuthFacade.LoginResult r = facade.login(req.phone().trim(), req.code());
        if (r.status() == TenantAuthFacade.LoginStatus.NOT_MEMBER) {
            return ApiResponse.ok(new LoginResponse(r.status(), null, null, r.onboardingTicket(), r.phoneMasked()));
        }
        cookies.setRefresh(resp, AuthDomain.TENANT, r.tokens().refreshToken(), r.tokens().refreshTtl());
        return ApiResponse.ok(new LoginResponse(r.status(), r.tokens().accessToken(), r.tokens().expiresIn(), null, null));
    }

    @Operation(summary = "刷新 access token")
    @PostMapping("/api/v1/tenant/auth/refresh")
    public ApiResponse<TokenResponse> refresh(HttpServletRequest http, HttpServletResponse resp) {
        AuthCookies.requireXhr(http);
        try {
            TokenPair t = facade.refresh(AuthCookies.read(http, AuthCookies.REFRESH));
            cookies.setRefresh(resp, AuthDomain.TENANT, t.refreshToken(), t.refreshTtl());
            return ApiResponse.ok(new TokenResponse(t.accessToken(), t.expiresIn()));
        } catch (BizException e) {
            cookies.clearRefresh(resp, AuthDomain.TENANT);
            throw e;
        }
    }

    @Operation(summary = "退出登录")
    @PostMapping("/api/v1/tenant/auth/logout")
    public ApiResponse<Void> logout(HttpServletRequest http, HttpServletResponse resp) {
        AuthCookies.requireXhr(http);
        sessions.logout(AuthDomain.TENANT, AuthCookies.read(http, AuthCookies.REFRESH));
        cookies.clearRefresh(resp, AuthDomain.TENANT);
        return ApiResponse.ok(null);
    }

    @Operation(summary = "入驻申请 · 上传营业执照 / 许可证（凭入驻票据）")
    @PostMapping("/api/v1/tenant/onboarding/files")
    public ApiResponse<FileFacade.Uploaded> uploadForOnboarding(@RequestHeader("X-Onboarding-Ticket") String ticket,
                                                               @RequestParam("file") MultipartFile file) {
        String phone = facade.phoneOfTicket(ticket);
        BizException.check(limiter.tryAcquire("onb:upload:" + ticket, 12, Duration.ofMinutes(30)),
                com.shitu.common.exception.ErrorCode.SYS_TOO_MANY_REQUESTS);
        return ApiResponse.ok(files.upload(file, "license", facade.ticketOwner(phone)));
    }

    @Operation(summary = "入驻申请 · 提交（成功后直接以老板身份登录，等待平台审核）")
    @PostMapping("/api/v1/tenant/onboarding/apply")
    public ApiResponse<TokenResponse> apply(@RequestHeader("X-Onboarding-Ticket") String ticket,
                                            @Valid @RequestBody ApplyRequest req, HttpServletResponse resp) {
        TokenPair t = facade.apply(ticket, req.toCommand());
        cookies.setRefresh(resp, AuthDomain.TENANT, t.refreshToken(), t.refreshTtl());
        return ApiResponse.ok(new TokenResponse(t.accessToken(), t.expiresIn()));
    }
}
