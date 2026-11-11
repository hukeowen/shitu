package com.shitu.app.seeker;

import com.shitu.common.api.ApiResponse;
import com.shitu.framework.security.CurrentUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "C 端 · 我的")
@RestController
@RequestMapping("/api/v1/seeker")
public class SeekerController {

    private final SeekerAuthFacade facade;
    private final SeekerArchiveService archive;

    public SeekerController(SeekerAuthFacade facade, SeekerArchiveService archive) {
        this.facade = facade;
        this.archive = archive;
    }

    @Operation(summary = "最近一张人才经纪人工单的进度（C-305；没有返回空）")
    @GetMapping("/broker-case")
    public ApiResponse<java.util.Map<String, Object>> brokerCase() {
        return ApiResponse.ok(archive.brokerProgress(CurrentUser.subjectId()));
    }

    @Operation(summary = "我的台账（C-506）：报名与面试记录、任职记录、工资条")
    @GetMapping("/ledger")
    public ApiResponse<SeekerArchiveService.Ledger> ledger() {
        return ApiResponse.ok(archive.ledger(CurrentUser.subjectId()));
    }

    @Operation(summary = "我的简历（C-504）：可编辑部分 + 只读用工档案")
    @GetMapping("/resume")
    public ApiResponse<SeekerArchiveService.Resume> resume() {
        return ApiResponse.ok(archive.resume(CurrentUser.subjectId()));
    }

    @Operation(summary = "保存简历的可编辑部分（姓名、性别、年龄取自实名，不可改）")
    @org.springframework.web.bind.annotation.PutMapping("/resume")
    public ApiResponse<Void> saveResume(@org.springframework.web.bind.annotation.RequestBody SeekerArchiveService.ResumeForm form) {
        archive.saveResume(CurrentUser.subjectId(), form);
        return ApiResponse.ok(null);
    }

    @Operation(summary = "当前用户：状态、公私域、匹配范围、24h 截止时间")
    @GetMapping("/me")
    public ApiResponse<SeekerAuthFacade.SeekerProfile> me() {
        return ApiResponse.ok(facade.me(CurrentUser.subjectId()));
    }

    @Operation(summary = "渠道码公开信息（启动页展示邀请方，C-101）")
    @GetMapping("/public/channel/{code}")
    public ApiResponse<SeekerAuthFacade.ChannelInfo> channel(@PathVariable String code) {
        return ApiResponse.ok(facade.channelInfo(code));
    }
}
