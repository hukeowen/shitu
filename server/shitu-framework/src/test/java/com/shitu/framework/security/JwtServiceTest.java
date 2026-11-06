package com.shitu.framework.security;

import com.shitu.common.enums.AuthDomain;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Base64;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JwtServiceTest {

    static final String SECRET = Base64.getEncoder().encodeToString("0123456789abcdef0123456789abcdef".getBytes());
    static final Instant T0 = Instant.parse("2026-11-06T02:00:00Z");

    JwtService at(Instant t) {
        return new JwtService(SECRET, Duration.ofMinutes(15), Clock.fixed(t, ZoneId.of("Asia/Shanghai")));
    }

    @Test
    void 签发后可解析出完整主体() {
        AuthPrincipal p = new AuthPrincipal(AuthDomain.TENANT, "M202611060001", "C10001", Set.of("PM", "SITE"), "sid1", "刘建国");
        AuthPrincipal back = at(T0).parse(at(T0).issue(p)).orElseThrow();
        assertThat(back).isEqualTo(p);
        assertThat(back.actorRoles()).hasSize(2);
    }

    @Test
    void 过期失效() {
        String t = at(T0).issue(new AuthPrincipal(AuthDomain.SEEKER, "U1", null, Set.of(), "s", null));
        assertThat(at(T0.plus(Duration.ofMinutes(14))).parse(t)).isPresent();
        assertThat(at(T0.plus(Duration.ofMinutes(16))).parse(t)).isEmpty();
    }

    @Test
    void 篡改或换密钥失效() {
        String t = at(T0).issue(new AuthPrincipal(AuthDomain.OPS, "A1001", null, Set.of("SUPER"), "s", null));
        String tampered = t.substring(0, t.length() - 2) + (t.endsWith("A") ? "BB" : "AA");
        assertThat(at(T0).parse(tampered)).isEmpty();
        String other = Base64.getEncoder().encodeToString("ffffffffffffffffffffffffffffffff".getBytes());
        assertThat(new JwtService(other, Duration.ofMinutes(15), Clock.fixed(T0, ZoneId.of("UTC"))).parse(t)).isEmpty();
        assertThat(at(T0).parse("not-a-jwt")).isEmpty();
    }

    @Test
    void 密钥太短拒绝启动() {
        assertThatThrownBy(() -> new JwtService(Base64.getEncoder().encodeToString("short".getBytes()),
                Duration.ofMinutes(15), Clock.systemUTC())).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void 租户主体必须带公司() {
        assertThatThrownBy(() -> new AuthPrincipal(AuthDomain.TENANT, "M1", null, Set.of("PM"), null, null))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
