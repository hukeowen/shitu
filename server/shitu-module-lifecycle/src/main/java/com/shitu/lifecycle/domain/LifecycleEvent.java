package com.shitu.lifecycle.domain;

import com.shitu.common.enums.ActorRole;
import com.shitu.common.enums.ReleaseReason;
import com.shitu.common.enums.UserStatus;

import java.util.EnumSet;
import java.util.Set;

import static com.shitu.common.enums.ActorRole.BROKER;
import static com.shitu.common.enums.ActorRole.OPS;
import static com.shitu.common.enums.ActorRole.PM;
import static com.shitu.common.enums.ActorRole.SITE;
import static com.shitu.common.enums.ActorRole.SYSTEM;
import static com.shitu.common.enums.ActorRole.USER;
import static com.shitu.common.enums.UserStatus.EMPLOYED;
import static com.shitu.common.enums.UserStatus.GUEST;
import static com.shitu.common.enums.UserStatus.PENDING_CONFIRM;
import static com.shitu.common.enums.UserStatus.PENDING_INTERVIEW;
import static com.shitu.common.enums.UserStatus.PRIVATE_PENDING;
import static com.shitu.common.enums.UserStatus.PUBLIC_SEEKING;

/**
 * 用户状态迁移表 —— 全系统最核心的一张表（spec §03，按 D-08 / D-31 修订）。
 * <p>
 * 每个事件声明：允许的起始状态、目标状态（null = 由 {@link BoundEffect#RESTORE_PRE_APPLY} 决定）、
 * 允许的操作方、对 bound 的影响、释放原因码、名额变化、是否开启 / 关闭 24h 窗口。
 * <p>
 * 禁止的迁移由「不在表内」天然保证：用户不能自行释放；EMPLOYED 只能经 RESIGN 离开；
 * source_company_id 只在注册类事件写入一次。
 */
public enum LifecycleEvent {

    /** 劳务公司二维码 / 分享链接注册：source = bound = 该公司，启动 24h。 */
    REGISTER_VIA_COMPANY(EnumSet.of(GUEST), PRIVATE_PENDING, EnumSet.of(USER),
            BoundEffect.SET_TARGET, null, true),

    /** 自主注册 / 品牌广告 / 已入职员工分享：source = PLATFORM，公域，不启动 24h。 */
    REGISTER_PUBLIC(EnumSet.of(GUEST), PUBLIC_SEEKING, EnumSet.of(USER),
            BoundEffect.CLEAR, null, false),

    /** 花名册导入：直接为私域在岗。新用户 source = 该公司；已有用户 source 不变。 */
    ROSTER_IMPORT(EnumSet.of(GUEST, PUBLIC_SEEKING), EMPLOYED, EnumSet.of(PM, OPS),
            BoundEffect.SET_TARGET, null, false),

    /** 报名：公域 → 私域的唯一转变点；名额 −1；重置 24h。 */
    APPLY(EnumSet.of(PUBLIC_SEEKING, PRIVATE_PENDING), PENDING_INTERVIEW, EnumSet.of(USER),
            BoundEffect.SET_TARGET, null, true),

    /** 到厂确认 + 面试通过：重置 24h（确权窗口）。 */
    INTERVIEW_PASS(EnumSet.of(PENDING_INTERVIEW), PENDING_CONFIRM, EnumSet.of(SITE, PM),
            BoundEffect.KEEP, null, true),

    /** 电子签约完成回调：唯一统计节点，启动计费，关闭 24h。 */
    CONTRACT_SIGNED(EnumSet.of(PENDING_CONFIRM), EMPLOYED, EnumSet.of(SYSTEM),
            BoundEffect.KEEP, null, false),

    /** 面试未通过：恢复到报名前的归属（D-31）；名额 +1。 */
    INTERVIEW_FAIL(EnumSet.of(PENDING_INTERVIEW), null, EnumSet.of(SITE, PM),
            BoundEffect.RESTORE_PRE_APPLY, ReleaseReason.INTERVIEW_FAILED, false),

    /** 后台取消报名（用户不可自行取消，R-04）：恢复到报名前的归属；名额 +1。 */
    CANCEL_APPLICATION(EnumSet.of(PENDING_INTERVIEW, PENDING_CONFIRM), null, EnumSet.of(SITE, PM),
            BoundEffect.RESTORE_PRE_APPLY, ReleaseReason.CANCELLED, false),

    /** 爽约：当日释放至全平台公域（文档 7.4）；名额 +1。 */
    MARK_NO_SHOW(EnumSet.of(PENDING_INTERVIEW), PUBLIC_SEEKING, EnumSet.of(SITE),
            BoundEffect.CLEAR, ReleaseReason.NO_SHOW, false),

    /** 待匹配 / 待面试阶段 24h 无跟进，系统被动释放（D-06）。 */
    TIMEOUT_24H(EnumSet.of(PRIVATE_PENDING, PENDING_INTERVIEW), PUBLIC_SEEKING, EnumSet.of(SYSTEM),
            BoundEffect.CLEAR, ReleaseReason.TIMEOUT_24H, false),

    /** 面试通过后 24h 未完成入职确权。 */
    CONFIRM_TIMEOUT(EnumSet.of(PENDING_CONFIRM), PUBLIC_SEEKING, EnumSet.of(SYSTEM),
            BoundEffect.CLEAR, ReleaseReason.CONFIRM_TIMEOUT, false),

    /** 主动释放：仅限未匹配状态（文档 3.3），驻场 / 经纪人操作（A-19）。 */
    RELEASE_MANUAL(EnumSet.of(PRIVATE_PENDING), PUBLIC_SEEKING, EnumSet.of(SITE, BROKER),
            BoundEffect.CLEAR, ReleaseReason.MANUAL, false),

    /** 经纪人 SLA 超时未处理，自动释放（D-10）。 */
    BROKER_SLA_TIMEOUT(EnumSet.of(PRIVATE_PENDING), PUBLIC_SEEKING, EnumSet.of(SYSTEM),
            BoundEffect.CLEAR, ReleaseReason.BROKER_SLA_TIMEOUT, false),

    /** 离职：停止全部计费，合同终止，结清欠款。 */
    RESIGN(EnumSet.of(EMPLOYED), PUBLIC_SEEKING, EnumSet.of(SITE, PM),
            BoundEffect.CLEAR, ReleaseReason.RESIGNED, false),

    /** 内部调岗：bound 不变，计费不中断（E-07）。 */
    INTERNAL_TRANSFER(EnumSet.of(EMPLOYED), EMPLOYED, EnumSet.of(PM),
            BoundEffect.KEEP, null, false),

    /** 公司注销 / 倒闭：批量解绑，source 保留仅存证。 */
    COMPANY_CLOSED(EnumSet.of(PRIVATE_PENDING, PENDING_INTERVIEW, PENDING_CONFIRM, EMPLOYED), PUBLIC_SEEKING,
            EnumSet.of(OPS, SYSTEM), BoundEffect.CLEAR, ReleaseReason.COMPANY_CLOSED, false);

    private final Set<UserStatus> from;
    private final UserStatus to;
    private final Set<ActorRole> actors;
    private final BoundEffect boundEffect;
    private final ReleaseReason releaseReason;
    private final boolean opensWindow;

    LifecycleEvent(Set<UserStatus> from, UserStatus to, Set<ActorRole> actors, BoundEffect boundEffect,
                   ReleaseReason releaseReason, boolean opensWindow) {
        this.from = from;
        this.to = to;
        this.actors = actors;
        this.boundEffect = boundEffect;
        this.releaseReason = releaseReason;
        this.opensWindow = opensWindow;
    }

    public Set<UserStatus> from() {
        return from;
    }

    /** 固定目标状态；RESTORE_PRE_APPLY 类事件返回 null，由状态机按报名前状态计算。 */
    public UserStatus to() {
        return to;
    }

    public Set<ActorRole> actors() {
        return actors;
    }

    public BoundEffect boundEffect() {
        return boundEffect;
    }

    public ReleaseReason releaseReason() {
        return releaseReason;
    }

    public boolean opensWindow() {
        return opensWindow;
    }

    public boolean isRegistration() {
        return this == REGISTER_VIA_COMPANY || this == REGISTER_PUBLIC;
    }
}
