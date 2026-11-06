package com.shitu.integration.sms;

import com.shitu.common.util.Masks;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;
import java.util.UUID;

/** 开发 / 测试短信通道：只打日志（手机号脱敏），不真正发送。 */
public class MockSmsSender implements SmsSender {

    private static final Logger log = LoggerFactory.getLogger(MockSmsSender.class);

    @Override
    public String send(String phone, String templateCode, Map<String, String> params) {
        log.info("[MOCK SMS] to={} template={} params={}", Masks.phone(phone), templateCode, params);
        return "mock-" + UUID.randomUUID();
    }

    @Override
    public boolean isMock() {
        return true;
    }
}
