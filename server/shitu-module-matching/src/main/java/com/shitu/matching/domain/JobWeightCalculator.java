package com.shitu.matching.domain;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * 岗位权重（每日任务预先计算，写入 job.match_weight，仅平台可见 R-14）：
 * <pre>
 * 基础 = min(挂岗天数衰减, 低转化系数)            —— D-29：两者取较小值，不相乘
 * 权重 = 基础 × 诚信系数 × 处罚系数 × 名额系数 × 新岗位加成
 * </pre>
 * 挂岗天数从「上架 / 恢复招聘」起算；开启 resetDecayOnHire 时，最近一次新入职也会重置衰减（D-29）。
 */
public final class JobWeightCalculator {

    /**
     * @param postedDays      距上架（或最近一次新入职）的天数
     * @param conversionRate  挂岗以来 入职数 / 报名数（无报名时传 null，不触发低转化）
     * @param creditScore     公司诚信分
     * @param penaltyLevel    0 无 / 1 警告 / 2 限流 / 3 封禁
     * @param quotaRemaining  剩余名额
     */
    public record Input(long postedDays, BigDecimal conversionRate, int creditScore, int penaltyLevel, int quotaRemaining) {
    }

    private JobWeightCalculator() {
    }

    public static BigDecimal weight(Input in, EngineConfig cfg) {
        BigDecimal decay = decay(in.postedDays(), cfg);
        BigDecimal conv = BigDecimal.ONE;
        EngineConfig.LowConversion lc = cfg.lowConversion();
        if (lc != null && in.conversionRate() != null && in.postedDays() >= lc.minPostedDays()
                && in.conversionRate().compareTo(lc.maxConversionRate()) <= 0) {
            conv = lc.factor();
        }
        BigDecimal base = "MULTIPLY".equalsIgnoreCase(cfg.combineDecayAndConversion()) ? decay.multiply(conv) : decay.min(conv);
        BigDecimal w = base.multiply(credit(in.creditScore(), cfg)).multiply(penalty(in.penaltyLevel(), cfg));
        if (cfg.quota() != null && in.quotaRemaining() <= cfg.quota().lowRemaining()) {
            w = w.multiply(cfg.quota().factor());
        }
        if (cfg.newJobBoost() != null && in.postedDays() <= cfg.newJobBoost().maxDays()) {
            w = w.multiply(cfg.newJobBoost().factor());
        }
        // job.match_weight 为 DECIMAL(4,3)
        return w.setScale(3, RoundingMode.HALF_UP).min(new BigDecimal("9.999"));
    }

    static BigDecimal decay(long days, EngineConfig cfg) {
        for (EngineConfig.DecayTier t : cfg.decay()) {
            if (t.maxDays() == null || days <= t.maxDays()) {
                return t.factor();
            }
        }
        return BigDecimal.ZERO;
    }

    static BigDecimal credit(int score, EngineConfig cfg) {
        return cfg.credit().stream()
                .filter(t -> score >= t.minScore())
                .max(java.util.Comparator.comparingInt(EngineConfig.CreditTier::minScore))
                .map(EngineConfig.CreditTier::factor)
                .orElse(BigDecimal.ZERO);
    }

    static BigDecimal penalty(int level, EngineConfig cfg) {
        if (cfg.penalty() == null) {
            return BigDecimal.ONE;
        }
        return switch (level) {
            case 2 -> cfg.penalty().level2();
            case 3 -> cfg.penalty().level3();
            default -> BigDecimal.ONE;
        };
    }
}
