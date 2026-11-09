package com.shitu.app.config;

import com.shitu.integration.esign.ESignProvider;
import com.shitu.integration.esign.MockESignProvider;
import com.shitu.integration.kyc.IdentityVerifier;
import com.shitu.integration.kyc.MockIdentityVerifier;
import com.shitu.integration.sms.MockSmsSender;
import com.shitu.integration.sms.SmsSender;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * 生产环境启动检查（prod profile）：任何一项不满足就拒绝启动，避免带着开发配置上线。
 * <ul>
 *   <li>加密 / 盲索引 / JWT 密钥不能是仓库里的开发默认值</li>
 *   <li>refresh cookie 必须 Secure；二维码前缀必须 https</li>
 *   <li>KV 必须是 Redis（限流、验证码、会话吊销要跨实例共享）</li>
 *   <li>不能回显短信验证码、不能写演示数据</li>
 *   <li>短信 / 实名 / 电子签不能是 Mock（试点预发环境可显式设置 {@code shitu.allow-mock-providers=true}）</li>
 * </ul>
 */
@Component
@Profile("prod")
public class ProductionGuard implements InitializingBean {

    private static final Logger log = LoggerFactory.getLogger(ProductionGuard.class);

    /** 与 application.yml 中的开发默认值一致。 */
    static final List<String> DEV_SECRETS = List.of(
            "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
            "ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=",
            "c2hpdHUtbG9jYWwtZGV2LWp3dC1zZWNyZXQtZG8tbm90LXVzZS1pbi1wcm9k");

    private final Environment env;
    private final SmsSender sms;
    private final IdentityVerifier kyc;
    private final ESignProvider esign;

    public ProductionGuard(Environment env, SmsSender sms, IdentityVerifier kyc, ESignProvider esign) {
        this.env = env;
        this.sms = sms;
        this.kyc = kyc;
        this.esign = esign;
    }

    @Override
    public void afterPropertiesSet() {
        List<String> problems = check();
        if (!problems.isEmpty()) {
            throw new IllegalStateException("生产环境配置不安全，拒绝启动：\n - " + String.join("\n - ", problems));
        }
        log.info("production guard passed");
    }

    List<String> check() {
        List<String> p = new ArrayList<>();
        for (String key : List.of("shitu.crypto.enc-key", "shitu.crypto.mac-key", "shitu.jwt.secret")) {
            String v = env.getProperty(key);
            if (v == null || v.isBlank() || DEV_SECRETS.contains(v)) {
                p.add(key + " 使用了开发默认值或为空（通过 SHITU_ENC_KEY / SHITU_MAC_KEY / SHITU_JWT_SECRET 注入）");
            }
        }
        if (!env.getProperty("shitu.auth.cookie-secure", Boolean.class, false)) {
            p.add("shitu.auth.cookie-secure 必须为 true（SHITU_COOKIE_SECURE=true）");
        }
        if (!"redis".equals(env.getProperty("shitu.kv.type"))) {
            p.add("shitu.kv.type 必须为 redis（SHITU_KV_TYPE=redis）");
        }
        if (env.getProperty("shitu.sms.expose-code-in-mock", Boolean.class, false)) {
            p.add("shitu.sms.expose-code-in-mock 必须为 false");
        }
        if (env.getProperty("shitu.dev.seed-demo", Boolean.class, false)) {
            p.add("shitu.dev.seed-demo 必须为 false");
        }
        String base = env.getProperty("shitu.h5.public-base", "");
        if (!base.startsWith("https://")) {
            p.add("shitu.h5.public-base 必须是 https 地址（SHITU_H5_PUBLIC_BASE），当前：" + base);
        }
        String db = env.getProperty("spring.datasource.password", "");
        if (db.isBlank() || "root".equals(db)) {
            p.add("数据库密码为空或为 root（DB_PASSWORD）");
        }
        if (!env.getProperty("shitu.allow-mock-providers", Boolean.class, false)) {
            if (sms instanceof MockSmsSender) {
                p.add("短信通道仍是 Mock");
            }
            if (kyc instanceof MockIdentityVerifier) {
                p.add("实名核验仍是 Mock");
            }
            if (esign instanceof MockESignProvider) {
                p.add("电子签仍是 Mock");
            }
        }
        return p;
    }
}
