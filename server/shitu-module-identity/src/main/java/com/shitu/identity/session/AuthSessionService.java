package com.shitu.identity.session;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.shitu.common.enums.AuthDomain;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.id.BizIdGenerator;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.framework.security.JwtService;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.framework.web.ClientInfo;
import com.shitu.identity.mapper.AuthSessionMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.HexFormat;

/**
 * 登录会话与 refresh token 轮换（02-架构 §10）。
 * <ul>
 *   <li>refresh token 为 32 字节随机数，只存 SHA-256；每次刷新都换新 token（轮换）；</li>
 *   <li>旧 token 在 {@code reuse-grace} 内再次出现视为多标签页并发刷新，正常再轮换一次；超出宽限期视为被盗用，吊销整个会话；</li>
 *   <li>刷新时通过 {@link PrincipalLoader} 重新加载账号（状态、角色、公司），停用的账号无法续期。</li>
 * </ul>
 * {@code auth_session} 是平台专属表，所有访问在 SYSTEM 模式下执行。
 */
@Service
public class AuthSessionService {

    private static final Logger log = LoggerFactory.getLogger(AuthSessionService.class);
    private static final String ACTIVE = "ACTIVE";
    private static final String REVOKED = "REVOKED";

    public record TokenPair(String accessToken, long expiresIn, String refreshToken, Duration refreshTtl,
                            AuthPrincipal principal) {
    }

    /** 刷新时重新加载主体；账号已停用 / 不存在时抛 {@link BizException}。 */
    @FunctionalInterface
    public interface PrincipalLoader {
        AuthPrincipal load(String subjectId, String companyId);
    }

    private final AuthSessionMapper mapper;
    private final JwtService jwt;
    private final BizIdGenerator ids;
    private final Clock clock;
    private final Duration refreshTtl;
    private final Duration reuseGrace;
    private final SecureRandom random = new SecureRandom();

    public AuthSessionService(AuthSessionMapper mapper, JwtService jwt, BizIdGenerator ids, Clock clock,
                              @Value("${shitu.jwt.refresh-ttl:P30D}") Duration refreshTtl,
                              @Value("${shitu.jwt.reuse-grace:PT30S}") Duration reuseGrace) {
        this.mapper = mapper;
        this.jwt = jwt;
        this.ids = ids;
        this.clock = clock;
        this.refreshTtl = refreshTtl;
        this.reuseGrace = reuseGrace;
    }

    public Duration refreshTtl() {
        return refreshTtl;
    }

    /** 登录成功：新建会话并签发 token。 */
    @Transactional
    public TokenPair open(AuthPrincipal principal) {
        return TenantContext.runAsSystem(() -> {
            String sid = ids.uuid();
            String refresh = newRefreshToken();
            LocalDateTime now = LocalDateTime.now(clock);
            AuthSession s = new AuthSession();
            s.setSessionId(sid);
            s.setDomain(principal.domain());
            s.setSubjectId(principal.subjectId());
            s.setCompanyId(principal.companyId());
            s.setRefreshHash(sha256(refresh));
            s.setStatus(ACTIVE);
            s.setExpiresAt(now.plus(refreshTtl));
            s.setIp(ClientInfo.ip());
            s.setUserAgent(ClientInfo.userAgent());
            s.setCreatedAt(now);
            s.setLastUsedAt(now);
            mapper.insert(s);
            AuthPrincipal p = principal.withSession(sid);
            return new TokenPair(jwt.issue(p), jwt.accessTtl().toSeconds(), refresh, refreshTtl, p);
        });
    }

    @Transactional(noRollbackFor = BizException.class)
    public TokenPair refresh(AuthDomain domain, String refreshToken, PrincipalLoader loader) {
        if (refreshToken == null || refreshToken.isBlank()) {
            throw new BizException(ErrorCode.AUTH_REFRESH_INVALID);
        }
        String hash = sha256(refreshToken);
        LocalDateTime now = LocalDateTime.now(clock);
        AuthSession s = TenantContext.runAsSystem(() -> {
            AuthSession cur = mapper.selectOne(new LambdaQueryWrapper<AuthSession>()
                    .eq(AuthSession::getRefreshHash, hash).last("FOR UPDATE"));
            if (cur != null) {
                return cur;
            }
            AuthSession prev = mapper.selectOne(new LambdaQueryWrapper<AuthSession>()
                    .eq(AuthSession::getPrevRefreshHash, hash).last("FOR UPDATE"));
            if (prev == null) {
                return null;
            }
            boolean withinGrace = prev.getRotatedAt() != null
                    && Duration.between(prev.getRotatedAt(), now).compareTo(reuseGrace) <= 0;
            if (!withinGrace && ACTIVE.equals(prev.getStatus())) {
                log.warn("refresh token reuse detected, revoking session {} subject {}", prev.getSessionId(), prev.getSubjectId());
                revoke(prev.getSessionId(), "REUSE_DETECTED");
                return null;
            }
            return withinGrace ? prev : null;
        });
        if (s == null || !ACTIVE.equals(s.getStatus()) || s.getDomain() != domain || !s.getExpiresAt().isAfter(now)) {
            throw new BizException(ErrorCode.AUTH_REFRESH_INVALID);
        }
        AuthPrincipal fresh;
        try {
            fresh = loader.load(s.getSubjectId(), s.getCompanyId());
        } catch (BizException e) {
            TenantContext.runAsSystem(() -> {
                revoke(s.getSessionId(), "ACCOUNT_DISABLED");
                return null;
            });
            throw e;
        }
        String next = newRefreshToken();
        TenantContext.runAsSystem(() -> mapper.update(null, new LambdaUpdateWrapper<AuthSession>()
                .eq(AuthSession::getSessionId, s.getSessionId())
                .set(AuthSession::getPrevRefreshHash, s.getRefreshHash())
                .set(AuthSession::getRefreshHash, sha256(next))
                .set(AuthSession::getRotatedAt, now)
                .set(AuthSession::getLastUsedAt, now)
                .set(AuthSession::getExpiresAt, now.plus(refreshTtl))));
        AuthPrincipal p = fresh.withSession(s.getSessionId());
        return new TokenPair(jwt.issue(p), jwt.accessTtl().toSeconds(), next, refreshTtl, p);
    }

    /** 登出：吊销 refresh token 对应的会话（token 无效时静默成功）。 */
    @Transactional
    public void logout(AuthDomain domain, String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) {
            return;
        }
        String hash = sha256(refreshToken);
        TenantContext.runAsSystem(() -> mapper.update(null, new LambdaUpdateWrapper<AuthSession>()
                .eq(AuthSession::getRefreshHash, hash)
                .eq(AuthSession::getDomain, domain)
                .set(AuthSession::getStatus, REVOKED)
                .set(AuthSession::getRevokeReason, "LOGOUT")));
    }

    /** 吊销某账号的全部会话（停用账号、改密、移出公司）。 */
    @Transactional
    public int revokeAll(AuthDomain domain, String subjectId, String reason) {
        return TenantContext.runAsSystem(() -> mapper.update(null, new LambdaUpdateWrapper<AuthSession>()
                .eq(AuthSession::getDomain, domain)
                .eq(AuthSession::getSubjectId, subjectId)
                .eq(AuthSession::getStatus, ACTIVE)
                .set(AuthSession::getStatus, REVOKED)
                .set(AuthSession::getRevokeReason, reason)));
    }

    private int revoke(String sessionId, String reason) {
        return mapper.update(null, new LambdaUpdateWrapper<AuthSession>()
                .eq(AuthSession::getSessionId, sessionId)
                .set(AuthSession::getStatus, REVOKED)
                .set(AuthSession::getRevokeReason, reason));
    }

    private String newRefreshToken() {
        byte[] b = new byte[32];
        random.nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    static String sha256(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
