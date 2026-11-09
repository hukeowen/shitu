package com.shitu.app.seeker;

import com.shitu.common.api.ApiResponse;
import com.shitu.common.api.PageResult;
import com.shitu.common.enums.ApplicationStatus;
import com.shitu.framework.security.CurrentUser;
import com.shitu.lifecycle.seeker.ApplicationService;
import com.shitu.lifecycle.seeker.DisclaimerService;
import com.shitu.lifecycle.seeker.KycService;
import com.shitu.matching.domain.ProfileBuilder;
import com.shitu.matching.quiz.QuizService;
import com.shitu.matching.session.MatchService;
import com.shitu.notify.NotificationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.util.List;

/** C 端求职主流程：问薪、岗位详情、告知书、实名、报名、我的报备、消息中心。 */
@Tag(name = "C 端 · 问薪与报名")
@RestController
@RequestMapping("/api/v1/seeker")
public class SeekerJourneyController {

    public record MatchRequest(@NotEmpty(message = "请先回答问题") List<ProfileBuilder.Answer> answers,
                               BigDecimal lng, BigDecimal lat) {
    }

    public record AgreeRequest(@NotBlank String version) {
    }

    public record KycRequest(@NotBlank(message = "请输入真实姓名") String realName,
                             @NotBlank(message = "请输入身份证号") String idCard,
                             @NotBlank(message = "请再次输入身份证号") String idCardConfirm) {
    }

    public record ApplyRequest(@NotBlank String jobId) {
    }

    public record ReadRequest(List<Long> ids) {
    }

    private final SeekerJourneyFacade journey;
    private final QuizService quiz;
    private final DisclaimerService disclaimer;
    private final KycService kyc;
    private final ApplicationService applications;
    private final NotificationService notifications;
    private final com.shitu.lifecycle.employment.EmploymentQueryService employments;
    private final com.shitu.circulation.BrokerService brokers;
    private final com.shitu.advance.service.AdvanceService advances;
    private final com.shitu.advance.service.PayrollService payroll;
    private final com.shitu.risk.ComplaintService complaints;
    private final com.shitu.tenant.company.CompanyService companies;

    public SeekerJourneyController(SeekerJourneyFacade journey, QuizService quiz, DisclaimerService disclaimer,
                                   KycService kyc, ApplicationService applications, NotificationService notifications,
                                   com.shitu.lifecycle.employment.EmploymentQueryService employments,
                                   com.shitu.circulation.BrokerService brokers, com.shitu.tenant.company.CompanyService companies,
                                   com.shitu.advance.service.AdvanceService advances, com.shitu.advance.service.PayrollService payroll,
                                   com.shitu.risk.ComplaintService complaints) {
        this.journey = journey;
        this.quiz = quiz;
        this.disclaimer = disclaimer;
        this.kyc = kyc;
        this.applications = applications;
        this.notifications = notifications;
        this.employments = employments;
        this.brokers = brokers;
        this.advances = advances;
        this.payroll = payroll;
        this.complaints = complaints;
        this.companies = companies;
    }

    @Operation(summary = "当前生效题库（C-302）")
    @GetMapping("/quiz")
    public ApiResponse<QuizService.QuizView> quiz() {
        return ApiResponse.ok(quiz.active());
    }

    @Operation(summary = "提交答案并匹配（报名锁定期返回 LC_4003）")
    @PostMapping("/match")
    public ApiResponse<MatchService.MatchOutcome> match(@Valid @RequestBody MatchRequest req) {
        return ApiResponse.ok(journey.match(CurrentUser.subjectId(), req.answers(), req.lng(), req.lat()));
    }

    @Operation(summary = "最近一次匹配结果（没有则 data 为空）")
    @GetMapping("/match/latest")
    public ApiResponse<MatchService.MatchOutcome> latest() {
        return ApiResponse.ok(journey.latest(CurrentUser.subjectId()).orElse(null));
    }

    @Operation(summary = "岗位详情（仅限最近一次匹配结果中的岗位，C-401）")
    @GetMapping("/jobs/{jobId}")
    public ApiResponse<SeekerJourneyFacade.JobDetail> job(@PathVariable String jobId) {
        return ApiResponse.ok(journey.job(CurrentUser.subjectId(), jobId));
    }

    @Operation(summary = "求职告知书（含是否已同意当前版本）")
    @GetMapping("/disclaimer")
    public ApiResponse<DisclaimerService.Disclaimer> disclaimer() {
        return ApiResponse.ok(disclaimer.current(CurrentUser.subjectId()));
    }

    @Operation(summary = "同意告知书（记录时间、IP、版本）")
    @PostMapping("/disclaimer/agree")
    public ApiResponse<DisclaimerService.Disclaimer> agree(@Valid @RequestBody AgreeRequest req) {
        String uid = CurrentUser.subjectId();
        disclaimer.agree(uid, req.version());
        return ApiResponse.ok(disclaimer.current(uid));
    }

    @Operation(summary = "实名状态")
    @GetMapping("/kyc")
    public ApiResponse<KycService.KycView> kycStatus() {
        return ApiResponse.ok(kyc.view(CurrentUser.subjectId()));
    }

    @Operation(summary = "实名认证（姓名 + 身份证两次输入 + 二要素核验；通过后不可修改）")
    @PostMapping("/kyc")
    public ApiResponse<KycService.KycView> kyc(@Valid @RequestBody KycRequest req) {
        return ApiResponse.ok(kyc.submit(CurrentUser.subjectId(), req.realName(), req.idCard(), req.idCardConfirm()));
    }

    @Operation(summary = "报名（C-407）")
    @PostMapping("/applications")
    public ApiResponse<SeekerJourneyFacade.ApplyResult> apply(@Valid @RequestBody ApplyRequest req) {
        return ApiResponse.ok(journey.apply(CurrentUser.subjectId(), req.jobId()));
    }

    @Operation(summary = "我的报备（C-501，只读）")
    @GetMapping("/applications")
    public ApiResponse<List<ApplicationService.MyApplication>> myApplications(@RequestParam(required = false) ApplicationStatus status) {
        return ApiResponse.ok(applications.mine(CurrentUser.subjectId(), status));
    }

    @Operation(summary = "消息中心（C-507）")
    @GetMapping("/messages")
    public ApiResponse<PageResult<NotificationService.InboxItem>> messages(@RequestParam(required = false) Boolean unreadOnly,
                                                                         @RequestParam(required = false) Integer page,
                                                                         @RequestParam(required = false) Integer pageSize) {
        return ApiResponse.ok(notifications.inbox(NotificationService.Recipient.seeker(CurrentUser.subjectId()),
                unreadOnly, page, pageSize));
    }

    @Operation(summary = "未读消息数（角标）")
    @GetMapping("/messages/unread-count")
    public ApiResponse<Long> unread() {
        return ApiResponse.ok(notifications.unread(NotificationService.Recipient.seeker(CurrentUser.subjectId())));
    }

    @Operation(summary = "标记已读（ids 为空 = 全部）")
    @PostMapping("/messages/read")
    public ApiResponse<Integer> read(@RequestBody(required = false) ReadRequest req) {
        return ApiResponse.ok(notifications.markRead(NotificationService.Recipient.seeker(CurrentUser.subjectId()),
                req == null ? null : req.ids()));
    }

    @Operation(summary = "我的工作（C-505：当前在岗；已离职返回最近一段；没有返回空）")
    @GetMapping("/work")
    public ApiResponse<com.shitu.lifecycle.employment.EmploymentQueryService.MyWork> work() {
        return ApiResponse.ok(employments.myWork(CurrentUser.subjectId()).orElse(null));
    }

    public record DecisionRequest(@jakarta.validation.constraints.NotNull Boolean accept) {
    }

    @Operation(summary = "专属顾问（人才经纪人）推荐给我的岗位（T-203）")
    @GetMapping("/recommendations")
    public ApiResponse<List<com.shitu.circulation.BrokerService.MyRecommendation>> recommendations() {
        return ApiResponse.ok(brokers.myRecommendations(CurrentUser.subjectId()));
    }

    @Operation(summary = "接受 / 不考虑推荐（接受后在岗位详情页走正常报名流程）")
    @PostMapping("/recommendations/{id}/decision")
    public ApiResponse<Void> decide(@PathVariable long id, @Valid @RequestBody DecisionRequest req) {
        brokers.decide(CurrentUser.subjectId(), id, req.accept());
        return ApiResponse.ok(null);
    }

    @Operation(summary = "预支额度（C-601）：准入结果与原因、在岗日进度、本月机会、欠款")
    @GetMapping("/advance/quota")
    public ApiResponse<com.shitu.advance.service.AdvanceService.Quota> advanceQuota() {
        return ApiResponse.ok(advances.quota(CurrentUser.subjectId()));
    }

    @Operation(summary = "发起预支（C-602，固定金额；不满足条件返回 ADV_4001 及原因）")
    @PostMapping("/advance")
    public ApiResponse<String> applyAdvance() {
        return ApiResponse.ok(advances.apply(CurrentUser.subjectId()));
    }

    @Operation(summary = "我的预支记录与审批进度（C-603 / C-604）")
    @GetMapping("/advance")
    public ApiResponse<List<com.shitu.advance.service.AdvanceService.AdvanceRow>> myAdvances() {
        return ApiResponse.ok(advances.mine(CurrentUser.subjectId()));
    }

    @Operation(summary = "欠款流水（拨款 / 工资抵扣）")
    @GetMapping("/advance/debt-log")
    public ApiResponse<List<com.shitu.advance.service.AdvanceService.DebtLogEntry>> debtLog() {
        return ApiResponse.ok(advances.debtLog(CurrentUser.subjectId()));
    }

    @Operation(summary = "单笔预支详情：审批节点与拨款 / 抵扣流水（C-603）")
    @GetMapping("/advance/{advanceId}")
    public ApiResponse<com.shitu.advance.service.AdvanceService.AdvanceDetail> advanceDetail(@PathVariable String advanceId) {
        return ApiResponse.ok(advances.detail(CurrentUser.subjectId(), advanceId));
    }

    @Operation(summary = "单张工资条（S-42）")
    @GetMapping("/payslips/{payslipId}")
    public ApiResponse<com.shitu.advance.service.PayrollService.Payslip> payslip(@PathVariable String payslipId) {
        return ApiResponse.ok(payroll.mine(CurrentUser.subjectId()).stream().filter(x -> x.payslipId().equals(payslipId)).findFirst()
                .orElseThrow(() -> new com.shitu.common.exception.BizException(com.shitu.common.exception.ErrorCode.SYS_NOT_FOUND)));
    }

    @Operation(summary = "我的工资条（C-701）")
    @GetMapping("/payslips")
    public ApiResponse<List<com.shitu.advance.service.PayrollService.Payslip>> payslips() {
        return ApiResponse.ok(payroll.mine(CurrentUser.subjectId()));
    }

    public record ComplaintRequest(@NotBlank String jobId,
                                   @NotBlank(message = "请选择投诉类型") String category, String content) {
    }

    @Operation(summary = "岗位投诉（C-402）：FULL_STILL_HIRING 已满仍在招 / INFO_FALSE 信息不实 / MISMATCH_AFTER_INTERVIEW 面试后不符")
    @PostMapping("/complaints")
    public ApiResponse<Long> complain(@Valid @RequestBody ComplaintRequest req) {
        return ApiResponse.ok(complaints.submit(CurrentUser.subjectId(), req.jobId(), req.category(), req.content()));
    }
}
