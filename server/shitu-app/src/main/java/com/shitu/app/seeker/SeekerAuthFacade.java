package com.shitu.app.seeker;

import com.shitu.common.Constants;
import com.shitu.common.enums.AuthDomain;
import com.shitu.common.enums.ChannelType;
import com.shitu.common.enums.DomainTag;
import com.shitu.common.enums.MatchScope;
import com.shitu.common.enums.UserStatus;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.common.util.Masks;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.framework.web.ClientInfo;
import com.shitu.identity.session.AuthSessionService;
import com.shitu.identity.session.AuthSessionService.TokenPair;
import com.shitu.identity.sms.SmsCodeService;
import com.shitu.lifecycle.domain.DomainRules;
import com.shitu.lifecycle.seeker.LifecycleService;
import com.shitu.lifecycle.seeker.ResponseWindow;
import com.shitu.lifecycle.seeker.SeekerUser;
import com.shitu.tenant.channel.ChannelCodeService;
import com.shitu.tenant.company.CompanyService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * C 端登录 / 注册编排（C-104 / C-105 / C-106）：短信验证码 → 已有账号直接登录（扫其他公司码只记触达，不改归属）
 * → 新用户按渠道注册（经状态机）→ 建会话。
 */
@Service
public class SeekerAuthFacade {

    private static final Logger log = LoggerFactory.getLogger(SeekerAuthFacade.class);

    public record SeekerProfile(String userId, String phoneMasked, UserStatus status, DomainTag domainTag,
                                MatchScope matchScope, boolean canStartMatching, String boundCompanyName,
                                boolean sourceIsPlatform, String kycStatus, LocalDateTime registeredAt,
                                LocalDateTime responseDeadline) {
    }

    public record LoginResult(TokenPair tokens, boolean newUser, SeekerProfile profile) {
    }

    private final SmsCodeService sms;
    private final AuthSessionService sessions;
    private final LifecycleService lifecycle;
    private final ChannelCodeService channels;
    private final CompanyService companies;
    private final FieldCipher cipher;
    private final AuditLogger audit;

    public SeekerAuthFacade(SmsCodeService sms, AuthSessionService sessions, LifecycleService lifecycle,
                            ChannelCodeService channels, CompanyService companies, FieldCipher cipher, AuditLogger audit) {
        this.sms = sms;
        this.sessions = sessions;
        this.lifecycle = lifecycle;
        this.channels = channels;
        this.companies = companies;
        this.cipher = cipher;
        this.audit = audit;
    }

    public LoginResult login(String phone, String code, String channelCode, String visitorKey) {
        sms.verify(AuthDomain.SEEKER, phone, code);
        Optional<ChannelCodeService.Resolved> ch = channels.resolve(channelCode);
        Optional<SeekerUser> exist = lifecycle.findByPhone(phone);
        SeekerUser user;
        boolean created;
        if (exist.isPresent()) {
            user = exist.get();
            created = false;
            // C-106：已注册用户扫其他公司码，不改变任何归属，只记录触达
            ch.ifPresent(r -> touch(r.code(), visitorKey, user.getUserId()));
        } else {
            LifecycleService.RegisterChannel rc = ch
                    .map(r -> new LifecycleService.RegisterChannel(r.code(), r.channelType(), r.companyId()))
                    .orElse(LifecycleService.RegisterChannel.organic());
            LifecycleService.Registered reg = lifecycle.register(phone, rc);
            user = reg.user();
            created = reg.created();
            // 注册也计一次访问：分享链接直接带码进入、没经过 /r/{code} 时，漏斗不会出现「注册 > 访问」
            if (created) {
                ch.ifPresent(r -> touch(r.code(), visitorKey, user.getUserId()));
            }
        }
        // 黑名单（D-16）不禁止登录，只在报名 / 预支时拦截
        TokenPair tokens = sessions.open(principalOf(user));
        audit.logAs("SEEKER", user.getUserId(), null, created ? "SEEKER_REGISTER" : "SEEKER_LOGIN", "USER", user.getUserId(),
                created ? Map.of("channelType", String.valueOf(user.getRegisterChannelType()),
                        "source", user.getSourceCompanyId()) : null);
        return new LoginResult(tokens, created, profile(user));
    }

    /** 记录渠道触达（访问按访客去重统计；没有访客 cookie 时按用户去重）。统计失败不影响登录。 */
    private void touch(String code, String visitorKey, String userId) {
        try {
            channels.recordVisit(code, visitorKey == null ? "u:" + userId : visitorKey, userId, ClientInfo.ip(), ClientInfo.userAgent());
        } catch (RuntimeException e) {
            log.warn("record channel visit failed code={} err={}", code, e.getMessage());
        }
    }

    public TokenPair refresh(String refreshToken) {
        return sessions.refresh(AuthDomain.SEEKER, refreshToken, (subjectId, companyId) ->
                principalOf(lifecycle.find(subjectId).orElseThrow(() -> new BizException(ErrorCode.AUTH_REFRESH_INVALID))));
    }

    public SeekerProfile me(String userId) {
        SeekerUser u = lifecycle.find(userId).orElseThrow(() -> new BizException(ErrorCode.SYS_UNAUTHORIZED));
        return profile(u);
    }

    private static AuthPrincipal principalOf(SeekerUser u) {
        return new AuthPrincipal(AuthDomain.SEEKER, u.getUserId(), null, Set.of(), null, null);
    }

    private SeekerProfile profile(SeekerUser u) {
        String bound = u.getBoundCompanyId() == null ? null
                : companies.namesOf(java.util.List.of(u.getBoundCompanyId())).get(u.getBoundCompanyId());
        LocalDateTime deadline = lifecycle.openWindowOf(u.getUserId()).map(ResponseWindow::getDeadline).orElse(null);
        return new SeekerProfile(u.getUserId(), Masks.phone(cipher.decrypt(u.getPhoneEnc())), u.getUserStatus(),
                DomainRules.domainTag(u.snapshot()), DomainRules.matchScope(u.snapshot()),
                DomainRules.canStartMatching(u.snapshot()), bound, Constants.PLATFORM.equals(u.getSourceCompanyId()),
                u.getKycStatus(), u.getRegisteredAt(), deadline);
    }

    /** 渠道码公开信息（启动页展示「XX 邀请你」）。 */
    public record ChannelInfo(boolean valid, ChannelType channelType, String companyName) {
    }

    public ChannelInfo channelInfo(String code) {
        return channels.resolve(code)
                .map(r -> new ChannelInfo(true, r.channelType(), r.companyName()))
                .orElse(new ChannelInfo(false, null, null));
    }
}
