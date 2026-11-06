package com.shitu.lifecycle.seeker;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.shitu.common.Constants;
import com.shitu.common.enums.ActorRole;
import com.shitu.common.enums.ChannelType;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.id.BizIdGenerator;
import com.shitu.framework.outbox.OutboxWriter;
import com.shitu.framework.param.SysParams;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.framework.web.ClientInfo;
import com.shitu.framework.web.TraceIdFilter;
import com.shitu.lifecycle.domain.LifecycleEvent;
import com.shitu.lifecycle.domain.LifecycleStateMachine;
import com.shitu.lifecycle.domain.ResponseWindowPolicy;
import com.shitu.lifecycle.domain.TransitionContext;
import com.shitu.lifecycle.domain.TransitionPlan;
import com.shitu.lifecycle.domain.UserSnapshot;
import com.shitu.lifecycle.mapper.FollowUpReminderMapper;
import com.shitu.lifecycle.mapper.ResponseWindowMapper;
import com.shitu.lifecycle.mapper.SeekerUserMapper;
import com.shitu.lifecycle.mapper.UserStatusLogMapper;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZonedDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 用户生命周期的落库服务：所有对 user_status / bound_company_id 的修改都经过这里（02-架构 §7）。
 * <p>规则全部在 {@link LifecycleStateMachine}（纯领域、有完整单测）；这里只负责按迁移计划在同一事务内写：
 * 用户行、24h 窗口与跟进提醒排期、状态日志、发件箱事件。
 * <p>Sprint 1 实现注册；报名 / 面试 / 入职 / 释放等事件在 Sprint 2–3 复用 {@link #persist}。
 */
@Service
public class LifecycleService {

    /** 注册渠道：公司码（私域）或公域。 */
    public record RegisterChannel(String code, ChannelType type, String companyId) {
        public static RegisterChannel organic() {
            return new RegisterChannel(null, ChannelType.ORGANIC, null);
        }

        public boolean bindsCompany() {
            return type.bindsCompany() && companyId != null;
        }
    }

    private final SeekerUserMapper users;
    private final UserStatusLogMapper logs;
    private final ResponseWindowMapper windows;
    private final FollowUpReminderMapper reminders;
    private final FieldCipher cipher;
    private final BizIdGenerator ids;
    private final OutboxWriter outbox;
    private final SysParams params;
    private final Clock clock;

    public LifecycleService(SeekerUserMapper users, UserStatusLogMapper logs, ResponseWindowMapper windows,
                            FollowUpReminderMapper reminders, FieldCipher cipher, BizIdGenerator ids,
                            OutboxWriter outbox, SysParams params, Clock clock) {
        this.users = users;
        this.logs = logs;
        this.windows = windows;
        this.reminders = reminders;
        this.cipher = cipher;
        this.ids = ids;
        this.outbox = outbox;
        this.params = params;
        this.clock = clock;
    }

    public Optional<SeekerUser> findByPhone(String phone) {
        String hash = cipher.blindIndex(phone);
        return Optional.ofNullable(TenantContext.runAsSystem(() ->
                users.selectOne(new LambdaQueryWrapper<SeekerUser>().eq(SeekerUser::getPhoneHash, hash))));
    }

    public Optional<SeekerUser> find(String userId) {
        return Optional.ofNullable(TenantContext.runAsSystem(() -> users.selectById(userId)));
    }

    /**
     * 注册（C-104 / C-105）：
     * 公司码 → REGISTER_VIA_COMPANY：source = bound = 该公司，私域待匹配，开启 24h 窗口；
     * 自主 / 品牌广告 / 已入职员工分享 → REGISTER_PUBLIC：source = PLATFORM，公域。
     * 同一手机号并发注册时，唯一索引保证只建一个账号，后到者返回已存在的账号。
     *
     * @return 注册后的用户与是否新建
     */
    @Transactional
    public Registered register(String phone, RegisterChannel channel) {
        Optional<SeekerUser> exist = findByPhone(phone);
        if (exist.isPresent()) {
            return new Registered(exist.get(), false);
        }
        LifecycleEvent event = channel.bindsCompany() ? LifecycleEvent.REGISTER_VIA_COMPANY : LifecycleEvent.REGISTER_PUBLIC;
        TransitionContext ctx = TransitionContext.of(ActorRole.USER);
        if (channel.bindsCompany()) {
            ctx = ctx.withTarget(channel.companyId());
        }
        TransitionPlan plan = LifecycleStateMachine.plan(UserSnapshot.guest(), event, ctx);
        LocalDateTime now = LocalDateTime.now(clock);

        SeekerUser u = new SeekerUser();
        u.setUserId(ids.dated("U", 5));
        u.setPhoneEnc(cipher.encrypt(phone));
        u.setPhoneHash(cipher.blindIndex(phone));
        u.setKycStatus("NONE");
        u.setSourceCompanyId(plan.after().sourceCompanyId());
        u.setBoundCompanyId(plan.after().boundCompanyId());
        u.setUserStatus(plan.to());
        u.setRegisterChannelCode(channel.code());
        u.setRegisterChannelType(channel.type());
        u.setRegisteredAt(now);
        u.setCreatedAt(now);
        try {
            TenantContext.runAsSystem(() -> users.insert(u));
        } catch (DuplicateKeyException e) {
            return new Registered(findByPhone(phone).orElseThrow(() -> e), false);
        }
        persist(u.getUserId(), plan, ctx, null, null, now);
        return new Registered(u, true);
    }

    public record Registered(SeekerUser user, boolean created) {
    }

    /**
     * 按迁移计划写窗口、日志、事件（用户行已由调用方在同一事务内更新或插入）。
     */
    void persist(String userId, TransitionPlan plan, TransitionContext ctx, String applicationId, String actorId,
                 LocalDateTime now) {
        TenantContext.runAsSystem(() -> {
            switch (plan.window()) {
                case OPEN -> openWindow(userId, plan, applicationId, now);
                case CLOSE -> closeWindow(userId, now);
                case NONE -> {
                }
            }
            UserStatusLog log = new UserStatusLog();
            log.setUserId(userId);
            log.setEvent(plan.event().name());
            log.setFromStatus(plan.from().name());
            log.setToStatus(plan.to().name());
            log.setBoundBefore(plan.before().boundCompanyId());
            log.setBoundAfter(plan.after().boundCompanyId());
            log.setReleaseReason(plan.releaseReason() == null ? null : plan.releaseReason().name());
            log.setApplicationId(applicationId);
            log.setActorRole(ctx.actor().name());
            log.setActorId(actorId != null ? actorId : ctx.actor() == ActorRole.USER ? userId : null);
            log.setActorCompanyId(ctx.actorCompanyId());
            log.setIp(ClientInfo.ip());
            log.setTraceId(TraceIdFilter.current());
            log.setCreatedAt(now);
            logs.insert(log);

            Map<String, Object> payload = new HashMap<>();
            payload.put("userId", userId);
            payload.put("event", plan.event().name());
            payload.put("from", plan.from().name());
            payload.put("to", plan.to().name());
            payload.put("boundBefore", plan.before().boundCompanyId());
            payload.put("boundAfter", plan.after().boundCompanyId());
            payload.put("source", plan.after().sourceCompanyId());
            if (plan.releaseReason() != null) {
                payload.put("releaseReason", plan.releaseReason().name());
            }
            outbox.publish(plan.isRelease() ? "USER_RELEASED" : "USER_" + plan.event().name(), "USER", userId, payload);
            return null;
        });
    }

    private void openWindow(String userId, TransitionPlan plan, String applicationId, LocalDateTime now) {
        closeWindow(userId, now);
        ResponseWindowPolicy policy = policy();
        ZonedDateTime start = now.atZone(Constants.ZONE);
        ResponseWindow w = new ResponseWindow();
        w.setUserId(userId);
        w.setCompanyId(plan.after().boundCompanyId());
        w.setStage(plan.to().name());
        w.setApplicationId(applicationId);
        w.setStartedAt(now);
        w.setDeadline(policy.deadline(start).toLocalDateTime());
        w.setStatus(ResponseWindow.OPEN);
        windows.insert(w);
        List<ZonedDateTime> times = policy.followUpTimes(start);
        for (int i = 0; i < times.size(); i++) {
            FollowUpReminder r = new FollowUpReminder();
            r.setWindowId(w.getId());
            r.setRoundNo(i + 1);
            r.setRemindAt(times.get(i).toLocalDateTime());
            r.setStatus("PLANNED");
            reminders.insert(r);
        }
    }

    private void closeWindow(String userId, LocalDateTime now) {
        List<ResponseWindow> open = windows.selectList(new LambdaQueryWrapper<ResponseWindow>()
                .eq(ResponseWindow::getUserId, userId).eq(ResponseWindow::getStatus, ResponseWindow.OPEN));
        for (ResponseWindow w : open) {
            windows.update(null, new LambdaUpdateWrapper<ResponseWindow>()
                    .eq(ResponseWindow::getId, w.getId())
                    .set(ResponseWindow::getStatus, ResponseWindow.CLOSED)
                    .set(ResponseWindow::getClosedAt, now));
            reminders.update(null, new LambdaUpdateWrapper<FollowUpReminder>()
                    .eq(FollowUpReminder::getWindowId, w.getId())
                    .eq(FollowUpReminder::getStatus, "PLANNED")
                    .set(FollowUpReminder::getStatus, "CANCELLED"));
        }
    }

    /** 窗口参数由平台中台配置（D-06 / D-14）。 */
    ResponseWindowPolicy policy() {
        ResponseWindowPolicy d = ResponseWindowPolicy.DEFAULT;
        try {
            return new ResponseWindowPolicy(
                    Duration.parse(params.getString("response_window.duration", d.window().toString())),
                    LocalTime.parse(params.getString("response_window.day_start", d.dayStart().toString())),
                    LocalTime.parse(params.getString("response_window.day_end", d.dayEnd().toString())),
                    Duration.parse(params.getString("response_window.day_interval", d.dayInterval().toString())),
                    Duration.parse(params.getString("response_window.night_interval", d.nightInterval().toString())));
        } catch (RuntimeException e) {
            return d;
        }
    }

    /** 当前开启的 24h 窗口（C 端首页倒计时）。 */
    public Optional<ResponseWindow> openWindowOf(String userId) {
        return Optional.ofNullable(TenantContext.runAsSystem(() -> windows.selectOne(new LambdaQueryWrapper<ResponseWindow>()
                .eq(ResponseWindow::getUserId, userId).eq(ResponseWindow::getStatus, ResponseWindow.OPEN))));
    }

    /** 渠道注册数（渠道码统计）。 */
    public Map<String, Long> registrationsByChannel(java.util.Collection<String> codes) {
        Map<String, Long> m = new HashMap<>();
        if (codes == null || codes.isEmpty()) {
            return m;
        }
        TenantContext.runAsSystem(() -> users.selectMaps(new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<SeekerUser>()
                        .select("register_channel_code AS code", "COUNT(*) AS cnt")
                        .in("register_channel_code", codes)
                        .groupBy("register_channel_code")))
                .forEach(row -> m.put(String.valueOf(row.get("code")), ((Number) row.get("cnt")).longValue()));
        return m;
    }
}
