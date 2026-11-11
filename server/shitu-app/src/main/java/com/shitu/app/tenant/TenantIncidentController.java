package com.shitu.app.tenant;

import com.shitu.common.api.ApiResponse;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.common.util.Rows;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.outbox.OutboxWriter;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.framework.security.CurrentUser;
import com.shitu.tenant.scope.DataScope;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Clock;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 工伤紧急异常（T-405）：驻场 / 项目经理上报 → 立刻站内信 + 短信通知老板和该项目的项目经理 → 处理完登记结论。
 * 这里只做「第一时间让负责人知道」和留痕，不替代工伤认定与保险理赔流程。
 * JDBC 不经过租户拦截器，语句显式带 company_id；驻场 / 项目经理只能看到自己负责的项目。
 */
@Tag(name = "公司后台 · 工伤上报")
@RestController
@RequestMapping("/api/v1/tenant/incidents")
public class TenantIncidentController {

    static final Set<String> SEVERITIES = Set.of("MINOR", "SERIOUS", "CRITICAL");

    public record ReportRequest(@NotBlank(message = "请选择项目") String projectId,
                                @NotBlank(message = "请填写受伤人员姓名") @Size(max = 30) String personName,
                                @NotBlank(message = "请选择伤情") String severity,
                                @NotNull(message = "请填写发生时间") LocalDateTime occurredAt,
                                @NotBlank(message = "请描述事发经过") @Size(min = 5, max = 500, message = "请用 5–500 个字描述事发经过与当前处置") String detail) {
    }

    public record CloseRequest(@NotBlank(message = "请填写处理结论") @Size(min = 2, max = 500) String note) {
    }

    private final JdbcTemplate jdbc;
    private final DataScope scope;
    private final OutboxWriter outbox;
    private final AuditLogger audit;
    private final Clock clock;

    public TenantIncidentController(JdbcTemplate jdbc, DataScope scope, OutboxWriter outbox, AuditLogger audit, Clock clock) {
        this.jdbc = jdbc;
        this.scope = scope;
        this.outbox = outbox;
        this.audit = audit;
        this.clock = clock;
    }

    @Operation(summary = "上报工伤（驻场 / 项目经理）")
    @PreAuthorize("hasAnyRole('SITE','PM')")
    @PostMapping
    @Transactional
    public ApiResponse<Long> report(@Valid @RequestBody ReportRequest req) {
        AuthPrincipal p = CurrentUser.get();
        String companyId = p.companyId();
        BizException.check(SEVERITIES.contains(req.severity()), ErrorCode.SYS_BAD_REQUEST, "请选择伤情");
        List<String> project = jdbc.queryForList("SELECT name FROM project WHERE project_id = ? AND company_id = ?", String.class,
                req.projectId(), companyId);
        BizException.check(!project.isEmpty(), ErrorCode.SYS_NOT_FOUND, "项目不存在");
        scope.checkProject(p, req.projectId());
        LocalDateTime now = LocalDateTime.now(clock);
        BizException.check(!req.occurredAt().isAfter(now.plusMinutes(5)), ErrorCode.SYS_BAD_REQUEST, "发生时间不能晚于现在");
        BizException.check(req.occurredAt().isAfter(now.minusDays(30)), ErrorCode.SYS_BAD_REQUEST, "只能上报 30 天内发生的事件");
        jdbc.update("INSERT INTO incident (company_id, project_id, person_name, severity, occurred_at, detail, reported_by) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?)", companyId, req.projectId(), req.personName().trim(), req.severity(),
                req.occurredAt(), req.detail().trim(), p.subjectId());
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        String label = switch (req.severity()) {
            case "CRITICAL" -> "危重";
            case "SERIOUS" -> "需送医";
            default -> "轻伤";
        };
        outbox.publish("INJURY_REPORTED", "INCIDENT", String.valueOf(id), Map.of("companyId", companyId, "projectId", req.projectId(),
                "projectName", project.get(0), "reportedBy", p.subjectId(),
                "detail", req.personName().trim() + "（" + label + "）" + abbreviate(req.detail().trim())));
        audit.log("INCIDENT_REPORT", "INCIDENT", String.valueOf(id), Map.of("projectId", req.projectId(), "severity", req.severity()));
        return ApiResponse.ok(id);
    }

    @Operation(summary = "工伤记录（老板看全部；项目经理 / 驻场看自己负责的项目）")
    @PreAuthorize("hasAnyRole('OWNER','PM','SITE')")
    @GetMapping
    public ApiResponse<List<Map<String, Object>>> list(@RequestParam(required = false) String status) {
        AuthPrincipal p = CurrentUser.get();
        DataScope.Scope s = scope.of(p);
        List<Object> args = new ArrayList<>(List.of(p.companyId()));
        StringBuilder sql = new StringBuilder("SELECT i.id, i.project_id, pr.name AS project_name, i.person_name, i.severity, i.occurred_at, "
                + "i.detail, i.status, i.handle_note, i.created_at, i.closed_at, r.name AS reported_by_name, c.name AS closed_by_name "
                + "FROM incident i JOIN project pr ON pr.project_id = i.project_id AND pr.company_id = i.company_id "
                + "LEFT JOIN member r ON r.member_id = i.reported_by LEFT JOIN member c ON c.member_id = i.closed_by "
                + "WHERE i.company_id = ?");
        if (!s.all()) {
            if (s.projectIds().isEmpty()) {
                return ApiResponse.ok(List.of());
            }
            sql.append(" AND i.project_id IN (").append("?,".repeat(s.projectIds().size()));
            sql.setLength(sql.length() - 1);
            sql.append(")");
            args.addAll(s.projectIds());
        }
        if (status != null && !status.isBlank()) {
            sql.append(" AND i.status = ?");
            args.add(status);
        }
        sql.append(" ORDER BY i.status = 'OPEN' DESC, i.id DESC LIMIT 200");
        return ApiResponse.ok(Rows.camel(jdbc.queryForList(sql.toString(), args.toArray())));
    }

    @Operation(summary = "登记处理结论并结案（老板 / 项目经理）")
    @PreAuthorize("hasAnyRole('OWNER','PM')")
    @PostMapping("/{id}/close")
    @Transactional
    public ApiResponse<Void> close(@PathVariable long id, @Valid @RequestBody CloseRequest req) {
        AuthPrincipal p = CurrentUser.get();
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT project_id, status FROM incident WHERE id = ? AND company_id = ? FOR UPDATE",
                id, p.companyId());
        BizException.check(!rows.isEmpty(), ErrorCode.SYS_NOT_FOUND);
        scope.checkProject(p, (String) rows.get(0).get("project_id"));
        BizException.check("OPEN".equals(rows.get(0).get("status")), ErrorCode.SYS_CONFLICT, "该记录已结案");
        jdbc.update("UPDATE incident SET status = 'CLOSED', handle_note = ?, closed_by = ?, closed_at = ? WHERE id = ?",
                req.note().trim(), p.subjectId(), LocalDateTime.now(clock), id);
        audit.log("INCIDENT_CLOSE", "INCIDENT", String.valueOf(id), Map.of("note", req.note().trim()));
        return ApiResponse.ok(null);
    }

    private static String abbreviate(String s) {
        return s.length() <= 60 ? s : s.substring(0, 60) + "…";
    }
}
