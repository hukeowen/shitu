package com.shitu.app.ops;

import com.shitu.common.api.ApiResponse;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.common.util.Rows;
import com.shitu.framework.audit.AuditLogger;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * 法定节假日日历（D-23）：账单异议期按「工作日」计算，周末自动跳过，法定假日与调休上班日要在这里维护。
 * 每年国务院公布下一年安排后录入一次；没录入的年份只按周末计算。
 */
@Tag(name = "平台中台 · 节假日")
@RestController
@RequestMapping("/api/v1/ops/holidays")
public class OpsHolidayController {

    public record Item(@NotNull(message = "请填写日期") LocalDate date, @NotNull Boolean workday,
                       @NotBlank(message = "请填写名称") @Size(max = 32) String name) {
    }

    public record BatchRequest(@NotEmpty(message = "至少填写一天") @Size(max = 100) List<@Valid Item> items) {
    }

    private final JdbcTemplate jdbc;
    private final AuditLogger audit;
    private final Clock clock;

    public OpsHolidayController(JdbcTemplate jdbc, AuditLogger audit, Clock clock) {
        this.jdbc = jdbc;
        this.audit = audit;
        this.clock = clock;
    }

    @Operation(summary = "某一年的节假日与调休上班日")
    @PreAuthorize("hasAnyRole('SUPER','FINANCE','OPERATOR')")
    @GetMapping
    public ApiResponse<List<Map<String, Object>>> list(@RequestParam(required = false) Integer year) {
        int y = year == null ? LocalDate.now(clock).getYear() : year;
        BizException.check(y >= 2020 && y <= 2100, ErrorCode.SYS_BAD_REQUEST, "年份不正确");
        return ApiResponse.ok(Rows.camel(jdbc.queryForList("SELECT holiday_date, is_workday, name FROM holiday "
                + "WHERE holiday_date BETWEEN ? AND ? ORDER BY holiday_date", LocalDate.of(y, 1, 1), LocalDate.of(y, 12, 31))));
    }

    @Operation(summary = "批量录入 / 更新（同一天重复录入以最后一次为准）")
    @PreAuthorize("hasAnyRole('SUPER','FINANCE')")
    @PostMapping
    @Transactional
    public ApiResponse<Integer> save(@Valid @RequestBody BatchRequest req) {
        for (Item it : req.items()) {
            boolean weekend = it.date().getDayOfWeek() == DayOfWeek.SATURDAY || it.date().getDayOfWeek() == DayOfWeek.SUNDAY;
            // 只有两种有意义的记录：工作日放假、周末上班。其余组合不改变计算结果，多半是录错了
            BizException.check(it.workday() == weekend, ErrorCode.SYS_BAD_REQUEST,
                    it.date() + (it.workday() ? " 本来就是工作日，不需要录入为调休上班" : " 本来就是周末，不需要录入为放假"));
            jdbc.update("INSERT INTO holiday (holiday_date, is_workday, name) VALUES (?, ?, ?) "
                    + "ON DUPLICATE KEY UPDATE is_workday = VALUES(is_workday), name = VALUES(name)", it.date(), it.workday(), it.name().trim());
        }
        audit.log("HOLIDAY_SAVE", "HOLIDAY", req.items().get(0).date().toString(), Map.of("count", req.items().size()));
        return ApiResponse.ok(req.items().size());
    }

    @Operation(summary = "删除一天")
    @PreAuthorize("hasAnyRole('SUPER','FINANCE')")
    @DeleteMapping("/{date}")
    public ApiResponse<Void> delete(@PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        BizException.check(jdbc.update("DELETE FROM holiday WHERE holiday_date = ?", date) == 1, ErrorCode.SYS_NOT_FOUND);
        audit.log("HOLIDAY_DELETE", "HOLIDAY", date.toString(), Map.of());
        return ApiResponse.ok(null);
    }
}
