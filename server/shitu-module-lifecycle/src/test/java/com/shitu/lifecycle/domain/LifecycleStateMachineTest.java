package com.shitu.lifecycle.domain;

import com.shitu.common.Constants;
import com.shitu.common.enums.ActorRole;
import com.shitu.common.enums.DomainTag;
import com.shitu.common.enums.MatchScope;
import com.shitu.common.enums.ReleaseReason;
import com.shitu.common.enums.UserStatus;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import java.util.EnumSet;

import static com.shitu.common.enums.UserStatus.*;
import static com.shitu.lifecycle.domain.LifecycleEvent.*;
import static com.shitu.lifecycle.domain.TransitionPlan.WindowAction.CLOSE;
import static com.shitu.lifecycle.domain.TransitionPlan.WindowAction.OPEN;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class LifecycleStateMachineTest {

    static final String A = "C10023";
    static final String B = "C20001";

    static UserSnapshot user(UserStatus s, String source, String bound) {
        return new UserSnapshot(s, source, bound);
    }

    static TransitionContext site(String company) {
        return TransitionContext.tenant(ActorRole.SITE, company);
    }

    static TransitionContext system() {
        return TransitionContext.of(ActorRole.SYSTEM);
    }

    static TransitionContext userApplying(String jobCompany) {
        return TransitionContext.of(ActorRole.USER).withTarget(jobCompany);
    }

    static void assertRejected(Runnable r, ErrorCode code) {
        assertThatThrownBy(r::run).isInstanceOf(BizException.class)
                .extracting(e -> ((BizException) e).getErrorCode()).isEqualTo(code);
    }

    @Nested
    @DisplayName("注册与渠道绑定（节点二）")
    class Registration {
        @Test
        void 公司二维码注册_私域_来源与归属都是该公司_开启24h() {
            TransitionPlan p = LifecycleStateMachine.plan(UserSnapshot.guest(), REGISTER_VIA_COMPANY,
                    TransitionContext.of(ActorRole.USER).withTarget(A));
            assertThat(p.after()).isEqualTo(user(PRIVATE_PENDING, A, A));
            assertThat(DomainRules.domainTag(p.after())).isEqualTo(DomainTag.PRIVATE);
            assertThat(DomainRules.matchScope(p.after())).isEqualTo(MatchScope.OWN_COMPANY);
            assertThat(p.window()).isEqualTo(OPEN);
        }

        @Test
        void 自主注册_公域_来源为平台_不开24h() {
            TransitionPlan p = LifecycleStateMachine.plan(UserSnapshot.guest(), REGISTER_PUBLIC,
                    TransitionContext.of(ActorRole.USER));
            assertThat(p.after()).isEqualTo(user(PUBLIC_SEEKING, Constants.PLATFORM, null));
            assertThat(DomainRules.matchScope(p.after())).isEqualTo(MatchScope.ALL_PLATFORM);
            assertThat(p.window()).isEqualTo(CLOSE);
        }

        @Test
        void 已注册用户不能再次注册_来源永不改变() {
            assertRejected(() -> LifecycleStateMachine.plan(user(PUBLIC_SEEKING, Constants.PLATFORM, null),
                    REGISTER_VIA_COMPANY, TransitionContext.of(ActorRole.USER).withTarget(B)),
                    ErrorCode.LC_ILLEGAL_TRANSITION);
        }

        @Test
        void 花名册导入新用户_直接在岗_来源为该公司() {
            TransitionPlan p = LifecycleStateMachine.plan(UserSnapshot.guest(), ROSTER_IMPORT,
                    TransitionContext.tenant(ActorRole.PM, A).withTarget(A));
            assertThat(p.after()).isEqualTo(user(EMPLOYED, A, A));
        }

        @Test
        void 花名册导入已有公域用户_来源保持平台() {
            TransitionPlan p = LifecycleStateMachine.plan(user(PUBLIC_SEEKING, Constants.PLATFORM, null), ROSTER_IMPORT,
                    TransitionContext.tenant(ActorRole.PM, A).withTarget(A));
            assertThat(p.after()).isEqualTo(user(EMPLOYED, Constants.PLATFORM, A));
        }
    }

    @Nested
    @DisplayName("报名（公域→私域转变点）")
    class Apply {
        @Test
        void 公域用户报名B公司_变临时私域_名额减一_开启24h() {
            TransitionPlan p = LifecycleStateMachine.plan(user(PUBLIC_SEEKING, Constants.PLATFORM, null), APPLY,
                    userApplying(B));
            assertThat(p.after()).isEqualTo(user(PENDING_INTERVIEW, Constants.PLATFORM, B));
            assertThat(DomainRules.domainTag(p.after())).isEqualTo(DomainTag.TEMP_PRIVATE);
            assertThat(DomainRules.matchScope(p.after())).isEqualTo(MatchScope.LOCKED);
            assertThat(p.quotaDelta()).isEqualTo(-1);
            assertThat(p.window()).isEqualTo(OPEN);
        }

        @Test
        void 私域用户只能报名本公司岗位() {
            assertRejected(() -> LifecycleStateMachine.plan(user(PRIVATE_PENDING, A, A), APPLY, userApplying(B)),
                    ErrorCode.APP_NOT_FROM_MATCH);
        }

        @ParameterizedTest
        @EnumSource(value = UserStatus.class, names = {"PENDING_INTERVIEW", "PENDING_CONFIRM"})
        void 报名锁定期不可再次报名(UserStatus locked) {
            assertRejected(() -> LifecycleStateMachine.plan(user(locked, A, A), APPLY, userApplying(A)),
                    ErrorCode.APP_DUPLICATE);
            assertThat(DomainRules.canStartMatching(user(locked, A, A))).isFalse();
        }

        @Test
        void 在岗用户不能走C端报名() {
            assertRejected(() -> LifecycleStateMachine.plan(user(EMPLOYED, A, A), APPLY, userApplying(A)),
                    ErrorCode.LC_ILLEGAL_TRANSITION);
        }

        @Test
        void 驻场不能代替用户报名() {
            assertRejected(() -> LifecycleStateMachine.plan(user(PRIVATE_PENDING, A, A), APPLY,
                    site(A).withTarget(A)), ErrorCode.LC_ACTOR_NOT_ALLOWED);
        }
    }

    @Nested
    @DisplayName("面试、确权、入职（节点五~七）")
    class Onboarding {
        @Test
        void 面试通过_待确权_重置24h() {
            TransitionPlan p = LifecycleStateMachine.plan(user(PENDING_INTERVIEW, A, A), INTERVIEW_PASS, site(A));
            assertThat(p.to()).isEqualTo(PENDING_CONFIRM);
            assertThat(p.window()).isEqualTo(OPEN);
        }

        @Test
        void 签约完成_入职在岗_关闭24h_名额不回补() {
            TransitionPlan p = LifecycleStateMachine.plan(user(PENDING_CONFIRM, Constants.PLATFORM, B),
                    CONTRACT_SIGNED, system());
            assertThat(p.after()).isEqualTo(user(EMPLOYED, Constants.PLATFORM, B));
            assertThat(DomainRules.matchScope(p.after())).isEqualTo(MatchScope.INTERNAL_TRANSFER_ONLY);
            assertThat(p.window()).isEqualTo(CLOSE);
            assertThat(p.quotaDelta()).isZero();
        }

        @Test
        void 只有系统回调能确认签约() {
            assertRejected(() -> LifecycleStateMachine.plan(user(PENDING_CONFIRM, A, A), CONTRACT_SIGNED, site(A)),
                    ErrorCode.LC_ACTOR_NOT_ALLOWED);
        }

        @Test
        void 别家公司驻场不能操作() {
            assertRejected(() -> LifecycleStateMachine.plan(user(PENDING_INTERVIEW, A, A), INTERVIEW_PASS, site(B)),
                    ErrorCode.SYS_FORBIDDEN);
        }
    }

    @Nested
    @DisplayName("释放路径（私域→公域）")
    class Release {
        @Test
        void 公域来源的用户面试未通过_回公域_名额回补() {
            TransitionPlan p = LifecycleStateMachine.plan(user(PENDING_INTERVIEW, Constants.PLATFORM, B), INTERVIEW_FAIL,
                    site(B).withPreApply(PUBLIC_SEEKING, null));
            assertThat(p.after()).isEqualTo(user(PUBLIC_SEEKING, Constants.PLATFORM, null));
            assertThat(p.releaseReason()).isEqualTo(ReleaseReason.INTERVIEW_FAILED);
            assertThat(p.quotaDelta()).isEqualTo(1);
            assertThat(p.isRelease()).isTrue();
        }

        @Test
        void D31_私域用户面试未通过_回到本公司私域待匹配_重开24h() {
            TransitionPlan p = LifecycleStateMachine.plan(user(PENDING_INTERVIEW, A, A), INTERVIEW_FAIL,
                    site(A).withPreApply(PRIVATE_PENDING, A));
            assertThat(p.after()).isEqualTo(user(PRIVATE_PENDING, A, A));
            assertThat(p.window()).isEqualTo(OPEN);
            assertThat(p.quotaDelta()).isEqualTo(1);
            assertThat(p.isRelease()).isFalse();
        }

        @Test
        void D31_后台取消报名_同样回到报名前状态() {
            TransitionPlan p = LifecycleStateMachine.plan(user(PENDING_CONFIRM, A, A), CANCEL_APPLICATION,
                    TransitionContext.tenant(ActorRole.PM, A).withPreApply(PRIVATE_PENDING, A));
            assertThat(p.to()).isEqualTo(PRIVATE_PENDING);
        }

        @Test
        void 用户不能自行取消报名() {
            assertRejected(() -> LifecycleStateMachine.plan(user(PENDING_INTERVIEW, A, A), CANCEL_APPLICATION,
                    TransitionContext.of(ActorRole.USER).withPreApply(PRIVATE_PENDING, A)),
                    ErrorCode.LC_ACTOR_NOT_ALLOWED);
        }

        @Test
        void 爽约_即使原本是私域也释放到公域_来源保留() {
            TransitionPlan p = LifecycleStateMachine.plan(user(PENDING_INTERVIEW, A, A), MARK_NO_SHOW, site(A));
            assertThat(p.after()).isEqualTo(user(PUBLIC_SEEKING, A, null));
            assertThat(p.quotaDelta()).isEqualTo(1);
        }

        @Test
        void 私域待匹配24h超时_被动释放_来源保留_名额不变() {
            TransitionPlan p = LifecycleStateMachine.plan(user(PRIVATE_PENDING, A, A), TIMEOUT_24H, system());
            assertThat(p.after()).isEqualTo(user(PUBLIC_SEEKING, A, null));
            assertThat(p.releaseReason()).isEqualTo(ReleaseReason.TIMEOUT_24H);
            assertThat(p.quotaDelta()).isZero();
        }

        @Test
        void 待面试24h超时_释放并回补名额() {
            TransitionPlan p = LifecycleStateMachine.plan(user(PENDING_INTERVIEW, A, A), TIMEOUT_24H, system());
            assertThat(p.quotaDelta()).isEqualTo(1);
        }

        @Test
        void 确权超时_释放并回补名额() {
            TransitionPlan p = LifecycleStateMachine.plan(user(PENDING_CONFIRM, Constants.PLATFORM, B), CONFIRM_TIMEOUT,
                    system());
            assertThat(p.after()).isEqualTo(user(PUBLIC_SEEKING, Constants.PLATFORM, null));
            assertThat(p.quotaDelta()).isEqualTo(1);
        }

        @Test
        void 经纪人主动释放_仅限未匹配状态() {
            TransitionContext broker = TransitionContext.tenant(ActorRole.BROKER, A);
            assertThat(LifecycleStateMachine.plan(user(PRIVATE_PENDING, A, A), RELEASE_MANUAL, broker).to())
                    .isEqualTo(PUBLIC_SEEKING);
            assertRejected(() -> LifecycleStateMachine.plan(user(EMPLOYED, A, A), RELEASE_MANUAL, broker),
                    ErrorCode.LC_ILLEGAL_TRANSITION);
        }

        @Test
        void 项目经理不能执行释放_按A19权限矩阵() {
            assertRejected(() -> LifecycleStateMachine.plan(user(PRIVATE_PENDING, A, A), RELEASE_MANUAL,
                    TransitionContext.tenant(ActorRole.PM, A)), ErrorCode.LC_ACTOR_NOT_ALLOWED);
        }

        @Test
        void 用户不能触发任何释放类迁移() {
            TransitionContext u = TransitionContext.of(ActorRole.USER).withPreApply(PUBLIC_SEEKING, null);
            for (LifecycleEvent e : EnumSet.of(INTERVIEW_FAIL, CANCEL_APPLICATION, MARK_NO_SHOW, TIMEOUT_24H,
                    CONFIRM_TIMEOUT, RELEASE_MANUAL, BROKER_SLA_TIMEOUT, RESIGN, COMPANY_CLOSED)) {
                assertThat(e.actors()).as(e.name()).doesNotContain(ActorRole.USER);
            }
            assertRejected(() -> LifecycleStateMachine.plan(user(PRIVATE_PENDING, A, A), RELEASE_MANUAL, u),
                    ErrorCode.LC_ACTOR_NOT_ALLOWED);
        }
    }

    @Nested
    @DisplayName("离职、调岗、公司注销")
    class Employment {
        @Test
        void 离职_变公域_来源永久保留() {
            TransitionPlan p = LifecycleStateMachine.plan(user(EMPLOYED, A, B), RESIGN,
                    TransitionContext.tenant(ActorRole.PM, B));
            assertThat(p.after()).isEqualTo(user(PUBLIC_SEEKING, A, null));
            assertThat(p.releaseReason()).isEqualTo(ReleaseReason.RESIGNED);
        }

        @Test
        void 在岗期间企业不能把用户变公域_只能走离职() {
            for (LifecycleEvent e : LifecycleEvent.values()) {
                if (e.from().contains(EMPLOYED) && e.boundEffect() == BoundEffect.CLEAR) {
                    assertThat(e).isIn(RESIGN, COMPANY_CLOSED);
                }
            }
        }

        @Test
        void 内部调岗_归属不变() {
            TransitionPlan p = LifecycleStateMachine.plan(user(EMPLOYED, A, A), INTERNAL_TRANSFER,
                    TransitionContext.tenant(ActorRole.PM, A));
            assertThat(p.after()).isEqualTo(user(EMPLOYED, A, A));
        }

        @Test
        void 公司注销_批量解绑_来源保留仅存证() {
            TransitionPlan p = LifecycleStateMachine.plan(user(EMPLOYED, A, A), COMPANY_CLOSED,
                    TransitionContext.of(ActorRole.OPS));
            assertThat(p.after()).isEqualTo(user(PUBLIC_SEEKING, A, null));
            assertThat(p.releaseReason()).isEqualTo(ReleaseReason.COMPANY_CLOSED);
        }
    }

    @Test
    @DisplayName("source_company_id 在任何非注册迁移中都不变")
    void sourceNeverChanges() {
        UserSnapshot u = user(PRIVATE_PENDING, A, A);
        TransitionPlan apply = LifecycleStateMachine.plan(u, APPLY, userApplying(A));
        TransitionPlan pass = LifecycleStateMachine.plan(apply.after(), INTERVIEW_PASS, site(A));
        TransitionPlan sign = LifecycleStateMachine.plan(pass.after(), CONTRACT_SIGNED, system());
        TransitionPlan resign = LifecycleStateMachine.plan(sign.after(), RESIGN, site(A));
        TransitionPlan applyB = LifecycleStateMachine.plan(resign.after(), APPLY, userApplying(B));
        for (TransitionPlan p : new TransitionPlan[]{apply, pass, sign, resign, applyB}) {
            assertThat(p.after().sourceCompanyId()).isEqualTo(A);
        }
        assertThat(applyB.after().boundCompanyId()).isEqualTo(B);
    }
}
