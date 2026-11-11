package com.shitu.app.support;

import com.shitu.common.api.ApiResponse;
import com.shitu.framework.security.CurrentUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
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

/** 问题反馈（C-508）与工资申诉（C-702）的三端接口。 */
public final class SupportControllers {

    private SupportControllers() {
    }

    public record FeedbackRequest(@NotBlank(message = "请选择问题类型") String category,
                                  @NotBlank(message = "请描述你遇到的问题") String content, String contact) {
    }

    public record AppealRequest(String itemCode, @NotBlank(message = "请说明问题") String content) {
    }

    public record ReplyRequest(String reply, Boolean close) {
    }

    public record HandleRequest(boolean accept, @NotBlank(message = "请填写处理说明") String reply) {
    }

    @Tag(name = "C 端 · 问题反馈与工资申诉")
    @RestController
    @RequestMapping("/api/v1/seeker")
    public static class Seeker {

        private final SupportService support;

        public Seeker(SupportService support) {
            this.support = support;
        }

        @Operation(summary = "提交问题反馈（C-508）")
        @PostMapping("/feedback")
        public ApiResponse<Long> submit(@Valid @RequestBody FeedbackRequest req) {
            return ApiResponse.ok(support.submitFeedback(CurrentUser.subjectId(), req.category(), req.content(), req.contact()));
        }

        @Operation(summary = "我的反馈记录")
        @GetMapping("/feedback")
        public ApiResponse<List<Map<String, Object>>> mine() {
            return ApiResponse.ok(support.myFeedback(CurrentUser.subjectId()));
        }

        @Operation(summary = "对工资条提出申诉（C-702）")
        @PostMapping("/payslips/{payslipId}/appeals")
        public ApiResponse<Long> appeal(@PathVariable String payslipId, @Valid @RequestBody AppealRequest req) {
            return ApiResponse.ok(support.appealPayslip(CurrentUser.subjectId(), payslipId, req.itemCode(), req.content()));
        }

        @Operation(summary = "这张工资条的申诉记录")
        @GetMapping("/payslips/{payslipId}/appeals")
        public ApiResponse<List<Map<String, Object>>> appeals(@PathVariable String payslipId) {
            return ApiResponse.ok(support.myPayslipAppeals(CurrentUser.subjectId(), payslipId));
        }
    }

    @Tag(name = "公司后台 · 工资申诉")
    @RestController
    @RequestMapping("/api/v1/tenant/payroll/appeals")
    public static class Tenant {

        private final SupportService support;

        public Tenant(SupportService support) {
            this.support = support;
        }

        @Operation(summary = "工资申诉列表（项目经理 / 老板）")
        @PreAuthorize("hasAnyRole('OWNER','PM')")
        @GetMapping
        public ApiResponse<List<Map<String, Object>>> list(@RequestParam(required = false) String status) {
            return ApiResponse.ok(support.payslipAppeals(CurrentUser.companyId(), status));
        }

        @Operation(summary = "处理工资申诉")
        @PreAuthorize("hasAnyRole('OWNER','PM')")
        @PostMapping("/{id}/handle")
        public ApiResponse<Void> handle(@PathVariable long id, @Valid @RequestBody HandleRequest req) {
            support.handlePayslipAppeal(CurrentUser.companyId(), CurrentUser.subjectId(), id, req.accept(), req.reply());
            return ApiResponse.ok(null);
        }
    }

    @Tag(name = "运营中台 · 问题反馈")
    @RestController
    @RequestMapping("/api/v1/ops/feedback")
    public static class Ops {

        private final SupportService support;

        public Ops(SupportService support) {
            this.support = support;
        }

        @Operation(summary = "反馈工单列表")
        @PreAuthorize("hasAnyRole('SUPER','OPERATOR')")
        @GetMapping
        public ApiResponse<List<Map<String, Object>>> list(@RequestParam(required = false) String status) {
            return ApiResponse.ok(support.feedbackQueue(status));
        }

        @Operation(summary = "回复 / 关闭反馈")
        @PreAuthorize("hasAnyRole('SUPER','OPERATOR')")
        @PostMapping("/{id}/reply")
        public ApiResponse<Void> reply(@PathVariable long id, @RequestBody ReplyRequest req) {
            support.replyFeedback(CurrentUser.subjectId(), id, req.reply(), Boolean.TRUE.equals(req.close()));
            return ApiResponse.ok(null);
        }
    }
}
