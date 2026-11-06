package com.shitu.integration.sms;

import java.util.Map;

/**
 * 短信通道。生产实现为阿里云短信（Sprint 6 接入，需要已审核的短信签名和模板）；开发 / 测试用 {@link MockSmsSender}。
 */
public interface SmsSender {

    /**
     * @param phone        11 位手机号（明文，仅在发送时使用，不落日志）
     * @param templateCode 业务模板编码，如 LOGIN_CODE、APPLICATION_CREATED
     * @param params       模板变量
     * @return 通道返回的消息 ID
     * @throws SmsSendException 通道拒绝或网络失败
     */
    String send(String phone, String templateCode, Map<String, String> params);

    /** 是否为 Mock 通道（开发环境可在接口里回显验证码，方便联调）。 */
    default boolean isMock() {
        return false;
    }

    class SmsSendException extends RuntimeException {
        public SmsSendException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
