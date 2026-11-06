package com.shitu.integration.kyc;

/**
 * 身份二要素核验（姓名 + 身份证号，C-405）。生产为阿里云实人认证 / 二要素接口（Sprint 6 接入）；开发用 {@link MockIdentityVerifier}。
 * OCR 识别（证件照 → 姓名 / 号码 / 出生日期）同样在接入真实服务时补充，V1.0 Mock 阶段走手工输入 + 二要素。
 */
public interface IdentityVerifier {

    enum Result { MATCH, MISMATCH, UNAVAILABLE }

    record Verification(Result result, String providerTraceId) {
    }

    Verification verify(String realName, String idCard);
}
