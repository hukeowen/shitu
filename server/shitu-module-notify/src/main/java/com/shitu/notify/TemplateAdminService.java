package com.shitu.notify;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.notify.mapper.NotifyTemplateMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 通知模板管理（P-16）：改文案、渠道、是否遵守免打扰、启停，不需要发版。
 * 文案只能使用该模板的既有变量（首次编辑时从原文案推断并锁定），否则会发出带 ${xxx} 的消息。
 * 发送侧每次实时读取模板，保存即生效。
 */
@Service
public class TemplateAdminService {

    private static final Pattern VAR = Pattern.compile("\\$\\{([a-zA-Z][a-zA-Z0-9]*)}");
    private static final Set<String> CHANNELS = Set.of("INBOX", "SMS");

    private final NotifyTemplateMapper templates;
    private final AuditLogger audit;

    public TemplateAdminService(NotifyTemplateMapper templates, AuditLogger audit) {
        this.templates = templates;
        this.audit = audit;
    }

    public record TemplateView(String templateCode, List<String> channels, String title, String content, List<String> variables,
                               String smsTemplateId, boolean respectQuietHours, boolean enabled, String updatedBy,
                               LocalDateTime updatedAt) {
    }

    public record TemplateUpdate(List<String> channels, String title, String content, String smsTemplateId,
                                 Boolean respectQuietHours, Boolean enabled) {
    }

    public List<TemplateView> list() {
        return TenantContext.runAsSystem(() -> templates.selectList(new LambdaQueryWrapper<NotifyTemplate>()
                .orderByAsc(NotifyTemplate::getTemplateCode))).stream().map(this::view).toList();
    }

    @Transactional
    public TemplateView update(String code, TemplateUpdate u, String operatorId) {
        NotifyTemplate t = row(code);
        Set<String> allowed = allowed(t);
        String title = u.title() == null ? t.getTitle() : u.title().trim();
        String content = u.content() == null ? t.getContent() : u.content().trim();
        BizException.check(!title.isEmpty() && title.length() <= 64, ErrorCode.SYS_BAD_REQUEST, "标题必填，最多 64 字");
        BizException.check(!content.isEmpty() && content.length() <= 500, ErrorCode.SYS_BAD_REQUEST, "内容必填，最多 500 字");
        Set<String> used = vars(title + " " + content);
        used.removeAll(allowed);
        BizException.check(used.isEmpty(), ErrorCode.SYS_BAD_REQUEST,
                "不支持的变量：" + used.stream().map(v -> "${" + v + "}").collect(Collectors.joining("、"))
                        + "；可用变量：" + (allowed.isEmpty() ? "无" : allowed.stream().map(v -> "${" + v + "}").collect(Collectors.joining("、"))));
        BizException.check(!content.matches("(?s).*\\$\\{(?![a-zA-Z][a-zA-Z0-9]*}).*"), ErrorCode.SYS_BAD_REQUEST, "变量格式应为 ${变量名}");
        String channels = u.channels() == null ? t.getChannels() : String.join(",", new LinkedHashSet<>(u.channels()));
        BizException.check(!channels.isBlank() && Arrays.stream(channels.split(",")).allMatch(CHANNELS::contains),
                ErrorCode.SYS_BAD_REQUEST, "渠道只能是站内信 INBOX / 短信 SMS，至少选一个");
        TenantContext.runAsSystem(() -> templates.update(null, new LambdaUpdateWrapper<NotifyTemplate>()
                .eq(NotifyTemplate::getTemplateCode, code)
                .set(NotifyTemplate::getTitle, title)
                .set(NotifyTemplate::getContent, content)
                .set(NotifyTemplate::getVariables, String.join(",", allowed))
                .set(NotifyTemplate::getChannels, channels)
                .set(u.smsTemplateId() != null, NotifyTemplate::getSmsTemplateId, blankToNull(u.smsTemplateId()))
                .set(u.respectQuietHours() != null, NotifyTemplate::getRespectQuietHours, u.respectQuietHours())
                .set(u.enabled() != null, NotifyTemplate::getEnabled, u.enabled())
                .set(NotifyTemplate::getUpdatedBy, operatorId)));
        audit.log("NOTIFY_TEMPLATE_UPDATE", "NOTIFY_TEMPLATE", code, Map.of("before", t.getContent(), "after", content));
        return view(row(code));
    }

    /** 预览：变量以示例值替换。 */
    public Map<String, String> preview(String code, String title, String content) {
        NotifyTemplate t = row(code);
        Map<String, Object> sample = new LinkedHashMap<>();
        allowed(t).forEach(v -> sample.put(v, "【" + v + "】"));
        return Map.of("title", TemplateRenderer.render(title == null ? t.getTitle() : title, sample),
                "content", TemplateRenderer.render(content == null ? t.getContent() : content, sample));
    }

    static Set<String> vars(String s) {
        Set<String> out = new LinkedHashSet<>();
        Matcher m = VAR.matcher(s == null ? "" : s);
        while (m.find()) {
            out.add(m.group(1));
        }
        return out;
    }

    private static Set<String> allowed(NotifyTemplate t) {
        if (t.getVariables() != null) {
            return t.getVariables().isBlank() ? new LinkedHashSet<>()
                    : new LinkedHashSet<>(Arrays.asList(t.getVariables().split(",")));
        }
        return vars(t.getTitle() + " " + t.getContent());
    }

    private NotifyTemplate row(String code) {
        NotifyTemplate t = TenantContext.runAsSystem(() -> templates.selectById(code));
        BizException.check(t != null, ErrorCode.SYS_NOT_FOUND);
        return t;
    }

    private TemplateView view(NotifyTemplate t) {
        return new TemplateView(t.getTemplateCode(), t.getChannels() == null ? List.of() : List.of(t.getChannels().split(",")),
                t.getTitle(), t.getContent(), List.copyOf(allowed(t)), t.getSmsTemplateId(), Boolean.TRUE.equals(t.getRespectQuietHours()),
                !Boolean.FALSE.equals(t.getEnabled()), t.getUpdatedBy(), t.getUpdatedAt());
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
