package com.shitu.app.config;

import com.shitu.integration.esign.MockESignProvider;
import com.shitu.integration.kyc.MockIdentityVerifier;
import com.shitu.integration.sms.MockSmsSender;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ProductionGuardTest {

    @Test
    void devDefaultsAreRejected() {
        MockEnvironment env = new MockEnvironment()
                .withProperty("shitu.crypto.enc-key", ProductionGuard.DEV_SECRETS.get(0))
                .withProperty("shitu.crypto.mac-key", ProductionGuard.DEV_SECRETS.get(1))
                .withProperty("shitu.jwt.secret", ProductionGuard.DEV_SECRETS.get(2))
                .withProperty("shitu.kv.type", "memory")
                .withProperty("shitu.h5.public-base", "http://localhost:5173")
                .withProperty("spring.datasource.password", "root");
        ProductionGuard g = new ProductionGuard(env, Mockito.mock(MockSmsSender.class), Mockito.mock(MockIdentityVerifier.class),
                Mockito.mock(MockESignProvider.class));
        assertThat(g.check()).hasSize(10);
        assertThatThrownBy(g::afterPropertiesSet).hasMessageContaining("拒绝启动");
    }

    @Test
    void properProductionConfigPasses() {
        MockEnvironment env = new MockEnvironment()
                .withProperty("shitu.crypto.enc-key", "cHJvZC1lbmMta2V5LXByb2QtZW5jLWtleS0zMmI=")
                .withProperty("shitu.crypto.mac-key", "cHJvZC1tYWMta2V5LXByb2QtbWFjLWtleS0zMmI=")
                .withProperty("shitu.jwt.secret", "cHJvZC1qd3Qtc2VjcmV0LXByb2Qtand0LXNlY3JldA==")
                .withProperty("shitu.auth.cookie-secure", "true")
                .withProperty("shitu.kv.type", "redis")
                .withProperty("shitu.h5.public-base", "https://m.shitu.com")
                .withProperty("spring.datasource.password", "S3cure!pw")
                .withProperty("shitu.allow-mock-providers", "true");
        ProductionGuard g = new ProductionGuard(env, Mockito.mock(MockSmsSender.class), Mockito.mock(MockIdentityVerifier.class),
                Mockito.mock(MockESignProvider.class));
        assertThat(g.check()).isEmpty();
    }
}
