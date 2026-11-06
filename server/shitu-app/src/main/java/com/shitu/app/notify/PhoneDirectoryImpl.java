package com.shitu.app.notify;

import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.lifecycle.mapper.SeekerUserMapper;
import com.shitu.lifecycle.seeker.SeekerUser;
import com.shitu.notify.Notification;
import com.shitu.notify.NotificationService;
import com.shitu.tenant.mapper.MemberMapper;
import com.shitu.tenant.member.Member;
import org.springframework.stereotype.Component;

/** 短信收件人手机号：求职者 / 成员分别从各自的表解密（只在发送时短暂持有明文）。 */
@Component
public class PhoneDirectoryImpl implements NotificationService.PhoneDirectory {

    private final SeekerUserMapper users;
    private final MemberMapper members;
    private final FieldCipher cipher;

    public PhoneDirectoryImpl(SeekerUserMapper users, MemberMapper members, FieldCipher cipher) {
        this.users = users;
        this.members = members;
        this.cipher = cipher;
    }

    @Override
    public String phoneOf(String recipientType, String recipientId) {
        return TenantContext.runAsSystem(() -> {
            if (Notification.SEEKER.equals(recipientType)) {
                SeekerUser u = users.selectById(recipientId);
                return u == null ? null : cipher.decrypt(u.getPhoneEnc());
            }
            Member m = members.selectById(recipientId);
            return m == null ? null : cipher.decrypt(m.getPhoneEnc());
        });
    }
}
