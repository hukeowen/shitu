package com.shitu.framework.web;

import com.shitu.common.api.ApiResponse;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.stream.Collectors;

/**
 * 统一异常 → { code, message, data, traceId }。
 * 业务错误一律 HTTP 200 + 业务 code，前端只看 code；系统错误 HTTP 500，不暴露堆栈。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(BizException.class)
    public ApiResponse<Void> biz(BizException e) {
        log.info("biz error code={} msg={}", e.getErrorCode().code(), e.getMessage());
        return ApiResponse.fail(e.getErrorCode(), e.getMessage(), TraceIdFilter.current());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ApiResponse<Void> invalid(MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldErrors().stream()
                .map(FieldError::getDefaultMessage)
                .collect(Collectors.joining("；"));
        return ApiResponse.fail(ErrorCode.SYS_BAD_REQUEST, msg, TraceIdFilter.current());
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ApiResponse<Void> unreadable(HttpMessageNotReadableException e) {
        return ApiResponse.fail(ErrorCode.SYS_BAD_REQUEST, null, TraceIdFilter.current());
    }

    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ApiResponse<Void> conflict(OptimisticLockingFailureException e) {
        return ApiResponse.fail(ErrorCode.SYS_CONFLICT, null, TraceIdFilter.current());
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ApiResponse<Void>> notFound(NoResourceFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiResponse.fail(ErrorCode.SYS_NOT_FOUND, null, TraceIdFilter.current()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> unknown(Exception e) {
        log.error("unhandled error", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResponse.fail(ErrorCode.SYS_INTERNAL, null, TraceIdFilter.current()));
    }
}
