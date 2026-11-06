package com.shitu.framework.config;

import com.shitu.common.Constants;
import com.shitu.framework.crypto.FieldCipher;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;

@Configuration
public class CoreConfig {

    /** 业务代码一律注入 Clock 取当前时间，测试可模拟跨日、跨月（02-架构 §13）。 */
    @Bean
    public Clock clock() {
        // 截到毫秒：与 DATETIME(3) 精度一致，序列化后的时间也不会出现 iOS Safari 解析不了的 7 位小数
        return Clock.tick(Clock.system(Constants.ZONE), java.time.Duration.ofMillis(1));
    }

    @Bean
    public FieldCipher fieldCipher(@Value("${shitu.crypto.enc-key}") String encKey,
                                   @Value("${shitu.crypto.mac-key}") String macKey) {
        return FieldCipher.fromBase64(encKey, macKey);
    }
}
