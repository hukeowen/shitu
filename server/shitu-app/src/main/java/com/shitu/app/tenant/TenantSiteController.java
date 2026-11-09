package com.shitu.app.tenant;

import com.shitu.common.api.ApiResponse;
import com.shitu.common.api.PageResult;
import com.shitu.common.enums.ApplicationStatus;
import com.shitu.framework.security.CurrentUser;
import com.shitu.lifecycle.seeker.ApplicationService;
import com.shitu.notify.NotificationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.util.List;

/** 驻场端 / 项目经理：工作台 M-01、待面试 M-02（知悉 → 推送面试信息）、消息。 */
@Tag(name = "驻场端 · 工作台与报名")
@RestController
@RequestMapping("/api/v1/tenant")
public class TenantSiteController {

    public record AcknowledgeRequest(@NotNull(message = "请选择面试时间") LocalDateTime interviewAt,
                                     @NotBlank(message = "请填写面试地点") String address, String routeTips,
                                     List<String> documents, String contactName, String contactPhone) {
    }

    public record ReadRequest(List<Long> ids) {
    }

    private final ApplicationService applications;
    private final NotificationService notifications;

    public TenantSiteController(ApplicationService applications, NotificationService notifications) {
        this.applications = applications;
        this.notifications = notifications;
    }

    @Operation(summary = "驻场工作台数字（M-01）")
    @PreAuthorize("hasAnyRole('SITE','PM','OWNER')")
    @GetMapping("/site/workbench")
    public ApiResponse<ApplicationService.Workbench> workbench() {
        return ApiResponse.ok(applications.workbench(CurrentUser.get()));
    }

    @Operation(summary = "私域待匹配用户（A-03：24h 窗口内需跟进；驻场看完整手机号）")
    @PreAuthorize("hasAnyRole('SITE','PM','OWNER')")
    @GetMapping("/site/private-pending")
    public ApiResponse<List<ApplicationService.PrivatePendingRow>> privatePending() {
        return ApiResponse.ok(applications.privatePending(CurrentUser.get()));
    }

    @Operation(summary = "报名列表（M-02；驻场 / 项目经理按负责项目过滤；手机号仅驻场可见）")
    @PreAuthorize("hasAnyRole('SITE','PM','OWNER')")
    @GetMapping("/applications")
    public ApiResponse<PageResult<ApplicationService.SiteApplication>> list(@RequestParam(required = false) ApplicationStatus status,
                                                                          @RequestParam(required = false) Boolean unacknowledged,
                                                                          @RequestParam(required = false) String projectId,
                                                                          @RequestParam(required = false) Integer page,
                                                                          @RequestParam(required = false) Integer pageSize,
                                                                          @RequestParam(required = false) ApplicationService.Sort sort) {
        return ApiResponse.ok(applications.forTenant(CurrentUser.get(), status, unacknowledged, projectId, page, pageSize, sort));
    }

    @Operation(summary = "报名详情")
    @PreAuthorize("hasAnyRole('SITE','PM','OWNER')")
    @GetMapping("/applications/{applicationId}")
    public ApiResponse<ApplicationService.SiteApplication> one(@PathVariable String applicationId) {
        return ApiResponse.ok(applications.one(CurrentUser.get(), applicationId));
    }

    @Operation(summary = "知悉并推送面试信息（可重复推送，以最后一次为准）")
    @PreAuthorize("hasAnyRole('SITE','PM')")
    @PostMapping("/applications/{applicationId}/acknowledge")
    public ApiResponse<ApplicationService.SiteApplication> acknowledge(@PathVariable String applicationId,
                                                                      @Valid @RequestBody AcknowledgeRequest req) {
        return ApiResponse.ok(applications.acknowledge(CurrentUser.get(), applicationId,
                new ApplicationService.AcknowledgeCommand(req.interviewAt(), req.address(), req.routeTips(), req.documents(),
                        req.contactName(), req.contactPhone())));
    }

    @Operation(summary = "我的消息")
    @GetMapping("/messages")
    public ApiResponse<PageResult<NotificationService.InboxItem>> messages(@RequestParam(required = false) Boolean unreadOnly,
                                                                         @RequestParam(required = false) Integer page,
                                                                         @RequestParam(required = false) Integer pageSize) {
        return ApiResponse.ok(notifications.inbox(NotificationService.Recipient.member(CurrentUser.subjectId()),
                unreadOnly, page, pageSize));
    }

    @Operation(summary = "未读消息数")
    @GetMapping("/messages/unread-count")
    public ApiResponse<Long> unread() {
        return ApiResponse.ok(notifications.unread(NotificationService.Recipient.member(CurrentUser.subjectId())));
    }

    @Operation(summary = "标记已读（ids 为空 = 全部）")
    @PostMapping("/messages/read")
    public ApiResponse<Integer> read(@RequestBody(required = false) ReadRequest req) {
        return ApiResponse.ok(notifications.markRead(NotificationService.Recipient.member(CurrentUser.subjectId()),
                req == null ? null : req.ids()));
    }
}
