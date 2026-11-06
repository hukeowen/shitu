package com.shitu.framework.web;

import com.shitu.common.api.ApiResponse;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authorization.AuthorizationDeniedException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.stream.Collectors;

/**
 * 统一异常 → { code, message, data, traceId }。
 * <p>业务错误一律 HTTP 200 + 业务 code，前端只看 code；例外：未登录 401（前端据此走刷新）、无权限 403、
 * 不存在 404。系统错误 HTTP 500，不暴露堆栈。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(BizException.class)
    public ResponseEntity<ApiResponse<Void>> biz(BizException e) {
        log.info("biz error code={} msg={}", e.getErrorCode().code(), e.getMessage());
        HttpStatus status = switch (e.getErrorCode()) {
            case SYS_UNAUTHORIZED, AUTH_REFRESH_INVALID -> HttpStatus.UNAUTHORIZED;
            case SYS_FORBIDDEN -> HttpStatus.FORBIDDEN;
            case SYS_NOT_FOUND -> HttpStatus.NOT_FOUND;
            case SYS_TOO_MANY_REQUESTS -> HttpStatus.TOO_MANY_REQUESTS;
            default -> HttpStatus.OK;
        };
        return ResponseEntity.status(status).body(ApiResponse.fail(e.getErrorCode(), e.getMessage(), TraceIdFilter.current()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ApiResponse<Void> invalid(MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldErrors().stream()
                .map(FieldError::getDefaultMessage)
                .distinct()
                .collect(Collectors.joining("；"));
        return ApiResponse.fail(ErrorCode.SYS_BAD_REQUEST, msg, TraceIdFilter.current());
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ApiResponse<Void> violation(ConstraintViolationException e) {
        String msg = e.getConstraintViolations().stream()
                .map(v -> v.getMessage())
                .distinct()
                .collect(Collectors.joining("；"));
        return ApiResponse.fail(ErrorCode.SYS_BAD_REQUEST, msg, TraceIdFilter.current());
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MissingServletRequestParameterException.class,
            MethodArgumentTypeMismatchException.class, MissingRequestHeaderException.class,
            MissingServletRequestPartException.class})
    public ApiResponse<Void> badRequest(Exception e) {
        return ApiResponse.fail(ErrorCode.SYS_BAD_REQUEST, null, TraceIdFilter.current());
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ApiResponse<Void> tooLarge(MaxUploadSizeExceededException e) {
        return ApiResponse.fail(ErrorCode.TEN_FILE_INVALID, "文件不能超过 10MB", TraceIdFilter.current());
    }

    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ApiResponse<Void> conflict(OptimisticLockingFailureException e) {
        return ApiResponse.fail(ErrorCode.SYS_CONFLICT, null, TraceIdFilter.current());
    }

    /** 唯一索引冲突兜底（业务层应先做存在性校验给出更准确的提示）。 */
    @ExceptionHandler(DuplicateKeyException.class)
    public ApiResponse<Void> duplicate(DuplicateKeyException e) {
        log.warn("duplicate key: {}", e.getMostSpecificCause().getMessage());
        return ApiResponse.fail(ErrorCode.SYS_CONFLICT, "数据已存在，请勿重复提交", TraceIdFilter.current());
    }

    /** 方法级 @PreAuthorize 拒绝。 */
    @ExceptionHandler({AccessDeniedException.class, AuthorizationDeniedException.class})
    public ResponseEntity<ApiResponse<Void>> denied(Exception e) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ApiResponse.fail(ErrorCode.SYS_FORBIDDEN, null, TraceIdFilter.current()));
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiResponse<Void>> method(HttpRequestMethodNotSupportedException e) {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
                .body(ApiResponse.fail(ErrorCode.SYS_BAD_REQUEST, "不支持的请求方式", TraceIdFilter.current()));
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
