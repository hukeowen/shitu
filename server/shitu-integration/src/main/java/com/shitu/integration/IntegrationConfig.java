package com.shitu.integration;

import com.shitu.integration.esign.ESignProvider;
import com.shitu.integration.esign.MockESignProvider;
import com.shitu.integration.kyc.IdentityVerifier;
import com.shitu.integration.kyc.MockIdentityVerifier;
import com.shitu.integration.sms.MockSmsSender;
import com.shitu.integration.sms.SmsSender;
import com.shitu.integration.storage.FileStorage;
import com.shitu.integration.storage.LocalFileStorage;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.nio.file.Path;

/**
 * 第三方适配器装配。真实实现（阿里云短信 / OSS）按 {@code shitu.sms.provider}、{@code shitu.storage.provider}
 * 切换，在接入时新增 Bean；这里只提供 Mock / 本地实现作为兜底。
 */
@Configuration
public class IntegrationConfig {

    @Bean
    @ConditionalOnMissingBean(SmsSender.class)
    public SmsSender mockSmsSender() {
        return new MockSmsSender();
    }

    @Bean
    @ConditionalOnMissingBean(FileStorage.class)
    public FileStorage localFileStorage(@Value("${shitu.storage.local-dir:./data/uploads}") String dir) {
        return new LocalFileStorage(Path.of(dir));
    }

    @Bean
    @ConditionalOnMissingBean(IdentityVerifier.class)
    public IdentityVerifier mockIdentityVerifier() {
        return new MockIdentityVerifier();
    }

    @Bean
    @ConditionalOnMissingBean(ESignProvider.class)
    public ESignProvider mockESignProvider(@Value("${shitu.h5.public-base:http://localhost:5173}") String h5Base,
                                           @Value("${shitu.esign.callback-secret:local-mock-esign-secret}") String secret) {
        return new MockESignProvider(h5Base, secret);
    }
}
