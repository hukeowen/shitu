package com.shitu.framework.config;

import net.javacrumbs.shedlock.core.LockProvider;
import net.javacrumbs.shedlock.provider.jdbctemplate.JdbcTemplateLockProvider;
import net.javacrumbs.shedlock.spring.annotation.EnableSchedulerLock;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.EnableScheduling;


/**
 * 定时任务：Spring {@code @Scheduled} + ShedLock（锁存 MySQL {@code shedlock} 表），多实例部署时每个任务只在一个实例上执行。
 * 测试中可用 {@code shitu.scheduling.enabled=false} 关闭，改为直接调用任务方法。
 */
@Configuration
@EnableScheduling
@EnableSchedulerLock(defaultLockAtMostFor = "PT5M")
@ConditionalOnProperty(name = "shitu.scheduling.enabled", havingValue = "true", matchIfMissing = true)
public class SchedulingConfig {

    @Bean
    public LockProvider lockProvider(JdbcTemplate jdbc) {
        return new JdbcTemplateLockProvider(JdbcTemplateLockProvider.Configuration.builder()
                .withJdbcTemplate(jdbc)
                .usingDbTime()
                .build());
    }
}
