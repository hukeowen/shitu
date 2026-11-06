package com.shitu.app.kb;

import com.shitu.common.api.ApiResponse;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.framework.security.CurrentUser;
import com.shitu.tenant.scope.DataScope;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/** 岗位知识库：公司维护（T-305，老板 / 项目经理）与求职者岗位问答（C-409）。 */
@Tag(name = "岗位知识库")
@RestController
public class KnowledgeController {

    private final KnowledgeService kb;
    private final DataScope scope;
    private final AuditLogger audit;

    public KnowledgeController(KnowledgeService kb, DataScope scope, AuditLogger audit) {
        this.kb = kb;
        this.scope = scope;
        this.audit = audit;
    }

    public record AnswerRequest(String question, String answer) {
    }

    @Operation(summary = "知识库条目列表")
    @PreAuthorize("hasAnyRole('OWNER','PM')")
    @GetMapping("/api/v1/tenant/kb")
    public ApiResponse<List<Map<String, Object>>> list(@RequestParam(required = false) String projectId,
                                                      @RequestParam(required = false) String jobId,
                                                      @RequestParam(required = false) String keyword) {
        AuthPrincipal p = CurrentUser.get();
        return ApiResponse.ok(kb.list(p.companyId(), visible(p), projectId, jobId, keyword));
    }

    @Operation(summary = "新增条目（不选项目 / 岗位 = 公司通用，仅老板可建）")
    @PreAuthorize("hasAnyRole('OWNER','PM')")
    @PostMapping("/api/v1/tenant/kb")
    public ApiResponse<Long> create(@RequestBody KnowledgeService.EntryRequest req) {
        AuthPrincipal p = CurrentUser.get();
        String[] s = kb.resolveScope(p.companyId(), req.projectId(), req.jobId());
        checkWritable(p, s[0]);
        long id = kb.create(p.companyId(), p.subjectId(), s[0], s[1], req.question(), req.answer());
        audit.log("KB_ENTRY_CREATE", "kb_entry", String.valueOf(id), Map.of("question", req.question()));
        return ApiResponse.ok(id);
    }

    @Operation(summary = "修改条目")
    @PreAuthorize("hasAnyRole('OWNER','PM')")
    @PutMapping("/api/v1/tenant/kb/{id}")
    public ApiResponse<Void> update(@PathVariable long id, @RequestBody AnswerRequest req) {
        AuthPrincipal p = CurrentUser.get();
        checkWritable(p, (String) kb.entry(p.companyId(), id).get("project_id"));
        kb.update(p.companyId(), p.subjectId(), id, req.question(), req.answer());
        return ApiResponse.ok(null);
    }

    @Operation(summary = "删除条目")
    @PreAuthorize("hasAnyRole('OWNER','PM')")
    @DeleteMapping("/api/v1/tenant/kb/{id}")
    public ApiResponse<Void> delete(@PathVariable long id) {
        AuthPrincipal p = CurrentUser.get();
        checkWritable(p, (String) kb.entry(p.companyId(), id).get("project_id"));
        kb.delete(p.companyId(), p.subjectId(), id);
        audit.log("KB_ENTRY_DELETE", "kb_entry", String.valueOf(id), Map.of());
        return ApiResponse.ok(null);
    }

    @Operation(summary = "求职者提问未命中、待补充答案的问题")
    @PreAuthorize("hasAnyRole('OWNER','PM')")
    @GetMapping("/api/v1/tenant/kb/pending")
    public ApiResponse<List<Map<String, Object>>> pending() {
        AuthPrincipal p = CurrentUser.get();
        return ApiResponse.ok(kb.pending(p.companyId(), visible(p)));
    }

    @Operation(summary = "补充答案（写入岗位级条目并通知提问人）")
    @PreAuthorize("hasAnyRole('OWNER','PM')")
    @PostMapping("/api/v1/tenant/kb/pending/{id}/answer")
    public ApiResponse<Long> answer(@PathVariable long id, @RequestBody AnswerRequest req) {
        AuthPrincipal p = CurrentUser.get();
        scope.checkProject(p, (String) kb.pendingItem(p.companyId(), id).get("project_id"));
        return ApiResponse.ok(kb.answerPending(p.companyId(), p.subjectId(), id, req.question(), req.answer()));
    }

    @Operation(summary = "忽略待补充问题（无意义 / 与岗位无关）")
    @PreAuthorize("hasAnyRole('OWNER','PM')")
    @PostMapping("/api/v1/tenant/kb/pending/{id}/ignore")
    public ApiResponse<Integer> ignore(@PathVariable long id) {
        AuthPrincipal p = CurrentUser.get();
        scope.checkProject(p, (String) kb.pendingItem(p.companyId(), id).get("project_id"));
        return ApiResponse.ok(kb.ignorePending(p.companyId(), id));
    }

    @Operation(summary = "C-409 岗位问答：命中知识库直接回答，未命中转人工")
    @PostMapping("/api/v1/seeker/jobs/{jobId}/ask")
    public ApiResponse<Map<String, Object>> ask(@PathVariable String jobId, @RequestBody AnswerRequest req) {
        return ApiResponse.ok(KnowledgeService.view(kb.ask(CurrentUser.subjectId(), jobId, req.question())));
    }

    /** null = 全公司；否则为负责项目。 */
    private java.util.Collection<String> visible(AuthPrincipal p) {
        DataScope.Scope s = scope.of(p);
        return s.all() ? null : s.projectIds();
    }

    private void checkWritable(AuthPrincipal p, String projectId) {
        if (projectId == null) {
            BizException.check(p.hasAnyRole("OWNER"), ErrorCode.SYS_FORBIDDEN, "公司通用条目只有老板可以维护");
        } else {
            scope.checkProject(p, projectId);
        }
    }
}
