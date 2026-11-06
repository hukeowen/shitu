package com.shitu.integration.esign;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 开发 / 测试用电子签：签署页是 C 端的模拟页面 {@code /esign/mock/{flowId}}，点「确认签署」后由后端模拟 e签宝回调。
 * 回调用 HMAC-SHA256 签名（请求头 {@code x-esign-signature}），与真实接入一样先验签再处理。
 */
public class MockESignProvider implements ESignProvider {

    public static final String SIGNATURE_HEADER = "x-esign-signature";

    private final String h5Base;
    private final byte[] secret;
    private final ObjectMapper json = new ObjectMapper();

    public MockESignProvider(String h5Base, String secret) {
        this.h5Base = h5Base.endsWith("/") ? h5Base.substring(0, h5Base.length() - 1) : h5Base;
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
    }

    @Override
    public Flow createFlow(SignRequest req) {
        String flowId = "mockflow-" + UUID.randomUUID().toString().replace("-", "");
        return new Flow(flowId, h5Base + "/esign/mock/" + flowId);
    }

    @Override
    public void revoke(String flowId) {
        // 模拟流程无需作废
    }

    @Override
    public Optional<Callback> parseCallback(Map<String, String> headers, String body) {
        String sig = headers.get(SIGNATURE_HEADER);
        if (sig == null || !MessageDigest.isEqual(sig.getBytes(StandardCharsets.UTF_8), sign(body).getBytes(StandardCharsets.UTF_8))) {
            return Optional.empty();
        }
        try {
            JsonNode n = json.readTree(body);
            return Optional.of(new Callback(n.path("flowId").asText(), n.path("action").asText(),
                    n.hasNonNull("signedFileKey") ? n.get("signedFileKey").asText() : null));
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    /** 模拟 e签宝对回调体签名（测试与模拟签署页使用）。 */
    public String sign(String body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }
}
