package com.shitu.app.config;

import com.shitu.platform.admin.OpsAdminService;
import com.shitu.platform.admin.Passwords;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/**
 * 首次启动时（还没有任何平台账号）创建超级管理员 {@code admin}。
 * 密码取 {@code SHITU_OPS_INIT_PASSWORD}；未配置则随机生成并在启动日志中打印一次。首次登录必须改密。
 */
@Component
public class OpsBootstrap implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(OpsBootstrap.class);

    private final OpsAdminService admins;
    private final String initPassword;

    public OpsBootstrap(OpsAdminService admins, @Value("${shitu.ops.init-password:}") String initPassword) {
        this.admins = admins;
        this.initPassword = initPassword;
    }

    @Override
    public void run(ApplicationArguments args) {
        String pwd = initPassword == null || initPassword.isBlank() ? Passwords.random(12) : initPassword;
        if (admins.bootstrapIfEmpty("admin", pwd)) {
            if (initPassword == null || initPassword.isBlank()) {
                log.warn("========== 已创建平台超级管理员 admin，初始密码：{}（首次登录须修改）==========", pwd);
            } else {
                log.warn("========== 已创建平台超级管理员 admin（密码来自 SHITU_OPS_INIT_PASSWORD，首次登录须修改）==========");
            }
        }
    }
}
