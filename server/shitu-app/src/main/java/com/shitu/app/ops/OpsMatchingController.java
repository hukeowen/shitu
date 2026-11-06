package com.shitu.app.ops;

import com.shitu.common.api.ApiResponse;
import com.shitu.framework.security.CurrentUser;
import com.shitu.matching.quiz.QuizService;
import com.shitu.matching.session.MatchService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** AI 问薪题库配置 P-12（版本化、草稿 / 发布 / 回滚）与匹配快照查询。 */
@Tag(name = "平台中台 · 题库与匹配")
@RestController
@RequestMapping("/api/v1/ops")
public class OpsMatchingController {

    public record DraftRequest(String name) {
    }

    public record SaveRequest(String name, @NotEmpty(message = "至少一道题") List<QuizService.QuestionView> questions) {
    }

    private final QuizService quiz;
    private final MatchService matching;

    public OpsMatchingController(QuizService quiz, MatchService matching) {
        this.quiz = quiz;
        this.matching = matching;
    }

    @Operation(summary = "题库版本列表")
    @PreAuthorize("hasAnyRole('SUPER','OPERATOR')")
    @GetMapping("/quiz/versions")
    public ApiResponse<List<QuizService.QuizView>> versions() {
        return ApiResponse.ok(quiz.list());
    }

    @Operation(summary = "题库版本详情")
    @PreAuthorize("hasAnyRole('SUPER','OPERATOR')")
    @GetMapping("/quiz/versions/{versionId}")
    public ApiResponse<QuizService.QuizView> version(@PathVariable int versionId) {
        return ApiResponse.ok(quiz.get(versionId));
    }

    @Operation(summary = "从生效版本复制草稿（已有草稿时返回该草稿）")
    @PreAuthorize("hasAnyRole('SUPER','OPERATOR')")
    @PostMapping("/quiz/drafts")
    public ApiResponse<QuizService.QuizView> draft(@RequestBody(required = false) DraftRequest req) {
        return ApiResponse.ok(quiz.createDraft(req == null ? null : req.name()));
    }

    @Operation(summary = "保存草稿（整体替换题目）")
    @PreAuthorize("hasAnyRole('SUPER','OPERATOR')")
    @PutMapping("/quiz/versions/{versionId}")
    public ApiResponse<QuizService.QuizView> save(@PathVariable int versionId, @Valid @RequestBody SaveRequest req) {
        return ApiResponse.ok(quiz.saveDraft(versionId, req.name(), req.questions()));
    }

    @Operation(summary = "发布草稿 / 回滚到归档版本（原生效版本归档）")
    @PreAuthorize("hasRole('SUPER')")
    @PostMapping("/quiz/versions/{versionId}/publish")
    public ApiResponse<QuizService.QuizView> publish(@PathVariable int versionId) {
        return ApiResponse.ok(quiz.publish(versionId, CurrentUser.subjectId()));
    }

    @Operation(summary = "匹配快照（答案、画像、版本、各岗位因子得分，用于解释与回放）")
    @PreAuthorize("hasAnyRole('SUPER','RISK','OPERATOR')")
    @GetMapping("/match-sessions/{sessionId}")
    public ApiResponse<MatchService.Snapshot> snapshot(@PathVariable String sessionId) {
        return ApiResponse.ok(matching.snapshot(sessionId));
    }
}
