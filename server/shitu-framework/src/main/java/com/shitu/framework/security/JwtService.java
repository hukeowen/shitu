package com.shitu.framework.security;

import com.shitu.common.enums.AuthDomain;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.Date;
import java.util.HashSet;
import java.util.Optional;
import java.util.Set;

/**
 * Access token（HS256，默认 15 分钟）。无状态：账号停用后最长 15 分钟失效，刷新时会重新校验账号状态。
 * <p>密钥通过 {@code shitu.jwt.secret}（Base64，至少 32 字节）注入，生产环境走 {@code SHITU_JWT_SECRET}。
 */
@Component
public class JwtService {

    private static final String ISSUER = "shitu";

    private final SecretKey key;
    private final Duration accessTtl;
    private final Clock clock;

    public JwtService(@Value("${shitu.jwt.secret}") String secret,
                      @Value("${shitu.jwt.access-ttl:PT15M}") Duration accessTtl,
                      Clock clock) {
        byte[] bytes = Decoders.BASE64.decode(secret);
        if (bytes.length < 32) {
            throw new IllegalStateException("shitu.jwt.secret must be at least 32 bytes (base64)");
        }
        this.key = Keys.hmacShaKeyFor(bytes);
        this.accessTtl = accessTtl;
        this.clock = clock;
    }

    public Duration accessTtl() {
        return accessTtl;
    }

    public String issue(AuthPrincipal p) {
        Instant now = clock.instant();
        return Jwts.builder()
                .issuer(ISSUER)
                .subject(p.subjectId())
                .audience().add(p.domain().audience()).and()
                .claim("cid", p.companyId())
                .claim("roles", p.roles())
                .claim("sid", p.sessionId())
                .claim("name", p.name())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(accessTtl)))
                .signWith(key, Jwts.SIG.HS256)
                .compact();
    }

    /** 校验签名、签发方和有效期；无效返回空。 */
    public Optional<AuthPrincipal> parse(String token) {
        try {
            Claims c = Jwts.parser()
                    .verifyWith(key)
                    .requireIssuer(ISSUER)
                    .clock(() -> Date.from(clock.instant()))
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
            Set<String> aud = c.getAudience();
            if (aud == null || aud.size() != 1) {
                return Optional.empty();
            }
            AuthDomain domain = AuthDomain.ofAudience(aud.iterator().next());
            Set<String> roles = new HashSet<>();
            if (c.get("roles") instanceof Collection<?> rs) {
                rs.forEach(r -> roles.add(String.valueOf(r)));
            }
            return Optional.of(new AuthPrincipal(domain, c.getSubject(), c.get("cid", String.class), roles,
                    c.get("sid", String.class), c.get("name", String.class)));
        } catch (JwtException | IllegalArgumentException e) {
            return Optional.empty();
        }
    }
}
