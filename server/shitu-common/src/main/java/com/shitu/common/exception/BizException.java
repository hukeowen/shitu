package com.shitu.common.exception;

public class BizException extends RuntimeException {
    private final ErrorCode errorCode;

    public BizException(ErrorCode errorCode) {
        super(errorCode.message());
        this.errorCode = errorCode;
    }

    public BizException(ErrorCode errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
    }

    public ErrorCode getErrorCode() {
        return errorCode;
    }

    public static void check(boolean condition, ErrorCode code) {
        if (!condition) {
            throw new BizException(code);
        }
    }

    public static void check(boolean condition, ErrorCode code, String message) {
        if (!condition) {
            throw new BizException(code, message);
        }
    }
}
