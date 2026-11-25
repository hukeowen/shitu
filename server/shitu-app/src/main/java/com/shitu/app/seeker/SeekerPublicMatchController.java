package com.shitu.app.seeker;

import com.shitu.common.api.ApiResponse;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.kv.RateLimiter;
import com.shitu.framework.web.ClientInfo;
import com.shitu.matching.domain.ProfileBuilder;
import com.shitu.matching.quiz.QuizService;
import com.shitu.matching.session.MatchService;
import com.shitu.tenant.channel.ChannelCodeService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.List;

/**
 * 游客先答题（D-62 ①）：不登录也能做 AI 问薪、看打码的结果预览；点「看完整岗位 / 报名」时再登录，
 * 登录后前端用同一份答案调 {@code POST /api/v1/seeker/match} 得到正式结果。
 * <p>放在 {@code /api/v1/seeker/public/**} 下（SecurityConfig 已整体放行）。预览不落库、不记匹配次数、不进答题漏斗，
 * 也不记渠道访问——渠道码只用来决定预览范围，归属仍在登录（注册）时按 C-105 绑定。
 */
@Tag(name = "C 端 · 游客问薪预览")
@RestController
@RequestMapping("/api/v1/seeker/public")
public class SeekerPublicMatchController {

    /** 每个 IP 每小时最多预览次数（防止游客接口被拿来批量扒岗位）。厂区、宿舍常常很多人共用一个出口 IP，不能定得太小。 */
    static final int PREVIEW_PER_HOUR = 120;

    public record PreviewRequest(@NotEmpty(message = "请先回答问题") @Size(max = 20) List<ProfileBuilder.Answer> answers,
                                 String channelCode, BigDecimal lng, BigDecimal lat) {
    }

    private final QuizService quiz;
    private final MatchService matching;
    private final ChannelCodeService channels;
    private final RateLimiter limiter;

    public SeekerPublicMatchController(QuizService quiz, MatchService matching, ChannelCodeService channels,
                                       RateLimiter limiter) {
        this.quiz = quiz;
        this.matching = matching;
        this.channels = channels;
        this.limiter = limiter;
    }

    @Operation(summary = "当前生效题库（游客可读；不记答题漏斗）")
    @GetMapping("/quiz")
    public ApiResponse<QuizService.QuizView> quiz() {
        return ApiResponse.ok(quiz.active());
    }

    @Operation(summary = "游客匹配预览：渠道码属于正常经营的公司 → 只看该公司岗位，否则全平台；最多 3 张打码卡片；每 IP 每小时 120 次")
    @PostMapping("/match/preview")
    public ApiResponse<MatchService.PreviewOutcome> preview(@Valid @RequestBody PreviewRequest req) {
        String ip = ClientInfo.ip();
        BizException.check(limiter.tryAcquire("match-preview:" + (ip == null ? "unknown" : ip), PREVIEW_PER_HOUR,
                Duration.ofHours(1)), ErrorCode.SYS_TOO_MANY_REQUESTS, "试得有点多了，请过一小时再试；登录后可以直接匹配");
        String companyId = channels.resolve(req.channelCode())
                .filter(ChannelCodeService.Resolved::bindsCompany)
                .map(ChannelCodeService.Resolved::companyId)
                .orElse(null);
        return ApiResponse.ok(matching.preview(companyId, req.answers(), req.lng(), req.lat()));
    }
}
