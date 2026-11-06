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

    public SeekerController(SeekerAuthFacade facade) {
        this.facade = facade;
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
