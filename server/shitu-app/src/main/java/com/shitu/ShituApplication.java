package com.shitu;

import com.shitu.common.Constants;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

import java.util.TimeZone;

@SpringBootApplication
public class ShituApplication {
    public static void main(String[] args) {
        // 全系统统一北京时间（spec E-12），不依赖服务器操作系统时区
        TimeZone.setDefault(TimeZone.getTimeZone(Constants.ZONE));
        SpringApplication.run(ShituApplication.class, args);
    }
}
