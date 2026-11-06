package com.shitu.matching.domain;

import java.math.BigDecimal;
import java.util.List;
import java.util.Objects;

/**
 * 匹配引擎参数（{@code engine_config.config} JSON，平台中台 P-13 可调，版本化）。
 * 字段名与种子数据 V1_0_7 中的 JSON 一致，由 Jackson 直接反序列化。
 */
public record EngineConfig(FactorWeights factorWeights,
                           List<DistanceTier> distanceScore,
                           List<DecayTier> decay,
                           LowConversion lowConversion,
                           String combineDecayAndConversion,
                           boolean resetDecayOnHire,
                           List<CreditTier> credit,
                           Penalty penalty,
                           Quota quota,
                           NewJobBoost newJobBoost,
                           int displayThreshold,
                           int resultCount,
                           int maxPerCompanyPublic) {

    public EngineConfig {
        Objects.requireNonNull(factorWeights, "factorWeights");
        distanceScore = List.copyOf(distanceScore);
        decay = List.copyOf(decay);
        credit = List.copyOf(credit);
        if (resultCount <= 0) {
            throw new IllegalArgumentException("resultCount must be positive");
        }
    }

    /** 软打分权重：工种 30 / 薪资 25 / 地域距离 20 / 班次 10 / 住宿 10 / 经验 5。 */
    public record FactorWeights(int jobType, int salary, int distance, int shift, int dorm, int experience) {
        public int total() {
            return jobType + salary + distance + shift + dorm + experience;
        }
    }

    /** maxKm 为 null 表示「以上」。 */
    public record DistanceTier(Integer maxKm, int score) {
    }

    /** 挂岗天数衰减：maxDays 为 null 表示「以上」。 */
    public record DecayTier(Integer maxDays, BigDecimal factor) {
    }

    /** 挂岗满 minPostedDays 天且转化率 ≤ maxConversionRate → 乘 factor。 */
    public record LowConversion(int minPostedDays, BigDecimal maxConversionRate, BigDecimal factor) {
    }

    /** 诚信分 ≥ minScore → factor（从高到低匹配第一个）。 */
    public record CreditTier(int minScore, BigDecimal factor) {
    }

    public record Penalty(BigDecimal level2, BigDecimal level3) {
    }

    /** 剩余名额 ≤ lowRemaining → 乘 factor（名额快满的岗位降低曝光，减少「满了还在招」投诉）。 */
    public record Quota(int lowRemaining, BigDecimal factor) {
    }

    /** 新岗位（上架 ≤ maxDays 天）加权，帮助冷启动。 */
    public record NewJobBoost(int maxDays, BigDecimal factor) {
    }
}
