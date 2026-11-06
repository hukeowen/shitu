package com.shitu.lifecycle.seeker;

import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.shitu.common.Constants;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.kv.RateLimiter;
import com.shitu.framework.param.SysParams;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.framework.web.ClientInfo;
import com.shitu.integration.kyc.IdentityVerifier;
import com.shitu.lifecycle.domain.IdCards;
import com.shitu.lifecycle.mapper.SeekerUserMapper;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;

/**
 * 实名认证（C-404 / C-405 / C-406，D-15 / D-16 / D-17）：
 * 两次输入比对 → 号码校验 → 年龄（未满 16 硬阻断）→ 一证一号 → 黑名单 → 二要素核验 → 绑定（之后不可修改）。
 * 每次尝试都写 {@code kyc_record}（平台专属表）留痕；每人每天最多 5 次。
 */
@Service
public class KycService {

    private static final int DAILY_ATTEMPTS = 5;

    public record KycView(String kycStatus, String realNameMasked, String idCardMasked, Integer age, boolean canApply) {
    }

    private final SeekerUserMapper users;
    private final FieldCipher cipher;
    private final IdentityVerifier verifier;
    private final JdbcTemplate jdbc;
    private final RateLimiter limiter;
    private final SysParams params;
    private final Clock clock;

    public KycService(SeekerUserMapper users, FieldCipher cipher, IdentityVerifier verifier, JdbcTemplate jdbc,
                      RateLimiter limiter, SysParams params, Clock clock) {
        this.users = users;
        this.cipher = cipher;
        this.verifier = verifier;
        this.jdbc = jdbc;
        this.limiter = limiter;
        this.params = params;
        this.clock = clock;
    }

    @Transactional(noRollbackFor = BizException.class)
    public KycView submit(String userId, String realName, String idCard, String idCardConfirm) {
        SeekerUser u = TenantContext.runAsSystem(() -> users.selectById(userId));
        BizException.check(u != null, ErrorCode.SYS_NOT_FOUND);
        BizException.check(!"VERIFIED".equals(u.getKycStatus()), ErrorCode.KYC_ALREADY);
        BizException.check(realName != null && realName.trim().matches("^[\\u4e00-\\u9fa5·]{2,20}$"),
                ErrorCode.SYS_BAD_REQUEST, "请输入身份证上的真实姓名");
        BizException.check(IdCards.sameInput(idCard, idCardConfirm), ErrorCode.APP_ID_MISMATCH);
        BizException.check(limiter.tryAcquire("kyc:" + userId + ":" + LocalDate.now(clock), DAILY_ATTEMPTS, Duration.ofDays(1)),
                ErrorCode.KYC_TOO_MANY);
        String id = IdCards.normalize(idCard);
        String name = realName.trim();
        if (!IdCards.isValid(id)) {
            record(userId, null, null, "ID_MISMATCH", null);
            throw new BizException(ErrorCode.KYC_ID_INVALID);
        }
        String hash = cipher.blindIndex(id);
        LocalDate birth = IdCards.birthDate(id).orElseThrow();
        LocalDate today = LocalDate.now(clock.withZone(Constants.ZONE));
        if (IdCards.ageVerdict(birth, today, minAgeRegister(), minAgeApply()) == IdCards.AgeVerdict.UNDERAGE_BLOCKED) {
            record(userId, hash, birth, "UNDERAGE", null);
            throw new BizException(ErrorCode.KYC_UNDERAGE);
        }
        Long occupied = jdbc.queryForObject("SELECT COUNT(*) FROM `user` WHERE id_card_hash = ? AND user_id <> ?",
                Long.class, hash, userId);
        if (occupied != null && occupied > 0) {
            record(userId, hash, birth, "ID_OCCUPIED", null);
            throw new BizException(ErrorCode.KYC_ID_OCCUPIED);
        }
        Long black = jdbc.queryForObject("SELECT COUNT(*) FROM blacklist WHERE status = 'ACTIVE' AND (id_card_hash = ? OR user_id = ?)",
                Long.class, hash, userId);
        if (black != null && black > 0) {
            record(userId, hash, birth, "BLACKLISTED", null);
            TenantContext.runAsSystem(() -> users.update(null, new LambdaUpdateWrapper<SeekerUser>()
                    .eq(SeekerUser::getUserId, userId).set(SeekerUser::getBlacklistFlag, true)));
            throw new BizException(ErrorCode.KYC_BLACKLISTED);
        }
        IdentityVerifier.Verification v = verifier.verify(name, id);
        if (v.result() != IdentityVerifier.Result.MATCH) {
            record(userId, hash, birth, "VERIFY_FAILED", v.providerTraceId());
            throw new BizException(v.result() == IdentityVerifier.Result.UNAVAILABLE ? ErrorCode.SYS_INTERNAL
                    : ErrorCode.KYC_VERIFY_FAILED, v.result() == IdentityVerifier.Result.UNAVAILABLE ? "实名核验服务繁忙，请稍后再试" : null);
        }
        try {
            int rows = TenantContext.runAsSystem(() -> users.update(null, new LambdaUpdateWrapper<SeekerUser>()
                    .eq(SeekerUser::getUserId, userId)
                    .ne(SeekerUser::getKycStatus, "VERIFIED")
                    .set(SeekerUser::getRealNameEnc, cipher.encrypt(name))
                    .set(SeekerUser::getIdCardEnc, cipher.encrypt(id))
                    .set(SeekerUser::getIdCardHash, hash)
                    .set(SeekerUser::getBirthDate, birth)
                    .set(SeekerUser::getGender, IdCards.gender(id).orElse(null))
                    .set(SeekerUser::getKycStatus, "VERIFIED")));
            BizException.check(rows == 1, ErrorCode.KYC_ALREADY);
        } catch (DuplicateKeyException e) {
            record(userId, hash, birth, "ID_OCCUPIED", v.providerTraceId());
            throw new BizException(ErrorCode.KYC_ID_OCCUPIED);
        }
        record(userId, hash, birth, "PASS", v.providerTraceId());
        return view(userId);
    }

    public KycView view(String userId) {
        SeekerUser u = TenantContext.runAsSystem(() -> users.selectById(userId));
        BizException.check(u != null, ErrorCode.SYS_NOT_FOUND);
        if (!"VERIFIED".equals(u.getKycStatus())) {
            return new KycView(u.getKycStatus(), null, null, null, false);
        }
        String name = cipher.decrypt(u.getRealNameEnc());
        String id = cipher.decrypt(u.getIdCardEnc());
        Integer age = u.getBirthDate() == null ? null : IdCards.age(u.getBirthDate(), LocalDate.now(clock));
        return new KycView("VERIFIED", com.shitu.common.util.Masks.name(name),
                id.substring(0, 3) + "***********" + id.substring(id.length() - 4), age,
                age != null && age >= minAgeApply() && !Boolean.TRUE.equals(u.getBlacklistFlag()));
    }

    public int minAgeApply() {
        return params.getInt("kyc.min_age_apply", 18);
    }

    private int minAgeRegister() {
        return params.getInt("kyc.min_age_register", 16);
    }

    private void record(String userId, String hash, LocalDate birth, String result, String traceId) {
        jdbc.update("INSERT INTO kyc_record (user_id, method, id_card_hash, birth_date, result, provider_trace_id, ip) "
                        + "VALUES (?, 'MANUAL_INPUT', ?, ?, ?, ?, ?)",
                userId, hash == null ? "-" : hash, birth, result, traceId, ClientInfo.ip());
    }
}
