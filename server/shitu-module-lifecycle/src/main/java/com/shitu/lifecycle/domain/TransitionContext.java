package com.shitu.lifecycle.domain;

import com.shitu.common.enums.ActorRole;
import com.shitu.common.enums.UserStatus;

import java.util.Objects;

/**
 * 迁移的输入参数。
 *
 * @param actor               操作方角色
 * @param actorCompanyId      操作人所属公司（租户角色必填；USER / SYSTEM / OPS 可空）
 * @param targetCompanyId     SET_TARGET 类事件的目标公司（注册渠道公司 / 报名岗位所属公司 / 花名册公司）
 * @param preApplyStatus      RESTORE_PRE_APPLY 类事件必填：报名前的状态（记录在 application 上）
 * @param preApplyBoundCompanyId 报名前的 bound（公域为 null）
 */
public record TransitionContext(ActorRole actor,
                                String actorCompanyId,
                                String targetCompanyId,
                                UserStatus preApplyStatus,
                                String preApplyBoundCompanyId) {

    public TransitionContext {
        Objects.requireNonNull(actor, "actor");
    }

    public static TransitionContext of(ActorRole actor) {
        return new TransitionContext(actor, null, null, null, null);
    }

    public static TransitionContext tenant(ActorRole actor, String actorCompanyId) {
        return new TransitionContext(actor, actorCompanyId, null, null, null);
    }

    public TransitionContext withTarget(String companyId) {
        return new TransitionContext(actor, actorCompanyId, companyId, preApplyStatus, preApplyBoundCompanyId);
    }

    public TransitionContext withPreApply(UserStatus status, String boundCompanyId) {
        return new TransitionContext(actor, actorCompanyId, targetCompanyId, status, boundCompanyId);
    }
}
