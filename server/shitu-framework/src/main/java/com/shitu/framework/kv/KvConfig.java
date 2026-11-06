package com.shitu.framework.kv;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Clock;

@Configuration
public class KvConfig {

    @Bean
    @ConditionalOnProperty(name = "shitu.kv.type", havingValue = "redis")
    public KvStore redisKvStore(StringRedisTemplate redis) {
        return new RedisKvStore(redis);
    }

    @Bean
    @ConditionalOnMissingBean(KvStore.class)
    public KvStore inMemoryKvStore(Clock clock) {
        return new InMemoryKvStore(clock);
    }
}
