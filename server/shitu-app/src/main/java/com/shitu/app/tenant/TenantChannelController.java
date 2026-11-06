package com.shitu.app.tenant;

import com.shitu.common.api.ApiResponse;
import com.shitu.framework.security.CurrentUser;
import com.shitu.lifecycle.seeker.LifecycleService;
import com.shitu.tenant.channel.ChannelCodeService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/** 渠道二维码 T-501：公司码 / 成员码 / 项目码 + 扫码与注册统计。 */
@Tag(name = "公司后台 · 渠道二维码")
@RestController
@RequestMapping("/api/v1/tenant/channel-codes")
public class TenantChannelController {

    public record CreateRequest(@NotBlank(message = "请填写名称") String name, String memberId, String projectId) {
    }

    /** url 即二维码内容，前端直接生成二维码图片。 */
    /** kind：COMPANY 公司码 / MEMBER 成员码 / PROJECT 项目码。 */
    public record ChannelItem(String code, String url, String kind, String name, String memberId, String memberName,
                              String projectId, String projectName, String status, LocalDateTime createdAt,
                              long visits, long registrations) {
    }

    private final ChannelCodeService channels;
    private final LifecycleService lifecycle;
    private final String publicBase;

    public TenantChannelController(ChannelCodeService channels, LifecycleService lifecycle,
                                   @Value("${shitu.h5.public-base:http://localhost:5173}") String publicBase) {
        this.channels = channels;
        this.lifecycle = lifecycle;
        this.publicBase = publicBase.endsWith("/") ? publicBase.substring(0, publicBase.length() - 1) : publicBase;
    }

    @Operation(summary = "全部渠道码")
    @PreAuthorize("hasAnyRole('OWNER','PM')")
    @GetMapping
    public ApiResponse<List<ChannelItem>> list() {
        return ApiResponse.ok(enrich(channels.list(CurrentUser.get(), false)));
    }

    @Operation(summary = "我的专属码（没有则自动生成；驻场 / 经纪人分享给求职者）")
    @GetMapping("/mine")
    public ApiResponse<ChannelItem> mine() {
        return ApiResponse.ok(enrich(List.of(channels.mine(CurrentUser.get()))).get(0));
    }

    @Operation(summary = "新建渠道码（可指定成员 / 项目）")
    @PreAuthorize("hasAnyRole('OWNER','PM')")
    @PostMapping
    public ApiResponse<ChannelItem> create(@Valid @RequestBody CreateRequest req) {
        return ApiResponse.ok(enrich(List.of(channels.create(CurrentUser.get(),
                new ChannelCodeService.CreateCommand(req.name(), req.memberId(), req.projectId())))).get(0));
    }

    @Operation(summary = "停用")
    @PreAuthorize("hasAnyRole('OWNER','PM')")
    @PostMapping("/{code}/disable")
    public ApiResponse<ChannelItem> disable(@PathVariable String code) {
        return ApiResponse.ok(enrich(List.of(channels.setStatus(code, false))).get(0));
    }

    @Operation(summary = "启用")
    @PreAuthorize("hasAnyRole('OWNER','PM')")
    @PostMapping("/{code}/enable")
    public ApiResponse<ChannelItem> enable(@PathVariable String code) {
        return ApiResponse.ok(enrich(List.of(channels.setStatus(code, true))).get(0));
    }

    private List<ChannelItem> enrich(List<ChannelCodeService.ChannelView> list) {
        Map<String, Long> regs = lifecycle.registrationsByChannel(list.stream().map(ChannelCodeService.ChannelView::code).toList());
        return list.stream().map(c -> new ChannelItem(c.code(), publicBase + "/r/" + c.code(),
                c.projectId() != null ? "PROJECT" : c.memberId() != null ? "MEMBER" : "COMPANY", c.name(), c.memberId(),
                c.memberName(), c.projectId(), c.projectName(), c.status(), c.createdAt(), c.visits(),
                regs.getOrDefault(c.code(), 0L))).toList();
    }
}
