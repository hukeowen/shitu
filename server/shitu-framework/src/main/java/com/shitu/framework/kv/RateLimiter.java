package com.shitu.framework.kv;

import org.springframework.stereotype.Component;

import java.time.Duration;

/** 固定窗口限流（短信频控、登录失败锁定、接口防刷）。 */
@Component
public class RateLimiter {

    private final KvStore kv;

    public RateLimiter(KvStore kv) {
        this.kv = kv;
    }

    /** 本次计数后不超过 limit 返回 true。 */
    public boolean tryAcquire(String key, int limit, Duration window) {
        return kv.increment("rl:" + key, window) <= limit;
    }

    /** 当前窗口内的计数（不自增）。 */
    public long count(String key) {
        return kv.get("rl:" + key).map(Long::parseLong).orElse(0L);
    }

    public void reset(String key) {
        kv.delete("rl:" + key);
    }
}
