package com.shitu.app.ops;

import com.shitu.common.util.Rows;
import com.shitu.common.api.ApiResponse;
import com.shitu.framework.security.CurrentUser;
import com.shitu.risk.ComplaintService;
import com.shitu.risk.CreditService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/** 平台中台：投诉管理 P-06、诚信与处罚 P-07、降权与限流 P-05（岗位真实权重，仅平台可见 R-14）。 */
@Tag(name = "平台中台 · 风控")
@RestController
@RequestMapping("/api/v1/ops")
@PreAuthorize("hasAnyRole('SUPER','RISK')")
public class OpsRiskController {

    public record HandleRequest(@NotNull Boolean verified, @NotBlank(message = "请填写处理说明") String remark) {
    }

    public record CreditRequest(@NotNull @Min(-100) @Max(100) Integer delta, @NotBlank(message = "人工调分必须填写原因") String remark) {
    }

    public record PenaltyRequest(@NotNull @Min(1) @Max(3) Integer level, @NotBlank(message = "请填写处罚原因") String reason) {
    }

    private final ComplaintService complaints;
    private final CreditService credit;
    private final JdbcTemplate jdbc;

    public OpsRiskController(ComplaintService complaints, CreditService credit, JdbcTemplate jdbc) {
        this.complaints = complaints;
        this.credit = credit;
        this.jdbc = jdbc;
    }

    @Operation(summary = "投诉列表")
    @GetMapping("/complaints")
    public ApiResponse<List<Map<String, Object>>> complaints(@RequestParam(required = false) String status) {
        return ApiResponse.ok(complaints.list(status));
    }

    @Operation(summary = "核实 / 驳回投诉（同岗属实满 3 次自动下架并扣 10 分）")
    @PostMapping("/complaints/{id}/handle")
    public ApiResponse<Void> handle(@PathVariable long id, @Valid @RequestBody HandleRequest req) {
        complaints.handle(id, req.verified(), req.remark(), CurrentUser.subjectId());
        return ApiResponse.ok(null);
    }

    @Operation(summary = "公司诚信分记录与处罚记录")
    @GetMapping("/companies/{companyId}/credit")
    public ApiResponse<Map<String, Object>> creditOf(@PathVariable String companyId) {
        Map<String, Object> c = jdbc.queryForMap("SELECT company_id, name, credit_score, penalty_level, penalty_until, fee_rights_revoked, "
                + "company_status FROM company WHERE company_id = ?", companyId);
        return ApiResponse.ok(Map.of("company", Rows.camel(c), "logs", credit.logs(companyId), "penalties", credit.penalties(companyId)));
    }

    @Operation(summary = "人工调分（留痕）")
    @PostMapping("/companies/{companyId}/credit")
    public ApiResponse<Integer> adjust(@PathVariable String companyId, @Valid @RequestBody CreditRequest req) {
        return ApiResponse.ok(credit.adjust(companyId, req.delta(), "MANUAL", null, null, req.remark(), CurrentUser.subjectId()));
    }

    @Operation(summary = "处罚：1 警告 / 2 限流 30 天 / 3 封禁并永久取消收费服务权限")
    @PostMapping("/companies/{companyId}/penalty")
    public ApiResponse<Void> penalize(@PathVariable String companyId, @Valid @RequestBody PenaltyRequest req) {
        credit.penalize(companyId, req.level(), req.reason(), CurrentUser.subjectId());
        return ApiResponse.ok(null);
    }

    @Operation(summary = "处罚记录（全平台）")
    @GetMapping("/penalties")
    public ApiResponse<List<Map<String, Object>>> penalties() {
        return ApiResponse.ok(credit.penalties(null));
    }

    @Operation(summary = "岗位真实权重（P-05）：挂岗天数、权重、投诉属实次数、公司诚信与处罚；权重低于 0.3 标记为僵尸岗位")
    @GetMapping("/job-weights")
    public ApiResponse<List<Map<String, Object>>> weights(@RequestParam(required = false) String companyId) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT j.job_id, j.title, j.company_id, c.name AS company_name, j.match_weight, "
                + "DATEDIFF(CURRENT_DATE, DATE(COALESCE(GREATEST(j.posted_at, COALESCE(j.decay_reset_at, j.posted_at)), j.created_at))) AS posted_days, "
                + "j.quota_remaining, j.complaint_verified, c.credit_score, c.penalty_level, c.fee_rights_revoked "
                + "FROM job j JOIN company c ON c.company_id = j.company_id WHERE j.job_status = 'RECRUITING'"
                + (companyId == null ? "" : " AND j.company_id = ?") + " ORDER BY j.match_weight ASC LIMIT 500",
                companyId == null ? new Object[0] : new Object[]{companyId});
        rows.forEach(r -> r.put("zombie", ((java.math.BigDecimal) r.get("match_weight")).compareTo(new java.math.BigDecimal("0.3")) < 0));
        return ApiResponse.ok(Rows.camel(rows));
    }
}
