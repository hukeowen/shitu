package com.shitu.app.seeker;

import com.shitu.app.support.AuthCookies;
import com.shitu.app.support.TokenResponse;
import com.shitu.common.api.ApiResponse;
import com.shitu.common.enums.AuthDomain;
import com.shitu.common.exception.BizException;
import com.shitu.identity.captcha.CaptchaService;
import com.shitu.identity.session.AuthSessionService;
import com.shitu.identity.session.AuthSessionService.TokenPair;
import com.shitu.identity.sms.SmsCodeService;
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
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "C 端 · 登录注册")
@RestController
@RequestMapping("/api/v1/seeker/auth")
public class SeekerAuthController {

    public record SmsCodeRequest(@NotBlank(message = "请输入手机号") String phone, String captchaId, String captchaCode) {
    }

    public record LoginRequest(@NotBlank(message = "请输入手机号") String phone,
                               @NotBlank(message = "请输入验证码") @Pattern(regexp = "\\d{6}", message = "验证码为 6 位数字") String code,
                               String channelCode) {
    }

    public record LoginResponse(String accessToken, long expiresIn, boolean newUser, SeekerAuthFacade.SeekerProfile profile) {
    }

    private final CaptchaService captcha;
    private final SmsCodeService sms;
    private final SeekerAuthFacade facade;
    private final AuthSessionService sessions;
    private final AuthCookies cookies;

    public SeekerAuthController(CaptchaService captcha, SmsCodeService sms, SeekerAuthFacade facade,
                                AuthSessionService sessions, AuthCookies cookies) {
        this.captcha = captcha;
        this.sms = sms;
        this.facade = facade;
        this.sessions = sessions;
        this.cookies = cookies;
    }

    @Operation(summary = "图形验证码（发送短信被要求验证时使用）")
    @GetMapping("/captcha")
    public ApiResponse<CaptchaService.Captcha> captcha() {
        return ApiResponse.ok(captcha.create());
    }

    @Operation(summary = "发送短信验证码", description = "返回 AUTH_4004 时需先获取图形验证码再重试")
    @PostMapping("/sms-code")
    public ApiResponse<SmsCodeService.SendResult> smsCode(@Valid @RequestBody SmsCodeRequest req) {
        return ApiResponse.ok(sms.send(AuthDomain.SEEKER, req.phone().trim(), req.captchaId(), req.captchaCode()));
    }

    @Operation(summary = "短信验证码登录（未注册自动注册，按渠道码锁定归属）")
    @PostMapping("/sms-login")
    public ApiResponse<LoginResponse> login(@Valid @RequestBody LoginRequest req, HttpServletRequest http,
                                            HttpServletResponse resp) {
        String channel = req.channelCode() != null && !req.channelCode().isBlank()
                ? req.channelCode().trim() : AuthCookies.read(http, AuthCookies.CHANNEL);
        SeekerAuthFacade.LoginResult r = facade.login(req.phone().trim(), req.code(), channel,
                AuthCookies.read(http, AuthCookies.VISITOR));
        cookies.setRefresh(resp, AuthDomain.SEEKER, r.tokens().refreshToken(), r.tokens().refreshTtl());
        cookies.clear(resp, AuthCookies.CHANNEL);
        return ApiResponse.ok(new LoginResponse(r.tokens().accessToken(), r.tokens().expiresIn(), r.newUser(), r.profile()));
    }

    @Operation(summary = "刷新 access token（refresh token 在 HttpOnly Cookie，需带 X-Requested-With 头）")
    @PostMapping("/refresh")
    public ApiResponse<TokenResponse> refresh(HttpServletRequest http, HttpServletResponse resp) {
        AuthCookies.requireXhr(http);
        try {
            TokenPair t = facade.refresh(AuthCookies.read(http, AuthCookies.REFRESH));
            cookies.setRefresh(resp, AuthDomain.SEEKER, t.refreshToken(), t.refreshTtl());
            return ApiResponse.ok(new TokenResponse(t.accessToken(), t.expiresIn()));
        } catch (BizException e) {
            cookies.clearRefresh(resp, AuthDomain.SEEKER);
            throw e;
        }
    }

    @Operation(summary = "退出登录")
    @PostMapping("/logout")
    public ApiResponse<Void> logout(HttpServletRequest http, HttpServletResponse resp) {
        AuthCookies.requireXhr(http);
        sessions.logout(AuthDomain.SEEKER, AuthCookies.read(http, AuthCookies.REFRESH));
        cookies.clearRefresh(resp, AuthDomain.SEEKER);
        return ApiResponse.ok(null);
    }
}
