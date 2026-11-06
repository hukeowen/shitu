package com.shitu.identity.sms;

import com.shitu.common.Constants;
import com.shitu.common.enums.AuthDomain;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.common.util.Masks;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.kv.KvStore;
import com.shitu.framework.kv.RateLimiter;
import com.shitu.framework.param.SysParams;
import com.shitu.framework.web.ClientInfo;
import com.shitu.identity.captcha.CaptchaService;
import com.shitu.integration.sms.SmsSender;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.util.Map;

/**
 * 短信验证码（C-104 / T 端登录 / 入驻申请）。
 * <ul>
 *   <li>同一手机号 60 秒 1 次、每天 10 次（{@code sys_param} 可调）；</li>
 *   <li>同一 IP 每小时超过 {@code captcha-after-per-ip} 次、或同一手机号当天已发过 3 次，必须先过图形验证码；</li>
 *   <li>同一 IP 每小时硬上限 {@code ip-hourly-limit} 次；</li>
 *   <li>验证码 5 分钟有效、一次性，错 5 次作废；三个账号域的验证码互不通用。</li>
 * </ul>
 */
@Service
public class SmsCodeService {

    private static final Logger log = LoggerFactory.getLogger(SmsCodeService.class);
    private static final Duration CODE_TTL = Duration.ofMinutes(5);
    private static final int MAX_ATTEMPTS = 5;
    private static final int CAPTCHA_AFTER_PER_PHONE_DAY = 3;

    public record SendResult(int retryAfterSeconds, String devCode) {
    }

    private final KvStore kv;
    private final RateLimiter limiter;
    private final SysParams params;
    private final FieldCipher cipher;
    private final CaptchaService captcha;
    private final SmsSender sender;
    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();
    private final int captchaAfterPerIp;
    private final int ipHourlyLimit;
    private final boolean exposeCodeInMock;

    public SmsCodeService(KvStore kv, RateLimiter limiter, SysParams params, FieldCipher cipher, CaptchaService captcha,
                          SmsSender sender, JdbcTemplate jdbc, Clock clock,
                          @Value("${shitu.sms.captcha-after-per-ip:3}") int captchaAfterPerIp,
                          @Value("${shitu.sms.ip-hourly-limit:30}") int ipHourlyLimit,
                          @Value("${shitu.sms.expose-code-in-mock:false}") boolean exposeCodeInMock) {
        this.kv = kv;
        this.limiter = limiter;
        this.params = params;
        this.cipher = cipher;
        this.captcha = captcha;
        this.sender = sender;
        this.jdbc = jdbc;
        this.clock = clock;
        this.captchaAfterPerIp = captchaAfterPerIp;
        this.ipHourlyLimit = ipHourlyLimit;
        this.exposeCodeInMock = exposeCodeInMock;
    }

    public SendResult send(AuthDomain domain, String phone, String captchaId, String captchaCode) {
        BizException.check(Masks.isMobile(phone), ErrorCode.AUTH_PHONE_INVALID);
        String hash = cipher.blindIndex(phone);
        String ip = ClientInfo.ip();
        String today = LocalDate.now(clock.withZone(Constants.ZONE)).toString();
        String ipKey = "sms:ip:" + ip;
        String dayKey = "sms:day:" + today + ":" + hash;

        boolean needCaptcha = limiter.count(ipKey) >= captchaAfterPerIp
                || limiter.count(dayKey) >= CAPTCHA_AFTER_PER_PHONE_DAY;
        if (needCaptcha) {
            BizException.check(captchaId != null && captchaCode != null, ErrorCode.AUTH_CAPTCHA_REQUIRED);
            BizException.check(captcha.verify(captchaId, captchaCode), ErrorCode.AUTH_CAPTCHA_INVALID);
        }

        int interval = params.getInt("sms.code_interval_seconds", 60);
        String ivKey = "sms:iv:" + domain.audience() + ":" + hash;
        if (!kv.setIfAbsent(ivKey, "1", Duration.ofSeconds(interval))) {
            long left = Math.max(1, kv.ttl(ivKey).toSeconds());
            throw new BizException(ErrorCode.AUTH_CODE_TOO_FREQUENT, "验证码发送太频繁，请 " + left + " 秒后再试");
        }
        if (!limiter.tryAcquire(dayKey, params.getInt("sms.code_daily_limit", 10), Duration.ofDays(1))) {
            throw new BizException(ErrorCode.AUTH_CODE_DAILY_LIMIT);
        }
        if (!limiter.tryAcquire(ipKey, ipHourlyLimit, Duration.ofHours(1))) {
            throw new BizException(ErrorCode.SYS_TOO_MANY_REQUESTS);
        }

        String code = String.format("%06d", random.nextInt(1_000_000));
        kv.set(codeKey(domain, hash), code + ":0", CODE_TTL);
        String msgId = null;
        String status = "SENT";
        try {
            msgId = sender.send(phone, "LOGIN_CODE", Map.of("code", code));
        } catch (RuntimeException e) {
            status = "FAILED";
            log.warn("sms send failed phone={} err={}", Masks.phone(phone), e.getMessage());
        }
        jdbc.update("INSERT INTO sms_log (phone_hash, biz_type, template_code, provider_msg_id, status, ip) VALUES (?, 'LOGIN_CODE', 'LOGIN_CODE', ?, ?, ?)",
                hash, msgId, status, ip);
        if ("FAILED".equals(status)) {
            kv.delete(ivKey);
            kv.delete(codeKey(domain, hash));
            throw new BizException(ErrorCode.SYS_INTERNAL, "短信发送失败，请稍后再试");
        }
        return new SendResult(interval, sender.isMock() && exposeCodeInMock ? code : null);
    }

    /** 校验并作废验证码；失败抛 {@link ErrorCode#AUTH_CODE_INVALID}。 */
    public void verify(AuthDomain domain, String phone, String code) {
        BizException.check(Masks.isMobile(phone), ErrorCode.AUTH_PHONE_INVALID);
        BizException.check(code != null && code.matches("\\d{6}"), ErrorCode.AUTH_CODE_INVALID);
        String key = codeKey(domain, cipher.blindIndex(phone));
        String stored = kv.get(key).orElseThrow(() -> new BizException(ErrorCode.AUTH_CODE_INVALID));
        int sep = stored.indexOf(':');
        String expected = stored.substring(0, sep);
        int attempts = Integer.parseInt(stored.substring(sep + 1));
        if (!java.security.MessageDigest.isEqual(expected.getBytes(), code.getBytes())) {
            if (attempts + 1 >= MAX_ATTEMPTS) {
                kv.delete(key);
            } else {
                Duration left = kv.ttl(key);
                if (!left.isZero()) {
                    kv.set(key, expected + ":" + (attempts + 1), left);
                }
            }
            throw new BizException(ErrorCode.AUTH_CODE_INVALID);
        }
        kv.delete(key);
    }

    private static String codeKey(AuthDomain domain, String hash) {
        return "sms:code:" + domain.audience() + ":" + hash;
    }
}
