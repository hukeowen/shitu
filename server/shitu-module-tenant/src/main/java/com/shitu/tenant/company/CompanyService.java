package com.shitu.tenant.company;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.shitu.common.api.PageResult;
import com.shitu.common.enums.ActorRole;
import com.shitu.common.enums.CompanyStatus;
import com.shitu.common.enums.MemberStatus;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.common.util.Masks;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.id.BizIdGenerator;
import com.shitu.framework.outbox.OutboxWriter;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.framework.web.Pages;
import com.shitu.tenant.mapper.CompanyMapper;
import com.shitu.tenant.mapper.MemberMapper;
import com.shitu.tenant.member.Member;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * 劳务公司入驻与状态（T 端入驻申请、P-02 公司管理）。
 * <pre>
 * 申请 → PENDING_AUDIT ──通过──→ NORMAL（记入驻日，免费期起算）⇄ THROTTLED / BANNED
 *                      └─驳回──→ REJECTED ──修改后重新提交──→ PENDING_AUDIT
 * </pre>
 * 已注销 / 已倒闭涉及批量解绑和流转分账（R-11），在 Sprint 4 随归属治理一起实现。
 */
@Service
public class CompanyService {

    /** 统一社会信用代码：18 位，第 1–2 位登记管理部门 / 机构类别，3–8 位行政区划码，9–17 位组织机构代码，18 位校验码。 */
    private static final Pattern CREDIT_CODE = Pattern.compile("^[0-9A-HJ-NPQRTUWXY]{2}\\d{6}[0-9A-HJ-NPQRTUWXY]{10}$");
    private static final Set<CompanyStatus> OPERATIONAL = EnumSet.of(CompanyStatus.NORMAL, CompanyStatus.THROTTLED);
    private static final long STATUS_CACHE_MS = 30_000;

    public record ApplyCommand(String name, String shortName, String unifiedCreditCode, String dispatchLicenseNo,
                               List<String> licenseFiles, String contactName) {
    }

    public record CompanyView(String companyId, String name, String shortName, String unifiedCreditCode,
                              String dispatchLicenseNo, List<String> licenseFiles, String contactName,
                              String contactPhone, CompanyStatus status, String statusRemark, String auditRemark,
                              LocalDateTime submittedAt, LocalDateTime auditedAt, LocalDate onboardDate,
                              LocalDate freePeriodEnd, Integer creditScore, Integer penaltyLevel,
                              LocalDateTime createdAt) {
    }

    public record OpsQuery(CompanyStatus status, String keyword, Integer page, Integer pageSize) {
    }

    public record Applied(String companyId, String memberId) {
    }

    private record CachedStatus(CompanyStatus status, long at) {
    }

    private final CompanyMapper companies;
    private final MemberMapper members;
    private final FieldCipher cipher;
    private final BizIdGenerator ids;
    private final AuditLogger audit;
    private final OutboxWriter outbox;
    private final Clock clock;
    private final Map<String, CachedStatus> statusCache = new ConcurrentHashMap<>();

    public CompanyService(CompanyMapper companies, MemberMapper members, FieldCipher cipher, BizIdGenerator ids,
                          AuditLogger audit, OutboxWriter outbox, Clock clock) {
        this.companies = companies;
        this.members = members;
        this.cipher = cipher;
        this.ids = ids;
        this.audit = audit;
        this.outbox = outbox;
        this.clock = clock;
    }

    /** 新公司入驻申请（匿名 + 手机验证码票据）。同时创建老板账号。 */
    @Transactional
    public Applied apply(String phone, ApplyCommand cmd) {
        validate(cmd);
        return TenantContext.runAsSystem(() -> {
            String phoneHash = cipher.blindIndex(phone);
            BizException.check(members.selectCount(new LambdaQueryWrapper<Member>().eq(Member::getPhoneHash, phoneHash)) == 0,
                    ErrorCode.TEN_PHONE_TAKEN);
            String credit = cmd.unifiedCreditCode().trim().toUpperCase();
            BizException.check(companies.selectCount(new LambdaQueryWrapper<Company>()
                    .eq(Company::getUnifiedCreditCode, credit)) == 0, ErrorCode.TEN_COMPANY_EXISTS);
            LocalDateTime now = LocalDateTime.now(clock);

            Company c = new Company();
            c.setCompanyId(ids.global("C", 10001));
            fill(c, cmd);
            c.setUnifiedCreditCode(credit);
            c.setContactPhoneEnc(cipher.encrypt(phone));
            c.setCompanyStatus(CompanyStatus.PENDING_AUDIT);
            c.setSubmittedAt(now);
            c.setCreatedAt(now);
            companies.insert(c);

            Member owner = new Member();
            owner.setMemberId(ids.dated("M", 4));
            owner.setCompanyId(c.getCompanyId());
            owner.setName(cmd.contactName().trim());
            owner.setPhoneEnc(cipher.encrypt(phone));
            owner.setPhoneHash(phoneHash);
            owner.setRoles(ActorRole.OWNER.name());
            owner.setStatus(MemberStatus.NORMAL);
            owner.setCreatedAt(now);
            members.insert(owner);

            audit.logAs("TENANT", owner.getMemberId(), c.getCompanyId(), "COMPANY_APPLY", "COMPANY", c.getCompanyId(),
                    Map.of("name", c.getName(), "creditCode", credit));
            outbox.publish("COMPANY_APPLIED", "COMPANY", c.getCompanyId(), Map.of("name", c.getName()));
            return new Applied(c.getCompanyId(), owner.getMemberId());
        });
    }

    /** 被驳回 / 审核中修改资料后重新提交（老板）。 */
    @Transactional
    public CompanyView resubmit(String companyId, ApplyCommand cmd) {
        validate(cmd);
        Company c = mustGet(companyId);
        BizException.check(c.getCompanyStatus() == CompanyStatus.REJECTED || c.getCompanyStatus() == CompanyStatus.PENDING_AUDIT,
                ErrorCode.TEN_ILLEGAL_STATUS);
        String credit = cmd.unifiedCreditCode().trim().toUpperCase();
        if (!credit.equals(c.getUnifiedCreditCode())) {
            Long dup = TenantContext.runAsSystem(() -> companies.selectCount(new LambdaQueryWrapper<Company>()
                    .eq(Company::getUnifiedCreditCode, credit).ne(Company::getCompanyId, companyId)));
            BizException.check(dup == 0, ErrorCode.TEN_COMPANY_EXISTS);
        }
        fill(c, cmd);
        c.setUnifiedCreditCode(credit);
        c.setCompanyStatus(CompanyStatus.PENDING_AUDIT);
        c.setSubmittedAt(LocalDateTime.now(clock));
        companies.updateById(c);
        evict(companyId);
        audit.log("COMPANY_RESUBMIT", "COMPANY", companyId, Map.of("name", c.getName()));
        outbox.publish("COMPANY_APPLIED", "COMPANY", companyId, Map.of("name", c.getName(), "resubmit", true));
        return view(c, false);
    }

    public CompanyView get(String companyId, boolean fullPhone) {
        return view(mustGet(companyId), fullPhone);
    }

    public Company find(String companyId) {
        return companies.selectById(companyId);
    }

    public Map<String, String> namesOf(java.util.Collection<String> ids) {
        if (ids == null || ids.isEmpty()) {
            return new HashMap<>();
        }
        Map<String, String> m = new HashMap<>();
        TenantContext.runAsSystem(() -> companies.selectBatchIds(ids)).forEach(c ->
                m.put(c.getCompanyId(), c.getShortName() != null && !c.getShortName().isBlank() ? c.getShortName() : c.getName()));
        return m;
    }

    /** 公司是否可正常经营（正常 / 限流）。带 30 秒进程内缓存，用于每个租户请求的前置校验。 */
    public boolean isOperational(String companyId) {
        return OPERATIONAL.contains(statusOf(companyId));
    }

    public CompanyStatus statusOf(String companyId) {
        long now = clock.millis();
        CachedStatus cs = statusCache.get(companyId);
        if (cs == null || now - cs.at() > STATUS_CACHE_MS) {
            Company c = TenantContext.runAsSystem(() -> companies.selectById(companyId));
            cs = new CachedStatus(c == null ? CompanyStatus.DEREGISTERED : c.getCompanyStatus(), now);
            statusCache.put(companyId, cs);
        }
        return cs.status();
    }

    // ------------------------------------------------------------------ 平台中台 P-02

    public PageResult<CompanyView> list(OpsQuery q) {
        LambdaQueryWrapper<Company> w = new LambdaQueryWrapper<Company>()
                .eq(q.status() != null, Company::getCompanyStatus, q.status())
                .and(q.keyword() != null && !q.keyword().isBlank(), x -> x.like(Company::getName, q.keyword())
                        .or().like(Company::getShortName, q.keyword())
                        .or().eq(Company::getCompanyId, q.keyword())
                        .or().eq(Company::getUnifiedCreditCode, q.keyword().toUpperCase()))
                .orderByAsc(q.status() == CompanyStatus.PENDING_AUDIT, Company::getSubmittedAt)
                .orderByDesc(q.status() != CompanyStatus.PENDING_AUDIT, Company::getSubmittedAt);
        return Pages.map(companies.selectPage(Pages.of(q.page(), q.pageSize()), w), c -> view(c, false));
    }

    public Map<CompanyStatus, Long> countByStatus() {
        Map<CompanyStatus, Long> m = new HashMap<>();
        for (CompanyStatus s : CompanyStatus.values()) {
            m.put(s, companies.selectCount(new LambdaQueryWrapper<Company>().eq(Company::getCompanyStatus, s)));
        }
        return m;
    }

    /**
     * 入驻审核通过：入驻日 = 审核通过当天，免费期最后一天由调用方按生效的计费规则算好传入（文档 2.2）。
     */
    @Transactional
    public CompanyView approve(String companyId, LocalDate onboardDate, LocalDate freePeriodEnd, String remark, String operatorId) {
        Company c = mustGet(companyId);
        BizException.check(c.getCompanyStatus() == CompanyStatus.PENDING_AUDIT, ErrorCode.TEN_ILLEGAL_STATUS);
        c.setCompanyStatus(CompanyStatus.NORMAL);
        c.setAuditRemark(remark);
        c.setAuditedBy(operatorId);
        c.setAuditedAt(LocalDateTime.now(clock));
        if (c.getOnboardDate() == null) {
            c.setOnboardDate(onboardDate);
            c.setFreePeriodEnd(freePeriodEnd);
        }
        companies.updateById(c);
        evict(companyId);
        audit.logForCompany(companyId, "COMPANY_APPROVE", "COMPANY", companyId,
                Map.of("onboardDate", String.valueOf(c.getOnboardDate()), "freePeriodEnd", String.valueOf(c.getFreePeriodEnd())));
        outbox.publish("COMPANY_APPROVED", "COMPANY", companyId, Map.of("name", c.getName()));
        return view(c, true);
    }

    @Transactional
    public CompanyView reject(String companyId, String remark, String operatorId) {
        BizException.check(remark != null && !remark.isBlank(), ErrorCode.SYS_BAD_REQUEST, "请填写驳回原因");
        Company c = mustGet(companyId);
        BizException.check(c.getCompanyStatus() == CompanyStatus.PENDING_AUDIT, ErrorCode.TEN_ILLEGAL_STATUS);
        c.setCompanyStatus(CompanyStatus.REJECTED);
        c.setAuditRemark(remark.trim());
        c.setAuditedBy(operatorId);
        c.setAuditedAt(LocalDateTime.now(clock));
        companies.updateById(c);
        evict(companyId);
        audit.logForCompany(companyId, "COMPANY_REJECT", "COMPANY", companyId, Map.of("remark", remark.trim()));
        outbox.publish("COMPANY_REJECTED", "COMPANY", companyId, Map.of("remark", remark.trim()));
        return view(c, true);
    }

    /** 正常 ⇄ 限流 ⇄ 封禁（P-02）。 */
    @Transactional
    public CompanyView changeStatus(String companyId, CompanyStatus target, String remark, String operatorId) {
        BizException.check(EnumSet.of(CompanyStatus.NORMAL, CompanyStatus.THROTTLED, CompanyStatus.BANNED).contains(target),
                ErrorCode.SYS_BAD_REQUEST, "注销 / 倒闭需走归属治理流程");
        BizException.check(target == CompanyStatus.NORMAL || (remark != null && !remark.isBlank()),
                ErrorCode.SYS_BAD_REQUEST, "请填写限流 / 封禁原因");
        Company c = mustGet(companyId);
        BizException.check(OPERATIONAL.contains(c.getCompanyStatus()) || c.getCompanyStatus() == CompanyStatus.BANNED,
                ErrorCode.TEN_ILLEGAL_STATUS);
        CompanyStatus before = c.getCompanyStatus();
        c.setCompanyStatus(target);
        c.setStatusRemark(target == CompanyStatus.NORMAL ? null : remark.trim());
        companies.updateById(c);
        evict(companyId);
        audit.logForCompany(companyId, "COMPANY_STATUS_CHANGE", "COMPANY", companyId,
                Map.of("before", before.name(), "after", target.name(), "remark", remark == null ? "" : remark));
        return view(c, true);
    }

    // ------------------------------------------------------------------

    private Company mustGet(String companyId) {
        Company c = companies.selectById(companyId);
        BizException.check(c != null, ErrorCode.SYS_NOT_FOUND);
        return c;
    }

    private void evict(String companyId) {
        statusCache.remove(companyId);
    }

    private static void fill(Company c, ApplyCommand cmd) {
        c.setName(cmd.name().trim());
        c.setShortName(blankToNull(cmd.shortName()));
        c.setDispatchLicenseNo(blankToNull(cmd.dispatchLicenseNo()));
        c.setLicenseFiles(cmd.licenseFiles());
        c.setContactName(cmd.contactName().trim());
    }

    private static void validate(ApplyCommand cmd) {
        BizException.check(cmd.name() != null && cmd.name().trim().length() >= 4, ErrorCode.SYS_BAD_REQUEST, "请填写营业执照上的公司全称");
        BizException.check(cmd.unifiedCreditCode() != null
                        && CREDIT_CODE.matcher(cmd.unifiedCreditCode().trim().toUpperCase()).matches(),
                ErrorCode.SYS_BAD_REQUEST, "统一社会信用代码格式不正确");
        BizException.check(cmd.contactName() != null && !cmd.contactName().isBlank(), ErrorCode.SYS_BAD_REQUEST, "请填写联系人");
        BizException.check(cmd.licenseFiles() != null && !cmd.licenseFiles().isEmpty() && cmd.licenseFiles().size() <= 6,
                ErrorCode.SYS_BAD_REQUEST, "请上传营业执照（劳务派遣许可证如有一并上传），最多 6 个文件");
    }

    private CompanyView view(Company c, boolean fullPhone) {
        String phone = c.getContactPhoneEnc() == null ? null : cipher.decrypt(c.getContactPhoneEnc());
        return new CompanyView(c.getCompanyId(), c.getName(), c.getShortName(), c.getUnifiedCreditCode(),
                c.getDispatchLicenseNo(), c.getLicenseFiles(), c.getContactName(),
                fullPhone ? phone : Masks.phone(phone), c.getCompanyStatus(), c.getStatusRemark(), c.getAuditRemark(),
                c.getSubmittedAt(), c.getAuditedAt(), c.getOnboardDate(), c.getFreePeriodEnd(), c.getCreditScore(),
                c.getPenaltyLevel(), c.getCreatedAt());
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
