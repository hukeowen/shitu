package com.shitu.app.seeker;

import com.shitu.app.support.AuthCookies;
import com.shitu.framework.web.ClientInfo;
import com.shitu.tenant.channel.ChannelCodeService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.util.UUID;

/**
 * 二维码入口 {@code /r/{code}}（C-101）：记录访问 → 写 7 天渠道 Cookie → 302 到 H5 并带上 {@code ?ch=}，
 * 前端再写 localStorage 做双保险（微信内置浏览器可能清 Cookie）。码无效时直接进首页，按自主注册处理。
 */
@Tag(name = "C 端 · 渠道跳转")
@RestController
public class ChannelRedirectController {

    private static final Logger log = LoggerFactory.getLogger(ChannelRedirectController.class);
    private static final Duration CHANNEL_TTL = Duration.ofDays(7);
    private static final Duration VISITOR_TTL = Duration.ofDays(365);

    private final ChannelCodeService channels;
    private final AuthCookies cookies;
    private final String entry;

    public ChannelRedirectController(ChannelCodeService channels, AuthCookies cookies,
                                     @Value("${shitu.h5.seeker-entry:/}") String entry) {
        this.channels = channels;
        this.cookies = cookies;
        this.entry = entry;
    }

    @Operation(summary = "扫码跳转")
    @GetMapping("/r/{code}")
    public ResponseEntity<Void> redirect(@PathVariable String code, HttpServletRequest req, HttpServletResponse resp) {
        String target = entry;
        var resolved = channels.resolve(code);
        if (resolved.isPresent()) {
            String visitor = AuthCookies.read(req, AuthCookies.VISITOR);
            if (visitor == null || !visitor.matches("[0-9a-f]{32}")) {
                visitor = UUID.randomUUID().toString().replace("-", "");
                cookies.set(resp, AuthCookies.VISITOR, visitor, VISITOR_TTL);
            }
            try {
                channels.recordVisit(code, visitor, null, ClientInfo.ip(), ClientInfo.userAgent());
            } catch (RuntimeException e) {
                // 访问统计失败不能影响用户进入
                log.warn("record channel visit failed code={} err={}", code, e.getMessage());
            }
            cookies.set(resp, AuthCookies.CHANNEL, code, CHANNEL_TTL);
            target = entry + (entry.contains("?") ? "&" : "?") + "ch=" + code;
        }
        return ResponseEntity.status(HttpStatus.FOUND).header(HttpHeaders.LOCATION, target)
                .header(HttpHeaders.CACHE_CONTROL, "no-store").build();
    }
}
