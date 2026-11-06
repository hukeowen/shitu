package com.shitu.lifecycle.domain;

import com.shitu.common.Constants;
import com.shitu.common.enums.ActorRole;
import com.shitu.common.enums.UserStatus;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;

import java.util.Objects;

/**
 * 纯函数状态机：根据当前快照 + 事件 + 上下文，计算迁移计划；不碰数据库。
 * 所有校验失败都抛 {@link BizException}，由调用方（LifecycleService）在事务内处理。
 */
public final class LifecycleStateMachine {

    private LifecycleStateMachine() {
    }

    public static TransitionPlan plan(UserSnapshot before, LifecycleEvent event, TransitionContext ctx) {
        Objects.requireNonNull(before, "before");
        Objects.requireNonNull(event, "event");
        Objects.requireNonNull(ctx, "ctx");

        if (!event.from().contains(before.status())) {
            if (event == LifecycleEvent.APPLY && before.status().isApplicationLocked()) {
                throw new BizException(ErrorCode.APP_DUPLICATE);
            }
            throw new BizException(ErrorCode.LC_ILLEGAL_TRANSITION,
                    "当前状态「" + before.status().label() + "」不允许执行「" + event.name() + "」");
        }
        if (!event.actors().contains(ctx.actor())) {
            throw new BizException(ErrorCode.LC_ACTOR_NOT_ALLOWED,
                    ctx.actor().label() + "不能执行「" + event.name() + "」");
        }
        checkTenantScope(before, event, ctx);

        String source = resolveSource(before, event, ctx);
        UserSnapshot after = switch (event.boundEffect()) {
            case KEEP -> new UserSnapshot(event.to(), source, before.boundCompanyId());
            case CLEAR -> new UserSnapshot(event.to(), source, null);
            case SET_TARGET -> new UserSnapshot(event.to(), source, requireTarget(before, event, ctx));
            case RESTORE_PRE_APPLY -> restorePreApply(before, ctx, source);
        };

        return new TransitionPlan(event, before, after, event.releaseReason(), quotaDelta(event, before, after),
                windowAction(event, after));
    }

    /**
     * 岗位名额变化（E-02 / D-12）：报名即 −1；一条有效报名在入职前结束（取消 / 爽约 / 面试未过 / 超时 / 公司注销）则 +1。
     */
    private static int quotaDelta(LifecycleEvent event, UserSnapshot before, UserSnapshot after) {
        if (event == LifecycleEvent.APPLY) {
            return -1;
        }
        boolean applicationEnded = before.status().isApplicationLocked()
                && !after.status().isApplicationLocked()
                && after.status() != UserStatus.EMPLOYED;
        return applicationEnded ? 1 : 0;
    }

    /** 租户角色只能操作当前归属于本公司的用户。 */
    private static void checkTenantScope(UserSnapshot before, LifecycleEvent event, TransitionContext ctx) {
        ActorRole a = ctx.actor();
        boolean tenantRole = a == ActorRole.SITE || a == ActorRole.BROKER || a == ActorRole.PM || a == ActorRole.OWNER;
        if (!tenantRole || event == LifecycleEvent.ROSTER_IMPORT) {
            return;
        }
        if (ctx.actorCompanyId() == null || !ctx.actorCompanyId().equals(before.boundCompanyId())) {
            throw new BizException(ErrorCode.SYS_FORBIDDEN, "该求职者不属于你所在的公司");
        }
    }

    /** source_company_id 只在注册 / 新用户花名册导入时写入一次，之后永不更改（R-05）。 */
    private static String resolveSource(UserSnapshot before, LifecycleEvent event, TransitionContext ctx) {
        if (before.sourceCompanyId() != null) {
            return before.sourceCompanyId();
        }
        return switch (event) {
            case REGISTER_VIA_COMPANY, ROSTER_IMPORT -> requireTarget(before, event, ctx);
            case REGISTER_PUBLIC -> Constants.PLATFORM;
            default -> throw new BizException(ErrorCode.LC_ILLEGAL_TRANSITION, "用户缺少来源归属");
        };
    }

    private static String requireTarget(UserSnapshot before, LifecycleEvent event, TransitionContext ctx) {
        String target = ctx.targetCompanyId();
        BizException.check(target != null && !target.isBlank(), ErrorCode.SYS_BAD_REQUEST, "缺少目标公司");
        BizException.check(!Constants.PLATFORM.equals(target), ErrorCode.SYS_BAD_REQUEST, "目标公司不能是平台");
        // 私域用户只能报名本公司岗位（匹配范围 = 仅本公司）
        if (event == LifecycleEvent.APPLY && before.isBound() && !target.equals(before.boundCompanyId())) {
            throw new BizException(ErrorCode.APP_NOT_FROM_MATCH, "只能报名当前归属公司的岗位");
        }
        return target;
    }

    /** D-31：面试未通过 / 取消报名，回到报名前的归属。 */
    private static UserSnapshot restorePreApply(UserSnapshot before, TransitionContext ctx, String source) {
        UserStatus pre = ctx.preApplyStatus();
        BizException.check(pre == UserStatus.PRIVATE_PENDING || pre == UserStatus.PUBLIC_SEEKING,
                ErrorCode.SYS_BAD_REQUEST, "缺少报名前状态");
        if (pre == UserStatus.PRIVATE_PENDING && before.boundCompanyId() != null
                && before.boundCompanyId().equals(ctx.preApplyBoundCompanyId())) {
            return new UserSnapshot(UserStatus.PRIVATE_PENDING, source, before.boundCompanyId());
        }
        return new UserSnapshot(UserStatus.PUBLIC_SEEKING, source, null);
    }

    private static TransitionPlan.WindowAction windowAction(LifecycleEvent event, UserSnapshot after) {
        if (DomainRules.responseWindowApplies(after)) {
            // 进入一个新的私域阶段：开启 / 重置（E-05：每个阶段完成时刻重置）
            boolean newStage = event.opensWindow() || event.boundEffect() == BoundEffect.RESTORE_PRE_APPLY;
            return newStage ? TransitionPlan.WindowAction.OPEN : TransitionPlan.WindowAction.NONE;
        }
        return TransitionPlan.WindowAction.CLOSE;
    }
}
