package com.shitu.app.ops;

import com.shitu.common.api.ApiResponse;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.common.util.Rows;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.param.SysParams;
import com.shitu.framework.security.CurrentUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.LocalTime;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;

/**
 * 系统参数（所有「参数化」决策项）：平台中台可改、不发版。
 * 只能改已有参数的值，不能新增 / 删除；每次修改必须写原因并进审计日志；改完立即失效本实例缓存（其他实例 60 秒内生效）。
 */
@Tag(name = "平台中台 · 系统参数")
@RestController
@RequestMapping("/api/v1/ops/sys-params")
public class OpsParamController {

    public record UpdateRequest(@NotBlank(message = "请填写参数值") @Size(max = 512) String value,
                                @NotBlank(message = "请填写修改原因") @Size(max = 255) String remark) {
    }

    private final JdbcTemplate jdbc;
    private final SysParams params;
    private final AuditLogger audit;

    public OpsParamController(JdbcTemplate jdbc, SysParams params, AuditLogger audit) {
        this.jdbc = jdbc;
        this.params = params;
        this.audit = audit;
    }

    @Operation(summary = "系统参数列表")
    @PreAuthorize("hasAnyRole('SUPER','OPERATOR')")
    @GetMapping
    public ApiResponse<List<Map<String, Object>>> list() {
        return ApiResponse.ok(Rows.camel(jdbc.queryForList("SELECT p.param_key, p.param_value, p.value_type, p.description, p.updated_by, "
                + "p.update_remark, p.updated_at, a.display_name AS updated_by_name FROM sys_param p "
                + "LEFT JOIN ops_admin a ON a.admin_id = p.updated_by ORDER BY p.param_key")));
    }

    @Operation(summary = "修改系统参数（仅超级管理员）")
    @PreAuthorize("hasRole('SUPER')")
    @PutMapping("/{key}")
    @Transactional
    public ApiResponse<Void> update(@PathVariable String key, @Valid @RequestBody UpdateRequest req) {
        List<Map<String, Object>> cur = jdbc.queryForList("SELECT param_value, value_type FROM sys_param WHERE param_key = ? FOR UPDATE", key);
        BizException.check(!cur.isEmpty(), ErrorCode.SYS_NOT_FOUND, "参数不存在");
        String type = (String) cur.get(0).get("value_type");
        String before = (String) cur.get(0).get("param_value");
        String value = normalize(type, req.value().trim());
        BizException.check(!value.equals(before), ErrorCode.SYS_BAD_REQUEST, "参数值没有变化");
        jdbc.update("UPDATE sys_param SET param_value = ?, updated_by = ?, update_remark = ? WHERE param_key = ?",
                value, CurrentUser.subjectId(), req.remark().trim(), key);
        audit.log("SYS_PARAM_UPDATE", "SYS_PARAM", key, Map.of("before", before, "after", value, "remark", req.remark().trim()));
        params.invalidate();
        return ApiResponse.ok(null);
    }

    /** 按类型校验并规范化；不合法抛 400。 */
    static String normalize(String type, String v) {
        try {
            switch (type) {
                case "INT" -> {
                    int n = Integer.parseInt(v);
                    BizException.check(n >= 0 && n <= 1_000_000, ErrorCode.SYS_BAD_REQUEST, "请输入 0 – 1000000 之间的整数");
                    return String.valueOf(n);
                }
                case "DECIMAL" -> {
                    BigDecimal d = new BigDecimal(v);
                    BizException.check(d.signum() >= 0 && d.scale() <= 2 && d.precision() - d.scale() <= 10,
                            ErrorCode.SYS_BAD_REQUEST, "请输入不小于 0、最多两位小数的金额");
                    return d.setScale(2).toPlainString();
                }
                case "DURATION" -> {
                    Duration d = Duration.parse(v.toUpperCase());
                    BizException.check(!d.isNegative() && !d.isZero() && d.compareTo(Duration.ofDays(365)) <= 0,
                            ErrorCode.SYS_BAD_REQUEST, "时长必须大于 0 且不超过 365 天");
                    return d.toString();
                }
                case "TIME" -> {
                    BizException.check(v.matches("^[0-9]{2}:[0-9]{2}$"), ErrorCode.SYS_BAD_REQUEST, "时间格式为 HH:mm，例如 08:00");
                    return LocalTime.parse(v).toString();
                }
                case "BOOL" -> {
                    BizException.check(v.equalsIgnoreCase("true") || v.equalsIgnoreCase("false"), ErrorCode.SYS_BAD_REQUEST, "只能是 true 或 false");
                    return v.toLowerCase();
                }
                default -> {
                    return v;
                }
            }
        } catch (NumberFormatException | DateTimeParseException | ArithmeticException e) {
            throw new BizException(ErrorCode.SYS_BAD_REQUEST, switch (type) {
                case "INT" -> "请输入整数";
                case "DECIMAL" -> "请输入数字，最多两位小数";
                case "DURATION" -> "时长格式不正确";
                default -> "时间格式为 HH:mm，例如 08:00";
            });
        }
    }
}
