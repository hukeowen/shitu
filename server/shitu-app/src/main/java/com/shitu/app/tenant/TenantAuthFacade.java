package com.shitu.app.tenant;

import com.shitu.app.support.FileFacade;
import com.shitu.common.enums.ActorRole;
import com.shitu.common.enums.AuthDomain;
import com.shitu.common.enums.CompanyStatus;
import com.shitu.common.enums.MemberStatus;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.kv.KvStore;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.identity.session.AuthSessionService;
import com.shitu.identity.session.AuthSessionService.TokenPair;
import com.shitu.identity.sms.SmsCodeService;
import com.shitu.tenant.company.CompanyService;
import com.shitu.tenant.member.Member;
import com.shitu.tenant.member.MemberService;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * 公司后台 / 驻场端登录与入驻申请编排。
 * <ul>
 *   <li>手机号是成员 → 登录（公司审核中 / 被驳回也能登录，只能看入驻进度、修改资料）；</li>
 *   <li>手机号不是任何公司成员 → 返回 30 分钟有效的入驻票据，凭票据上传执照、提交入驻申请（成为老板）。</li>
 * </ul>
 */
@Service
public class TenantAuthFacade {

    private static final Duration TICKET_TTL = Duration.ofMinutes(30);

    public enum LoginStatus { OK, NOT_MEMBER }

    public record LoginResult(LoginStatus status, TokenPair tokens, String onboardingTicket, String phoneMasked) {
    }

    public record TenantMe(String memberId, String name, Set<ActorRole> roles, Set<String> permissions,
                           CompanyService.CompanyView company, boolean operational) {
    }

    private final SmsCodeService sms;
    private final AuthSessionService sessions;
    private final MemberService members;
    private final CompanyService companies;
    private final FileFacade files;
    private final KvStore kv;
    private final FieldCipher cipher;
    private final AuditLogger audit;

    public TenantAuthFacade(SmsCodeService sms, AuthSessionService sessions, MemberService members,
                            CompanyService companies, FileFacade files, KvStore kv, FieldCipher cipher, AuditLogger audit) {
        this.sms = sms;
        this.sessions = sessions;
        this.members = members;
        this.companies = companies;
        this.files = files;
        this.kv = kv;
        this.cipher = cipher;
        this.audit = audit;
    }

    public LoginResult login(String phone, String code) {
        sms.verify(AuthDomain.TENANT, phone, code);
        Optional<Member> m = members.findByPhone(phone);
        if (m.isEmpty()) {
            String ticket = UUID.randomUUID().toString().replace("-", "");
            kv.set("onb:" + ticket, phone, TICKET_TTL);
            return new LoginResult(LoginStatus.NOT_MEMBER, null, ticket, com.shitu.common.util.Masks.phone(phone));
        }
        Member member = m.get();
        BizException.check(member.getStatus() == MemberStatus.NORMAL, ErrorCode.AUTH_ACCOUNT_DISABLED);
        CompanyStatus cs = companies.statusOf(member.getCompanyId());
        BizException.check(!cs.isClosed(), ErrorCode.AUTH_ACCOUNT_DISABLED, "公司已注销，账号不可用");
        TokenPair t = sessions.open(members.principalOf(member.getMemberId()));
        members.touchLogin(member.getMemberId());
        audit.logAs("TENANT", member.getMemberId(), member.getCompanyId(), "TENANT_LOGIN", "MEMBER", member.getMemberId(), null);
        return new LoginResult(LoginStatus.OK, t, null, null);
    }

    public TokenPair refresh(String refreshToken) {
        return sessions.refresh(AuthDomain.TENANT, refreshToken, (memberId, companyId) -> {
            AuthPrincipal p = members.principalOf(memberId);
            BizException.check(!companies.statusOf(p.companyId()).isClosed(), ErrorCode.AUTH_ACCOUNT_DISABLED);
            return p;
        });
    }

    /** 入驻票据 → 手机号（不消费，申请成功后才作废）。 */
    public String phoneOfTicket(String ticket) {
        BizException.check(ticket != null && ticket.matches("[0-9a-f]{32}"), ErrorCode.AUTH_TICKET_INVALID);
        return kv.get("onb:" + ticket).orElseThrow(() -> new BizException(ErrorCode.AUTH_TICKET_INVALID));
    }

    public String ticketOwner(String phone) {
        return "onb:" + cipher.blindIndex(phone);
    }

    /** 提交入驻申请并直接登录为老板。 */
    public TokenPair apply(String ticket, CompanyService.ApplyCommand cmd) {
        String phone = phoneOfTicket(ticket);
        files.checkOwned(cmd.licenseFiles(), ticketOwner(phone), null);
        CompanyService.Applied applied = companies.apply(phone, cmd);
        kv.delete("onb:" + ticket);
        return sessions.open(members.principalOf(applied.memberId()));
    }

    public TenantMe me(AuthPrincipal p) {
        MemberService.MemberView v = members.get(p.subjectId());
        CompanyService.CompanyView c = companies.get(p.companyId(), false);
        return new TenantMe(v.memberId(), v.name(), v.roles(), TenantPermissions.of(v.roles()), c,
                companies.isOperational(p.companyId()));
    }
}
