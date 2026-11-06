package com.shitu.framework.kv;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class InMemoryKvStoreTest {

    final AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-11-06T00:00:00Z"));
    final Clock clock = new Clock() {
        @Override
        public ZoneId getZone() {
            return ZoneId.of("UTC");
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now.get();
        }
    };
    final InMemoryKvStore kv = new InMemoryKvStore(clock);

    void advance(Duration d) {
        now.set(now.get().plus(d));
    }

    @Test
    void 过期后读不到() {
        kv.set("a", "1", Duration.ofSeconds(60));
        advance(Duration.ofSeconds(59));
        assertThat(kv.get("a")).contains("1");
        advance(Duration.ofSeconds(1));
        assertThat(kv.get("a")).isEmpty();
    }

    @Test
    void setIfAbsent只有第一次成功_过期后可以再次写入() {
        assertThat(kv.setIfAbsent("iv", "1", Duration.ofSeconds(60))).isTrue();
        assertThat(kv.setIfAbsent("iv", "1", Duration.ofSeconds(60))).isFalse();
        assertThat(kv.ttl("iv")).isEqualTo(Duration.ofSeconds(60));
        advance(Duration.ofSeconds(60));
        assertThat(kv.setIfAbsent("iv", "1", Duration.ofSeconds(60))).isTrue();
    }

    @Test
    void 固定窗口计数_窗口过期后从1重新计数() {
        assertThat(kv.increment("c", Duration.ofHours(1))).isEqualTo(1);
        assertThat(kv.increment("c", Duration.ofHours(1))).isEqualTo(2);
        advance(Duration.ofMinutes(59));
        assertThat(kv.increment("c", Duration.ofHours(1))).isEqualTo(3);
        advance(Duration.ofMinutes(1));
        assertThat(kv.increment("c", Duration.ofHours(1))).isEqualTo(1);
    }

    @Test
    void take是一次性的() {
        kv.set("t", "x", Duration.ofMinutes(1));
        assertThat(kv.take("t")).contains("x");
        assertThat(kv.take("t")).isEmpty();
    }

    @Test
    void 限流器() {
        RateLimiter rl = new RateLimiter(kv);
        for (int i = 0; i < 3; i++) {
            assertThat(rl.tryAcquire("k", 3, Duration.ofMinutes(1))).isTrue();
        }
        assertThat(rl.tryAcquire("k", 3, Duration.ofMinutes(1))).isFalse();
        assertThat(rl.count("k")).isEqualTo(4);
        rl.reset("k");
        assertThat(rl.tryAcquire("k", 3, Duration.ofMinutes(1))).isTrue();
    }
}
