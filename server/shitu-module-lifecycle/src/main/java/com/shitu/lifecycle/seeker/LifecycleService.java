package com.shitu.lifecycle.seeker;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.shitu.common.Constants;
import com.shitu.common.enums.ActorRole;
import com.shitu.common.enums.ApplicationStatus;
import com.shitu.common.enums.ChannelType;
import com.shitu.common.enums.UserStatus;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.id.BizIdGenerator;
import com.shitu.framework.outbox.OutboxWriter;
import com.shitu.framework.param.SysParams;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.framework.web.ClientInfo;
import com.shitu.framework.web.TraceIdFilter;
import com.shitu.job.mapper.JobMapper;
import com.shitu.lifecycle.domain.LifecycleEvent;
import com.shitu.lifecycle.domain.LifecycleStateMachine;
import com.shitu.lifecycle.domain.ResponseWindowPolicy;
import com.shitu.lifecycle.domain.TransitionContext;
import com.shitu.lifecycle.domain.TransitionPlan;
import com.shitu.lifecycle.domain.UserSnapshot;
import com.shitu.lifecycle.mapper.ApplicationMapper;
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
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 用户生命周期的落库服务：所有对 user_status / bound_company_id 的修改都经过这里（02-架构 §7）。
 * <p>规则全部在 {@link LifecycleStateMachine}（纯领域、有完整单测）；这里按迁移计划在<b>同一事务</b>内写：
 * 用户行（先 {@code SELECT … FOR UPDATE} 锁住）、报名单、岗位名额、24h 窗口与跟进排期、状态日志、发件箱事件。
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

    public record Registered(SeekerUser user, boolean created) {
    }

    /** 报名所需的岗位信息（由调用方校验岗位来自匹配结果后传入）。 */
    public record ApplyCommand(String userId, String jobId, String companyId, String projectId, String jobTitle,
                               String interviewAddress, String matchSessionId, Long brokerCaseId) {
    }

    public record TransitionResult(TransitionPlan plan, String applicationId) {
    }

    private final SeekerUserMapper users;
    private final UserStatusLogMapper logs;
    private final ResponseWindowMapper windows;
    private final FollowUpReminderMapper reminders;
    private final ApplicationMapper applications;
    private final JobMapper jobs;
    private final FieldCipher cipher;
    private final BizIdGenerator ids;
    private final OutboxWriter outbox;
    private final SysParams params;
    private final Clock clock;

    public LifecycleService(SeekerUserMapper users, UserStatusLogMapper logs, ResponseWindowMapper windows,
                            FollowUpReminderMapper reminders, ApplicationMapper applications, JobMapper jobs,
                            FieldCipher cipher, BizIdGenerator ids, OutboxWriter outbox, SysParams params, Clock clock) {
        this.users = users;
        this.logs = logs;
        this.windows = windows;
        this.reminders = reminders;
        this.applications = applications;
        this.jobs = jobs;
        this.cipher = cipher;
        this.ids = ids;
        this.outbox = outbox;
        this.params = params;
        this.clock = clock;
    }

    // ================================================================== 查询

    public Optional<SeekerUser> findByPhone(String phone) {
        String hash = cipher.blindIndex(phone);
        return Optional.ofNullable(TenantContext.runAsSystem(() ->
                users.selectOne(new LambdaQueryWrapper<SeekerUser>().eq(SeekerUser::getPhoneHash, hash))));
    }

    public Optional<SeekerUser> find(String userId) {
        return Optional.ofNullable(TenantContext.runAsSystem(() -> users.selectById(userId)));
    }

    /** 当前开启的 24h 窗口（C 端首页倒计时）。 */
    public Optional<ResponseWindow> openWindowOf(String userId) {
        return Optional.ofNullable(TenantContext.runAsSystem(() -> windows.selectOne(new LambdaQueryWrapper<ResponseWindow>()
                .eq(ResponseWindow::getUserId, userId).eq(ResponseWindow::getStatus, ResponseWindow.OPEN))));
    }

    /** 渠道注册数（渠道码统计）。 */
    public Map<String, Long> registrationsByChannel(Collection<String> codes) {
        Map<String, Long> m = new HashMap<>();
        if (codes == null || codes.isEmpty()) {
            return m;
        }
        TenantContext.runAsSystem(() -> users.selectMaps(new QueryWrapper<SeekerUser>()
                        .select("register_channel_code AS code", "COUNT(*) AS cnt")
                        .in("register_channel_code", codes)
                        .groupBy("register_channel_code")))
                .forEach(row -> m.put(String.valueOf(row.get("code")), ((Number) row.get("cnt")).longValue()));
        return m;
    }

    // ================================================================== 注册

    /**
     * 注册（C-104 / C-105）：
     * 公司码 → REGISTER_VIA_COMPANY：source = bound = 该公司，私域待匹配，开启 24h 窗口；
     * 自主 / 品牌广告 / 已入职员工分享 → REGISTER_PUBLIC：source = PLATFORM，公域。
     * 同一手机号并发注册时，唯一索引保证只建一个账号，后到者返回已存在的账号。
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
        persist(u.getUserId(), plan, ctx, null, null, null, now, ResponseWindow.CLOSED);
        return new Registered(u, true);
    }

    /**
     * 花名册导入新用户（T-503）：ROSTER_IMPORT 直接为私域在岗，来源 = 导入公司（R-05）。已有账号的用户走 {@link #transition}。
     */
    @Transactional
    public SeekerUser rosterCreate(String phone, String companyId, ActorRole actor, String actorId) {
        TransitionContext ctx = (actor == ActorRole.OPS ? TransitionContext.of(ActorRole.OPS)
                : TransitionContext.tenant(actor, companyId)).withTarget(companyId);
        TransitionPlan plan = LifecycleStateMachine.plan(UserSnapshot.guest(), LifecycleEvent.ROSTER_IMPORT, ctx);
        LocalDateTime now = LocalDateTime.now(clock);
        SeekerUser u = new SeekerUser();
        u.setUserId(ids.dated("U", 5));
        u.setPhoneEnc(cipher.encrypt(phone));
        u.setPhoneHash(cipher.blindIndex(phone));
        u.setKycStatus("NONE");
        u.setSourceCompanyId(plan.after().sourceCompanyId());
        u.setBoundCompanyId(plan.after().boundCompanyId());
        u.setUserStatus(plan.to());
        u.setRegisterChannelType(ChannelType.ROSTER_IMPORT);
        u.setRegisteredAt(now);
        u.setCreatedAt(now);
        TenantContext.runAsSystem(() -> users.insert(u));
        persist(u.getUserId(), plan, ctx, null, actorId, "花名册导入", now, ResponseWindow.CLOSED);
        return u;
    }

    // ================================================================== 报名

    /**
     * 报名（C-407）：公域 → 私域的唯一转变点。同一事务内：锁用户 → 状态机校验 → 原子扣名额 → 建报名单（唯一索引防重复）
     * → 写用户（bound = 岗位所属公司、待面试）→ 重开 24h 窗口 → 日志 → 事件（通知驻场）。
     * 实名、年龄、黑名单、告知书、「岗位必须来自匹配结果」由调用方在此之前校验。
     */
    @Transactional
    public TransitionResult apply(ApplyCommand cmd) {
        SeekerUser u = lock(cmd.userId());
        TransitionContext ctx = TransitionContext.of(ActorRole.USER).withTarget(cmd.companyId());
        TransitionPlan plan = LifecycleStateMachine.plan(u.snapshot(), LifecycleEvent.APPLY, ctx);
        if (jobs.takeQuota(cmd.jobId()) != 1) {
            throw new BizException(ErrorCode.APP_QUOTA_FULL);
        }
        LocalDateTime now = LocalDateTime.now(clock);
        Application a = new Application();
        a.setApplicationId(ids.dated("BM", 4));
        a.setUserId(u.getUserId());
        a.setCompanyId(cmd.companyId());
        a.setProjectId(cmd.projectId());
        a.setJobId(cmd.jobId());
        a.setMatchSessionId(cmd.matchSessionId());
        a.setBrokerCaseId(cmd.brokerCaseId());
        a.setPreApplyStatus(u.getUserStatus());
        a.setPreApplyBound(u.getBoundCompanyId());
        a.setStatus(ApplicationStatus.PENDING_INTERVIEW);
        a.setInterviewAddress(cmd.interviewAddress());
        a.setCreatedAt(now);
        try {
            applications.insert(a);
        } catch (DuplicateKeyException e) {
            throw new BizException(ErrorCode.APP_DUPLICATE);
        }
        writeUser(u, plan, a.getApplicationId(), now);
        persist(u.getUserId(), plan, ctx, a.getApplicationId(), u.getUserId(), null, now, ResponseWindow.CLOSED);
        outbox.publish("APPLICATION_CREATED", "APPLICATION", a.getApplicationId(), Map.of(
                "userId", u.getUserId(), "companyId", cmd.companyId(), "projectId", cmd.projectId(),
                "jobId", cmd.jobId(), "jobTitle", cmd.jobTitle() == null ? "" : cmd.jobTitle(),
                "fromPublic", u.getBoundCompanyId() == null));
        return new TransitionResult(plan, a.getApplicationId());
    }

    // ================================================================== 通用迁移

    /**
     * 除注册、报名以外的迁移（面试通过 / 未通过、取消、爽约、超时、确权、释放、离职、公司注销……）。
     * 涉及当前报名单的事件会同时结束报名单并按计划回补名额。
     *
     * @param actorId 操作人（成员 / 运营 ID；系统为 null）
     * @param remark  原因说明（取消、释放等后台操作必填，由调用方校验）
     */
    @Transactional
    public TransitionResult transition(String userId, LifecycleEvent event, TransitionContext ctx, String actorId,
                                       String remark) {
        BizException.check(event != LifecycleEvent.APPLY && !event.isRegistration(), ErrorCode.SYS_BAD_REQUEST);
        SeekerUser u = lock(userId);
        Application app = null;
        if (u.getCurrentApplicationId() != null && u.getUserStatus().isApplicationLocked()) {
            String appId = u.getCurrentApplicationId();
            app = TenantContext.runAsSystem(() -> applications.selectById(appId));
        }
        if (app != null) {
            ctx = ctx.withPreApply(app.getPreApplyStatus(), app.getPreApplyBound());
        }
        TransitionPlan plan = LifecycleStateMachine.plan(u.snapshot(), event, ctx);
        LocalDateTime now = LocalDateTime.now(clock);

        String appId = app == null ? null : app.getApplicationId();
        ApplicationStatus appStatus = applicationStatusAfter(event);
        if (app != null && appStatus != null) {
            boolean ended = appStatus != ApplicationStatus.PENDING_CONFIRM && appStatus != ApplicationStatus.EMPLOYED;
            LambdaUpdateWrapper<Application> w = new LambdaUpdateWrapper<Application>()
                    .eq(Application::getApplicationId, appId)
                    .set(Application::getStatus, appStatus)
                    .setSql("version = version + 1");
            if (event == LifecycleEvent.INTERVIEW_PASS) {
                w.set(Application::getInterviewResult, "PASS");
            } else if (event == LifecycleEvent.INTERVIEW_FAIL) {
                w.set(Application::getInterviewResult, "FAIL");
            }
            if (ended) {
                w.set(Application::getEndedAt, now).set(Application::getEndReason, event.name())
                        .set(Application::getEndOperatorId, actorId).set(Application::getEndRemark, remark);
            }
            TenantContext.runAsSystem(() -> applications.update(null, w));
        }
        if (plan.quotaDelta() > 0 && app != null) {
            String jobId = app.getJobId();
            TenantContext.runAsSystem(() -> jobs.returnQuota(jobId));
        }
        boolean appStillActive = plan.to().isApplicationLocked() || plan.to() == UserStatus.EMPLOYED;
        writeUser(u, plan, appStillActive ? appId : null, now);
        String closeAs = event == LifecycleEvent.TIMEOUT_24H || event == LifecycleEvent.CONFIRM_TIMEOUT
                ? ResponseWindow.FIRED : ResponseWindow.CLOSED;
        persist(userId, plan, ctx, appId, actorId, remark, now, closeAs);
        return new TransitionResult(plan, appId);
    }

    static ApplicationStatus applicationStatusAfter(LifecycleEvent e) {
        return switch (e) {
            case INTERVIEW_PASS -> ApplicationStatus.PENDING_CONFIRM;
            case CONTRACT_SIGNED -> ApplicationStatus.EMPLOYED;
            case INTERVIEW_FAIL -> ApplicationStatus.INTERVIEW_FAILED;
            case CANCEL_APPLICATION, COMPANY_CLOSED -> ApplicationStatus.CANCELLED;
            case MARK_NO_SHOW -> ApplicationStatus.NO_SHOW;
            case TIMEOUT_24H, CONFIRM_TIMEOUT -> ApplicationStatus.TIMEOUT;
            default -> null;
        };
    }

    /** 匹配次数 +1、画像版本 +1（C-303 / D-11）；返回本求职周期累计匹配次数。 */
    @Transactional
    public int recordMatch(String userId) {
        TenantContext.runAsSystem(() -> users.update(null, new LambdaUpdateWrapper<SeekerUser>()
                .eq(SeekerUser::getUserId, userId)
                .setSql("match_cycle_count = match_cycle_count + 1, profile_version = profile_version + 1")));
        return find(userId).map(SeekerUser::getMatchCycleCount).orElse(0);
    }

    // ================================================================== 内部

    private SeekerUser lock(String userId) {
        SeekerUser u = TenantContext.runAsSystem(() -> users.selectOne(new LambdaQueryWrapper<SeekerUser>()
                .eq(SeekerUser::getUserId, userId).last("FOR UPDATE")));
        BizException.check(u != null, ErrorCode.SYS_NOT_FOUND, "用户不存在");
        return u;
    }

    private void writeUser(SeekerUser u, TransitionPlan plan, String currentApplicationId, LocalDateTime now) {
        LambdaUpdateWrapper<SeekerUser> w = new LambdaUpdateWrapper<SeekerUser>()
                .eq(SeekerUser::getUserId, u.getUserId())
                .eq(SeekerUser::getVersion, u.getVersion())
                .set(SeekerUser::getUserStatus, plan.to())
                .set(SeekerUser::getBoundCompanyId, plan.after().boundCompanyId())
                .set(SeekerUser::getCurrentApplicationId, currentApplicationId)
                .setSql("version = version + 1");
        if (plan.isRelease()) {
            // 新的求职周期：匹配次数清零（D-11 按求职周期计）
            w.set(SeekerUser::getLastReleaseReason, plan.releaseReason()).set(SeekerUser::getMatchCycleCount, 0);
        }
        int rows = TenantContext.runAsSystem(() -> users.update(null, w));
        BizException.check(rows == 1, ErrorCode.SYS_CONFLICT);
    }

    /** 按迁移计划写窗口、日志、事件。 */
    private void persist(String userId, TransitionPlan plan, TransitionContext ctx, String applicationId, String actorId,
                         String remark, LocalDateTime now, String closeWindowAs) {
        TenantContext.runAsSystem(() -> {
            switch (plan.window()) {
                case OPEN -> openWindow(userId, plan, applicationId, now);
                case CLOSE -> closeWindow(userId, now, closeWindowAs);
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
            log.setRemark(remark);
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
            if (applicationId != null) {
                payload.put("applicationId", applicationId);
            }
            if (plan.releaseReason() != null) {
                payload.put("releaseReason", plan.releaseReason().name());
            }
            outbox.publish(plan.isRelease() ? "USER_RELEASED" : "USER_" + plan.event().name(), "USER", userId, payload);
            return null;
        });
    }

    private void openWindow(String userId, TransitionPlan plan, String applicationId, LocalDateTime now) {
        closeWindow(userId, now, ResponseWindow.CLOSED);
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

    private void closeWindow(String userId, LocalDateTime now, String as) {
        List<ResponseWindow> open = windows.selectList(new LambdaQueryWrapper<ResponseWindow>()
                .eq(ResponseWindow::getUserId, userId).eq(ResponseWindow::getStatus, ResponseWindow.OPEN));
        for (ResponseWindow w : open) {
            windows.update(null, new LambdaUpdateWrapper<ResponseWindow>()
                    .eq(ResponseWindow::getId, w.getId())
                    .set(ResponseWindow::getStatus, as)
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
}
