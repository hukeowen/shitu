package com.shitu.framework.kv;

import java.time.Duration;
import java.util.Optional;

/**
 * 短期键值存储：验证码、限流计数、一次性票据。
 * <p>本地开发默认内存实现（{@code shitu.kv.type=memory}），多实例部署必须切到 Redis（{@code shitu.kv.type=redis}）。
 */
public interface KvStore {

    Optional<String> get(String key);

    void set(String key, String value, Duration ttl);

    /** 键不存在时写入并返回 true；已存在返回 false（原子）。 */
    boolean setIfAbsent(String key, String value, Duration ttl);

    /** 自增并返回新值；键首次创建时设置 ttl（固定窗口计数）。 */
    long increment(String key, Duration ttlOnCreate);

    /** 剩余存活时间，键不存在返回 {@link Duration#ZERO}。 */
    Duration ttl(String key);

    void delete(String key);

    /** 读取并删除（一次性票据，原子）。 */
    Optional<String> take(String key);
}
