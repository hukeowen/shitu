package com.shitu.app.ops;

import com.shitu.app.support.AuthCookies;
import com.shitu.app.support.TokenResponse;
import com.shitu.common.api.ApiResponse;
import com.shitu.common.enums.AuthDomain;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.security.CurrentUser;
import com.shitu.identity.captcha.CaptchaService;
import com.shitu.identity.session.AuthSessionService;
import com.shitu.identity.session.AuthSessionService.TokenPair;
import com.shitu.platform.admin.OpsAdminService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** 平台中台登录：用户名 + 密码 + 图形验证码。 */
@Tag(name = "平台中台 · 登录")
@RestController
public class OpsAuthController {

    public record LoginRequest(@NotBlank(message = "请输入用户名") String username,
                               @NotBlank(message = "请输入密码") String password,
                               @NotBlank(message = "请输入图形验证码") String captchaId,
                               @NotBlank(message = "请输入图形验证码") String captchaCode) {
    }

    public record LoginResponse(String accessToken, long expiresIn, boolean mustChangePassword) {
    }

    public record PasswordRequest(@NotBlank String oldPassword, @NotBlank String newPassword) {
    }

    private final CaptchaService captcha;
    private final OpsAdminService admins;
    private final AuthSessionService sessions;
    private final AuthCookies cookies;

    public OpsAuthController(CaptchaService captcha, OpsAdminService admins, AuthSessionService sessions, AuthCookies cookies) {
        this.captcha = captcha;
        this.admins = admins;
        this.sessions = sessions;
        this.cookies = cookies;
    }

    @Operation(summary = "图形验证码")
    @GetMapping("/api/v1/ops/auth/captcha")
    public ApiResponse<CaptchaService.Captcha> captcha() {
        return ApiResponse.ok(captcha.create());
    }

    @Operation(summary = "登录（连续 5 次密码错误锁定 15 分钟）")
    @PostMapping("/api/v1/ops/auth/login")
    public ApiResponse<LoginResponse> login(@Valid @RequestBody LoginRequest req, HttpServletResponse resp) {
        BizException.check(captcha.verify(req.captchaId(), req.captchaCode()), ErrorCode.AUTH_CAPTCHA_INVALID);
        TokenPair t = sessions.open(admins.authenticate(req.username(), req.password()));
        cookies.setRefresh(resp, AuthDomain.OPS, t.refreshToken(), t.refreshTtl());
        boolean mustChange = admins.get(t.principal().subjectId()).mustChangePassword();
        return ApiResponse.ok(new LoginResponse(t.accessToken(), t.expiresIn(), mustChange));
    }

    @Operation(summary = "刷新 access token")
    @PostMapping("/api/v1/ops/auth/refresh")
    public ApiResponse<TokenResponse> refresh(HttpServletRequest http, HttpServletResponse resp) {
        AuthCookies.requireXhr(http);
        try {
            TokenPair t = sessions.refresh(AuthDomain.OPS, AuthCookies.read(http, AuthCookies.REFRESH),
                    (adminId, companyId) -> admins.load(adminId));
            cookies.setRefresh(resp, AuthDomain.OPS, t.refreshToken(), t.refreshTtl());
            return ApiResponse.ok(new TokenResponse(t.accessToken(), t.expiresIn()));
        } catch (BizException e) {
            cookies.clearRefresh(resp, AuthDomain.OPS);
            throw e;
        }
    }

    @Operation(summary = "退出登录")
    @PostMapping("/api/v1/ops/auth/logout")
    public ApiResponse<Void> logout(HttpServletRequest http, HttpServletResponse resp) {
        AuthCookies.requireXhr(http);
        sessions.logout(AuthDomain.OPS, AuthCookies.read(http, AuthCookies.REFRESH));
        cookies.clearRefresh(resp, AuthDomain.OPS);
        return ApiResponse.ok(null);
    }

    @Operation(summary = "当前账号")
    @GetMapping("/api/v1/ops/me")
    public ApiResponse<OpsAdminService.AdminView> me() {
        return ApiResponse.ok(admins.get(CurrentUser.subjectId()));
    }

    @Operation(summary = "修改密码（成功后其他设备需重新登录）")
    @PutMapping("/api/v1/ops/me/password")
    public ApiResponse<Void> changePassword(@Valid @RequestBody PasswordRequest req) {
        String id = CurrentUser.subjectId();
        admins.changePassword(id, req.oldPassword(), req.newPassword());
        sessions.revokeAll(AuthDomain.OPS, id, "PASSWORD_CHANGED");
        return ApiResponse.ok(null);
    }
}
