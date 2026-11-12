package com.shitu.app.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * 预览环境启动检查（preview profile）：预览环境允许 Mock 通道和 HTTP，但它在公网上，
 * 密钥、数据库密码、平台初始密码不能是仓库里的默认值，否则拒绝启动。
 */
@Component
@Profile("preview")
public class PreviewGuard implements InitializingBean {

    private static final Logger log = LoggerFactory.getLogger(PreviewGuard.class);

    private final Environment env;

    public PreviewGuard(Environment env) {
        this.env = env;
    }

    @Override
    public void afterPropertiesSet() {
        List<String> p = new ArrayList<>();
        for (String key : List.of("shitu.crypto.enc-key", "shitu.crypto.mac-key", "shitu.jwt.secret")) {
            String v = env.getProperty(key);
            if (v == null || v.isBlank() || ProductionGuard.DEV_SECRETS.contains(v)) {
                p.add(key + " 使用了开发默认值或为空");
            }
        }
        String db = env.getProperty("spring.datasource.password", "");
        if (db.length() < 12 || "root".equals(db)) {
            p.add("数据库密码为空或过短（DB_PASSWORD，至少 12 位）");
        }
        String ops = env.getProperty("shitu.ops.init-password", "");
        if (ops.length() < 12 || "Shitu@2026".equals(ops)) {
            p.add("平台初始密码为空、过短或是开发默认值（SHITU_OPS_INIT_PASSWORD，至少 12 位）");
        }
        if (!"redis".equals(env.getProperty("shitu.kv.type"))) {
            p.add("shitu.kv.type 必须为 redis");
        }
        if (!p.isEmpty()) {
            throw new IllegalStateException("预览环境配置不安全，拒绝启动：\n - " + String.join("\n - ", p));
        }
        log.warn("PREVIEW environment: mock providers, SMS codes are echoed to the page. Demo data only.");
    }
}
