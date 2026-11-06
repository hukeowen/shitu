package com.shitu.advance.domain;

import com.shitu.common.enums.UserStatus;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

/**
 * 薪酬预支规则（文档 6.5，D-26 / D-27）。参数可由平台配置。
 * <ul>
 *   <li>在岗日 = 入职以来的自然日，扣除驻场标记的请假 / 旷工（D-27）；</li>
 *   <li>累计在岗日每满 7 天 +1 次机会（滚动累计，第 7 天解锁第 1 次）；</li>
 *   <li>当月获得的机会当月有效，月末清零不结转；</li>
 *   <li>单次固定金额，每月最多使用 4 次。</li>
 * </ul>
 *
 * @param daysPerChance 每多少个在岗日获得一次机会，默认 7
 * @param amount        单次金额，默认 500
 * @param monthlyLimit  每月最多次数，默认 4
 */
public record AdvancePolicy(int daysPerChance, BigDecimal amount, int monthlyLimit) {

    public static final AdvancePolicy DEFAULT = new AdvancePolicy(7, new BigDecimal("500.00"), 4);

    public AdvancePolicy {
        if (daysPerChance <= 0 || monthlyLimit <= 0 || amount.signum() <= 0) {
            throw new IllegalArgumentException("invalid advance policy");
        }
    }

    /**
     * 本月获得的机会数 = 截至今天累计获得 − 截至上月末累计获得。
     *
     * @param dutyDaysAtPrevMonthEnd 截至上月最后一天的累计在岗日（新入职为 0）
     * @param dutyDaysNow            截至今天的累计在岗日
     */
    public int chancesGrantedThisMonth(int dutyDaysAtPrevMonthEnd, int dutyDaysNow) {
        if (dutyDaysNow < dutyDaysAtPrevMonthEnd || dutyDaysAtPrevMonthEnd < 0) {
            throw new IllegalArgumentException("duty days must be non-decreasing and >= 0");
        }
        return dutyDaysNow / daysPerChance - dutyDaysAtPrevMonthEnd / daysPerChance;
    }

    /** 本月剩余可用次数 = min(本月获得 − 本月已用, 月上限 − 本月已用)，不小于 0。 */
    public int remainingThisMonth(int grantedThisMonth, int usedThisMonth) {
        return Math.max(0, Math.min(grantedThisMonth - usedThisMonth, monthlyLimit - usedThisMonth));
    }

    /** 准入校验输入。 */
    public record Applicant(UserStatus status, String boundCompanyId, int dutyDaysNow,
                            int dutyDaysAtPrevMonthEnd, int usedThisMonth, boolean hasPendingRequest,
                            boolean blacklisted) {
    }

    /** 不满足的原因（为空即可申请），直接展示给用户。 */
    public List<String> check(Applicant a) {
        List<String> reasons = new ArrayList<>();
        if (a.status() != UserStatus.EMPLOYED) {
            reasons.add("仅「已入职在岗」状态可以申请预支");
        }
        if (a.boundCompanyId() == null) {
            reasons.add("需要绑定劳务公司");
        }
        if (a.dutyDaysNow() < daysPerChance) {
            reasons.add("入职满 " + daysPerChance + " 个在岗日后才能首次预支，当前 " + a.dutyDaysNow() + " 天");
        }
        if (a.usedThisMonth() >= monthlyLimit) {
            reasons.add("本月已预支 " + monthlyLimit + " 次，已达上限");
        }
        int granted = chancesGrantedThisMonth(a.dutyDaysAtPrevMonthEnd(), a.dutyDaysNow());
        if (reasons.isEmpty() && remainingThisMonth(granted, a.usedThisMonth()) <= 0) {
            int next = (a.dutyDaysNow() / daysPerChance + 1) * daysPerChance - a.dutyDaysNow();
            reasons.add("本月暂无可用机会，再在岗 " + next + " 天可获得下一次");
        }
        if (a.hasPendingRequest()) {
            reasons.add("你有一笔预支正在审批中");
        }
        if (a.blacklisted()) {
            reasons.add("账号受限，暂不能预支");
        }
        return reasons;
    }
}
