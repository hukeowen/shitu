package com.shitu.integration.kyc;

import java.util.UUID;

/**
 * 开发 / 测试用：一律视为一致；姓名为「核验不符」时返回不一致，便于测试失败路径。
 */
public class MockIdentityVerifier implements IdentityVerifier {

    public static final String MISMATCH_NAME = "核验不符";

    @Override
    public Verification verify(String realName, String idCard) {
        Result r = MISMATCH_NAME.equals(realName) ? Result.MISMATCH : Result.MATCH;
        return new Verification(r, "mock-" + UUID.randomUUID());
    }
}
