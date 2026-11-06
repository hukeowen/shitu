package com.shitu.notify;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.shitu.common.api.PageResult;
import com.shitu.common.util.Masks;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.framework.web.Pages;
import com.shitu.integration.sms.SmsSender;
import com.shitu.notify.mapper.NotificationMapper;
import com.shitu.notify.mapper.NotifyTemplateMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Map;

/**
 * 通知发送（02-架构 §9）：站内信必发；模板含 SMS 渠道时同时发短信（H5 没有 App Push，短信是唯一主动触达渠道）。
 * 由发件箱投递任务调用，按 (outboxId, 收件人, 模板) 幂等 —— 投递重试不会重复发。
 */
@Service
public class NotificationService {

    private static final Logger log = LoggerFactory.getLogger(NotificationService.class);

    /** 收件人手机号（明文，仅发送时使用）。由应用层实现：求职者 / 成员分别从各自的表解密。 */
    public interface PhoneDirectory {
        String phoneOf(String recipientType, String recipientId);
    }

    public record Recipient(String type, String id) {
        public static Recipient seeker(String userId) {
            return new Recipient(Notification.SEEKER, userId);
        }

        public static Recipient member(String memberId) {
            return new Recipient(Notification.MEMBER, memberId);
        }
    }

    public record InboxItem(Long id, String templateCode, String title, String content, String link, int priority,
                            boolean read, LocalDateTime createdAt) {
    }

    private final NotifyTemplateMapper templates;
    private final NotificationMapper notifications;
    private final SmsSender sms;
    private final PhoneDirectory phones;
    private final JdbcTemplate jdbc;
    private final com.shitu.framework.crypto.FieldCipher cipher;
    private final Clock clock;

    public NotificationService(NotifyTemplateMapper templates, NotificationMapper notifications, SmsSender sms,
                               PhoneDirectory phones, JdbcTemplate jdbc, com.shitu.framework.crypto.FieldCipher cipher,
                               Clock clock) {
        this.templates = templates;
        this.notifications = notifications;
        this.sms = sms;
        this.phones = phones;
        this.jdbc = jdbc;
        this.cipher = cipher;
        this.clock = clock;
    }

    /** @return 实际新发出的站内信数量（已发过的跳过） */
    public int send(Long outboxId, String templateCode, Collection<Recipient> recipients, Map<String, ?> vars, String link) {
        return TenantContext.runAsSystem(() -> {
            NotifyTemplate t = templates.selectById(templateCode);
            if (t == null || Boolean.FALSE.equals(t.getEnabled())) {
                log.warn("notify template {} missing or disabled, skip", templateCode);
                return 0;
            }
            String title = TemplateRenderer.render(t.getTitle(), vars);
            String content = TemplateRenderer.render(t.getContent(), vars);
            int sent = 0;
            for (Recipient r : recipients) {
                Notification n = new Notification();
                n.setRecipientType(r.type());
                n.setRecipientId(r.id());
                n.setTemplateCode(templateCode);
                n.setTitle(title);
                n.setContent(content);
                n.setLink(link);
                n.setPriority("INJURY_ALERT".equals(templateCode) ? 2 : 0);
                n.setOutboxId(outboxId);
                n.setCreatedAt(LocalDateTime.now(clock));
                try {
                    notifications.insert(n);
                } catch (DuplicateKeyException e) {
                    continue;
                }
                sent++;
                if (t.hasChannel("SMS")) {
                    sendSms(r, templateCode, content);
                }
            }
            return sent;
        });
    }

    private void sendSms(Recipient r, String templateCode, String content) {
        String phone = phones.phoneOf(r.type(), r.id());
        if (phone == null) {
            return;
        }
        String status = "SENT";
        String msgId = null;
        try {
            msgId = sms.send(phone, templateCode, Map.of("content", content));
        } catch (RuntimeException e) {
            // 短信失败不影响站内信，记日志即可（对账时可补发）
            status = "FAILED";
            log.warn("notify sms failed to {} template {}: {}", Masks.phone(phone), templateCode, e.getMessage());
        }
        jdbc.update("INSERT INTO sms_log (phone_hash, biz_type, template_code, provider_msg_id, status, created_at) "
                + "VALUES (?, 'NOTIFY', ?, ?, ?, ?)", cipher.blindIndex(phone), templateCode, msgId, status, LocalDateTime.now(clock));
    }

    // ------------------------------------------------------------------ 收件箱

    public PageResult<InboxItem> inbox(Recipient r, Boolean unreadOnly, Integer page, Integer pageSize) {
        return TenantContext.runAsSystem(() -> Pages.map(notifications.selectPage(Pages.of(page, pageSize),
                new LambdaQueryWrapper<Notification>()
                        .eq(Notification::getRecipientType, r.type()).eq(Notification::getRecipientId, r.id())
                        .isNull(Boolean.TRUE.equals(unreadOnly), Notification::getReadAt)
                        .orderByDesc(Notification::getPriority).orderByDesc(Notification::getId)),
                n -> new InboxItem(n.getId(), n.getTemplateCode(), n.getTitle(), n.getContent(), n.getLink(),
                        n.getPriority() == null ? 0 : n.getPriority(), n.getReadAt() != null, n.getCreatedAt())));
    }

    public long unread(Recipient r) {
        return TenantContext.runAsSystem(() -> notifications.selectCount(new LambdaQueryWrapper<Notification>()
                .eq(Notification::getRecipientType, r.type()).eq(Notification::getRecipientId, r.id())
                .isNull(Notification::getReadAt)));
    }

    /** ids 为空 = 全部已读。只能标记自己的消息。 */
    public int markRead(Recipient r, List<Long> ids) {
        return TenantContext.runAsSystem(() -> notifications.update(null, new LambdaUpdateWrapper<Notification>()
                .eq(Notification::getRecipientType, r.type()).eq(Notification::getRecipientId, r.id())
                .in(ids != null && !ids.isEmpty(), Notification::getId, ids)
                .isNull(Notification::getReadAt)
                .set(Notification::getReadAt, LocalDateTime.now(clock))));
    }
}
