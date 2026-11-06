package com.shitu.app.seeker;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.shitu.common.api.ApiResponse;
import com.shitu.common.enums.ContractStatus;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.security.CurrentUser;
import com.shitu.integration.esign.ESignProvider;
import com.shitu.integration.esign.MockESignProvider;
import com.shitu.lifecycle.employment.LaborContract;
import com.shitu.lifecycle.employment.OnboardingService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 电子签：服务端回调（以此为准，M-07）与 C 端合同查询（C-503）。
 * <p>回调先原文落 {@code esign_callback_log}，验签通过才处理；处理逻辑幂等，e签宝重复推送只入职一次。
 * <p>开发环境（Mock 电子签）额外提供「模拟签署」接口，模拟 e签宝签完后推送回调。
 */
@Tag(name = "电子签")
@RestController
public class ESignCallbackController {

    private static final Logger log = LoggerFactory.getLogger(ESignCallbackController.class);

    private final ESignProvider esign;
    private final OnboardingService onboarding;
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public ESignCallbackController(ESignProvider esign, OnboardingService onboarding, JdbcTemplate jdbc, ObjectMapper json) {
        this.esign = esign;
        this.onboarding = onboarding;
        this.jdbc = jdbc;
        this.json = json;
    }

    @Operation(summary = "e签宝回调（签名校验；重复推送幂等）")
    @PostMapping("/api/v1/callback/esign")
    public ResponseEntity<Map<String, Object>> callback(@RequestBody String body, HttpServletRequest req) {
        Map<String, String> headers = new HashMap<>();
        Collections.list(req.getHeaderNames()).forEach(h -> headers.put(h.toLowerCase(), req.getHeader(h)));
        return ResponseEntity.status(handle(headers, body) ? HttpStatus.OK : HttpStatus.UNAUTHORIZED)
                .body(Map.of("code", 0));
    }

    /** @return 验签是否通过 */
    boolean handle(Map<String, String> headers, String body) {
        Optional<ESignProvider.Callback> cb = esign.parseCallback(headers, body);
        String raw;
        try {
            raw = json.writeValueAsString(json.readTree(body));
        } catch (Exception e) {
            raw = json.valueToTree(Map.of("raw", body)).toString();
        }
        jdbc.update("INSERT INTO esign_callback_log (flow_id, action, raw_body, signature_ok, processed) VALUES (?, ?, ?, ?, 0)",
                cb.map(ESignProvider.Callback::flowId).orElse("-"), cb.map(ESignProvider.Callback::action).orElse("-"),
                raw, cb.isPresent());
        if (cb.isEmpty()) {
            log.warn("esign callback signature invalid");
            return false;
        }
        ESignProvider.Callback c = cb.get();
        switch (c.action()) {
            case "SIGN_FLOW_COMPLETE" -> onboarding.onSigned(c.flowId(), c.signedFileKey());
            case "SIGN_FLOW_REJECT" -> onboarding.onSignFailed(c.flowId(), ContractStatus.TERMINATED);
            case "SIGN_FLOW_EXPIRE" -> onboarding.onSignFailed(c.flowId(), ContractStatus.VOIDED);
            default -> log.info("esign callback action {} ignored", c.action());
        }
        jdbc.update("UPDATE esign_callback_log SET processed = 1 WHERE flow_id = ? AND processed = 0", c.flowId());
        return true;
    }

    // ------------------------------------------------------------------ C 端

    @Operation(summary = "我的合同（C-503）")
    @GetMapping("/api/v1/seeker/contracts")
    public ApiResponse<List<OnboardingService.ContractView>> contracts() {
        return ApiResponse.ok(onboarding.contractsOfUser(CurrentUser.subjectId()));
    }

    @Operation(summary = "待签署合同（含签署链接；没有返回空）")
    @GetMapping("/api/v1/seeker/contracts/pending")
    public ApiResponse<OnboardingService.ContractView> pending() {
        return ApiResponse.ok(onboarding.pendingContractOfUser(CurrentUser.subjectId()).orElse(null));
    }

    @Operation(summary = "【仅开发环境】模拟签署：模拟 e签宝签完后推送回调")
    @PostMapping("/api/v1/seeker/esign/mock/{flowId}/sign")
    public ApiResponse<Void> mockSign(@PathVariable String flowId) throws Exception {
        BizException.check(esign instanceof MockESignProvider, ErrorCode.SYS_NOT_FOUND);
        LaborContract c = onboarding.contractByFlow(flowId);
        BizException.check(c != null && c.getUserId().equals(CurrentUser.subjectId()), ErrorCode.SYS_NOT_FOUND);
        String body = json.writeValueAsString(Map.of("flowId", flowId, "action", "SIGN_FLOW_COMPLETE"));
        handle(Map.of(MockESignProvider.SIGNATURE_HEADER, ((MockESignProvider) esign).sign(body)), body);
        return ApiResponse.ok(null);
    }
}
