package com.shitu.framework.kv;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/** 单实例内存实现（仅本地开发 / 测试）。过期键在访问时惰性清理，并每 1024 次写入做一次全量清理。 */
public class InMemoryKvStore implements KvStore {

    private record Entry(String value, Instant expiresAt) {
        boolean expired(Instant now) {
            return expiresAt != null && !now.isBefore(expiresAt);
        }
    }

    private final Map<String, Entry> map = new ConcurrentHashMap<>();
    private final Clock clock;
    private int writes;

    public InMemoryKvStore(Clock clock) {
        this.clock = clock;
    }

    private Instant now() {
        return clock.instant();
    }

    private Entry live(String key) {
        Entry e = map.get(key);
        if (e != null && e.expired(now())) {
            map.remove(key, e);
            return null;
        }
        return e;
    }

    private void maybeSweep() {
        if ((++writes & 1023) == 0) {
            Instant n = now();
            map.entrySet().removeIf(en -> en.getValue().expired(n));
        }
    }

    @Override
    public Optional<String> get(String key) {
        Entry e = live(key);
        return e == null ? Optional.empty() : Optional.of(e.value());
    }

    @Override
    public void set(String key, String value, Duration ttl) {
        map.put(key, new Entry(value, now().plus(ttl)));
        maybeSweep();
    }

    @Override
    public boolean setIfAbsent(String key, String value, Duration ttl) {
        Instant n = now();
        boolean[] created = {false};
        map.compute(key, (k, old) -> {
            if (old == null || old.expired(n)) {
                created[0] = true;
                return new Entry(value, n.plus(ttl));
            }
            return old;
        });
        maybeSweep();
        return created[0];
    }

    @Override
    public long increment(String key, Duration ttlOnCreate) {
        Instant n = now();
        Entry e = map.compute(key, (k, old) -> {
            if (old == null || old.expired(n)) {
                return new Entry("1", n.plus(ttlOnCreate));
            }
            return new Entry(String.valueOf(Long.parseLong(old.value()) + 1), old.expiresAt());
        });
        maybeSweep();
        return Long.parseLong(e.value());
    }

    @Override
    public Duration ttl(String key) {
        Entry e = live(key);
        if (e == null || e.expiresAt() == null) {
            return Duration.ZERO;
        }
        return Duration.between(now(), e.expiresAt());
    }

    @Override
    public void delete(String key) {
        map.remove(key);
    }

    @Override
    public Optional<String> take(String key) {
        Entry e = map.remove(key);
        return e == null || e.expired(now()) ? Optional.empty() : Optional.of(e.value());
    }
}
