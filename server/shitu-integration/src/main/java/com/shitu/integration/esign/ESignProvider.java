package com.shitu.integration.esign;

import java.time.LocalDate;
import java.util.Map;
import java.util.Optional;

/**
 * 电子签（M-07 / C-503）。生产为 e签宝（Sprint 6 接入，需企业认证与合同模板备案）；开发用 {@link MockESignProvider}。
 * <p>以服务端回调为准，不信任前端签完回跳的结果（02-架构 §10）。
 */
public interface ESignProvider {

    record SignRequest(String contractNo, String title, String templateCode, String signerName, String signerIdCard,
                       String signerPhone, String companyName, LocalDate termStart, LocalDate termEnd) {
    }

    /** @param signUrl 求职者在 H5 打开的签署页 */
    record Flow(String flowId, String signUrl) {
    }

    /** 回调里与业务有关的部分。action：SIGN_FLOW_COMPLETE 签署完成 / SIGN_FLOW_REJECT 拒签 / SIGN_FLOW_EXPIRE 过期。 */
    record Callback(String flowId, String action, String signedFileKey) {
    }

    Flow createFlow(SignRequest req);

    /** 作废未完成的流程（重发签约时）。 */
    void revoke(String flowId);

    /**
     * 校验回调签名并解析。签名不对返回空（调用方记录原文后拒绝）。
     *
     * @param headers 请求头（小写键）
     */
    Optional<Callback> parseCallback(Map<String, String> headers, String body);
}
