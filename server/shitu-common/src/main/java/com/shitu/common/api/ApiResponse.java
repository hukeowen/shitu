package com.shitu.common.api;

import com.shitu.common.exception.ErrorCode;

/** 统一返回结构 { code, message, data, traceId }（02-架构 §13）。 */
public record ApiResponse<T>(String code, String message, T data, String traceId) {

    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(ErrorCode.OK.code(), ErrorCode.OK.message(), data, null);
    }

    public static <T> ApiResponse<T> fail(ErrorCode code, String message, String traceId) {
        return new ApiResponse<>(code.code(), message == null ? code.message() : message, null, traceId);
    }

    public ApiResponse<T> withTraceId(String traceId) {
        return new ApiResponse<>(code, message, data, traceId);
    }
}
