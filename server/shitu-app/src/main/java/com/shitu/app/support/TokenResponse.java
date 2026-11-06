package com.shitu.app.support;

/** 登录 / 刷新返回：access token 只放前端内存，refresh token 在 HttpOnly Cookie 里。 */
public record TokenResponse(String accessToken, long expiresIn) {
}
