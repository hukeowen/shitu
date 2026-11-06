package com.shitu;

import com.shitu.common.Constants;
import org.springframework.boot.SpringApplication;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration;

import java.util.TimeZone;

@SpringBootApplication(exclude = UserDetailsServiceAutoConfiguration.class)
@MapperScan(basePackages = "com.shitu", annotationClass = org.apache.ibatis.annotations.Mapper.class)
public class ShituApplication {
    public static void main(String[] args) {
        // 全系统统一北京时间（spec E-12），不依赖服务器操作系统时区
        TimeZone.setDefault(TimeZone.getTimeZone(Constants.ZONE));
        SpringApplication.run(ShituApplication.class, args);
    }
}
