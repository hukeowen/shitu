package com.shitu.framework.kv;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;

import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.TimeUnit;

/** Redis 实现（多实例部署）。所有键统一加 {@code shitu:} 前缀。 */
public class RedisKvStore implements KvStore {

    private static final String PREFIX = "shitu:";

    /** INCR 后若是新键则设置过期时间，保证计数窗口固定。 */
    private static final DefaultRedisScript<Long> INCR_WITH_TTL = new DefaultRedisScript<>(
            "local v = redis.call('INCR', KEYS[1]) "
                    + "if v == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end "
                    + "return v", Long.class);

    private final StringRedisTemplate redis;

    public RedisKvStore(StringRedisTemplate redis) {
        this.redis = redis;
    }

    @Override
    public Optional<String> get(String key) {
        return Optional.ofNullable(redis.opsForValue().get(PREFIX + key));
    }

    @Override
    public void set(String key, String value, Duration ttl) {
        redis.opsForValue().set(PREFIX + key, value, ttl);
    }

    @Override
    public boolean setIfAbsent(String key, String value, Duration ttl) {
        return Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(PREFIX + key, value, ttl));
    }

    @Override
    public long increment(String key, Duration ttlOnCreate) {
        Long v = redis.execute(INCR_WITH_TTL, List.of(PREFIX + key), String.valueOf(ttlOnCreate.toMillis()));
        return v == null ? 0 : v;
    }

    @Override
    public Duration ttl(String key) {
        Long ms = redis.getExpire(PREFIX + key, TimeUnit.MILLISECONDS);
        return ms == null || ms <= 0 ? Duration.ZERO : Duration.ofMillis(ms);
    }

    @Override
    public void delete(String key) {
        redis.delete(PREFIX + key);
    }

    @Override
    public Optional<String> take(String key) {
        return Optional.ofNullable(redis.opsForValue().getAndDelete(PREFIX + key));
    }
}
