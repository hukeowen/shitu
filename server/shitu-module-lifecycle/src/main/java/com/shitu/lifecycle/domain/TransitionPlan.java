package com.shitu.lifecycle.domain;

import com.shitu.common.enums.ReleaseReason;
import com.shitu.common.enums.UserStatus;

/**
 * 状态机计算出的迁移计划。LifecycleService 在同一事务内按计划落库：
 * 写用户、调名额、开 / 关 24h 窗口、写 user_status_log、写 outbox_event。
 *
 * @param window 对 24h 窗口的操作
 */
public record TransitionPlan(LifecycleEvent event,
                             UserSnapshot before,
                             UserSnapshot after,
                             ReleaseReason releaseReason,
                             int quotaDelta,
                             WindowAction window) {

    public enum WindowAction {
        /** 开启（或重置）24h 窗口。 */
        OPEN,
        /** 关闭当前窗口。 */
        CLOSE,
        /** 无窗口变化。 */
        NONE
    }

    public boolean isRelease() {
        return before.isBound() && !after.isBound();
    }

    public UserStatus from() {
        return before.status();
    }

    public UserStatus to() {
        return after.status();
    }
}
