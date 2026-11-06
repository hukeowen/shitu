package com.shitu.lifecycle.domain;

import com.shitu.common.enums.DomainTag;
import com.shitu.common.enums.MatchScope;
import com.shitu.common.enums.UserStatus;

/**
 * 公私域与匹配范围的派生规则（spec §07）。两者都不落库，所有地方统一调用这里。
 */
public final class DomainRules {

    private DomainRules() {
    }

    /** bound 为空 = 公域；报名锁定期 = 临时私域；其余有归属 = 私域。 */
    public static DomainTag domainTag(UserSnapshot u) {
        if (!u.isBound()) {
            return DomainTag.PUBLIC;
        }
        return u.status().isApplicationLocked() ? DomainTag.TEMP_PRIVATE : DomainTag.PRIVATE;
    }

    public static MatchScope matchScope(UserSnapshot u) {
        UserStatus s = u.status();
        if (s == UserStatus.GUEST) {
            return MatchScope.NONE;
        }
        if (s.isApplicationLocked()) {
            return MatchScope.LOCKED;
        }
        if (s == UserStatus.EMPLOYED) {
            return MatchScope.INTERNAL_TRANSFER_ONLY;
        }
        return u.isBound() ? MatchScope.OWN_COMPANY : MatchScope.ALL_PLATFORM;
    }

    /** 能否进入 AI 问薪（R-03）。在岗用户走内部调岗，不走 C 端问薪。 */
    public static boolean canStartMatching(UserSnapshot u) {
        MatchScope scope = matchScope(u);
        return scope == MatchScope.ALL_PLATFORM || scope == MatchScope.OWN_COMPANY;
    }

    /** 24h 响应窗口只对私域（含临时私域）的未入职阶段生效（R-08）；公域用户不触发。 */
    public static boolean responseWindowApplies(UserSnapshot u) {
        if (!u.isBound()) {
            return false;
        }
        UserStatus s = u.status();
        return s == UserStatus.PRIVATE_PENDING
                || s == UserStatus.PENDING_INTERVIEW
                || s == UserStatus.PENDING_CONFIRM;
    }
}
