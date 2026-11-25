package com.shitu.matching.domain;

import com.shitu.common.enums.ShiftType;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 匹配打分器（02-架构 §8）：纯函数、无状态，可以离线用历史答题回放调参。
 * <pre>
 * 1. 硬过滤：招聘中、名额 &gt; 0、公司未封禁、权重 &gt; 0、进厂意愿、地域锁定、年龄（已实名时）
 * 2. 软打分：六个因子各 0–100 分，按权重加权平均 → 匹配度 0–100
 * 3. 排序分 = 匹配度 × 岗位权重；同分按匹配度、剩余名额、岗位编号排序，保证结果确定可复现
 * 4. 取前 N 个（公域同一公司最多 maxPerCompanyPublic 个）；匹配度 ≥ 阈值的才展示
 * </pre>
 * 题库 v2（D-62）：不问期望工资 → 工资因子 = 该岗位到手工资（月薪区间中值）在本次候选岗位里的排位；
 * 班次按每种班次的「接受 / 看情况 / 不接受」打分，岗位班次被明确「不接受」时匹配度再打 {@link #REJECTED_SHIFT_FACTOR} 折。
 */
public final class MatchScorer {

    /** 被硬过滤掉的原因（漏斗统计用）。 */
    public enum FilterReason { NOT_RECRUITING, QUOTA_FULL, COMPANY_BLOCKED, ZERO_WEIGHT, FACTORY, REGION, AGE }

    public record FactorScores(int jobType, int salary, int distance, int shift, int dorm, int experience) {
    }

    public record Scored(JobCandidate job, BigDecimal matchScore, FactorScores factors, BigDecimal sortScore,
                         boolean displayed, String reason) {
    }

    /**
     * @param results     排序后的前 N 个（含未达展示阈值的，用于快照与经纪人参考）
     * @param filtered    各硬过滤原因淘汰的岗位数
     */
    public record Outcome(List<Scored> results, int candidates, Map<FilterReason, Integer> filtered, boolean salaryByRank) {
        public Outcome(List<Scored> results, int candidates, Map<FilterReason, Integer> filtered) {
            this(results, candidates, filtered, false);
        }

        public boolean anyDisplayed() {
            return results.stream().anyMatch(Scored::displayed);
        }

        public List<Scored> displayed() {
            return results.stream().filter(Scored::displayed).toList();
        }
    }

    private static final Map<ShiftType, Map<ShiftType, Integer>> SHIFT = new EnumMap<>(ShiftType.class);

    static {
        // 行 = 用户可接受班次，列 = 岗位班次
        SHIFT.put(ShiftType.DAY, Map.of(ShiftType.DAY, 100, ShiftType.LONG_DAY, 70, ShiftType.TWO_SHIFT, 30, ShiftType.NIGHT, 0));
        SHIFT.put(ShiftType.TWO_SHIFT, Map.of(ShiftType.TWO_SHIFT, 100, ShiftType.DAY, 100, ShiftType.LONG_DAY, 80, ShiftType.NIGHT, 40));
        SHIFT.put(ShiftType.NIGHT, Map.of(ShiftType.NIGHT, 100, ShiftType.TWO_SHIFT, 100, ShiftType.DAY, 100, ShiftType.LONG_DAY, 100));
        SHIFT.put(ShiftType.LONG_DAY, Map.of(ShiftType.LONG_DAY, 100, ShiftType.DAY, 80, ShiftType.TWO_SHIFT, 40, ShiftType.NIGHT, 20));
    }

    /**
     * 岗位班次被用户明确选了「不接受」：班次因子 0 分之外，匹配度再乘 0.7。
     * 不做硬过滤的原因：用户说「不接受」的强度不一（很多人看到工资高会改主意），硬过滤会让经纪人报告（T-202，不受展示阈值限制）
     * 也看不到这些岗位、没法去沟通；但乘 0.7 后匹配度最高 70，低于默认展示阈值 80，求职者自己的结果页不会出现他说了不接受的班次。
     */
    static final BigDecimal REJECTED_SHIFT_FACTOR = new BigDecimal("0.7");
    /** 工资排位分：最低的岗位 70 分、最高的 100 分（排位只用来拉开顺序，不应让低薪岗位直接掉出展示阈值）。 */
    static final int RANK_FLOOR = 70;
    /** 排位在前 25% 且候选岗位工资有高有低时，推荐理由写「工资在同类岗位里偏高」。 */
    static final double HIGH_PAY_PERCENTILE = 0.75;

    /** 工资排位结果：score 为工资因子分，high 为「偏高」。 */
    record SalaryRank(int score, boolean high) {
    }

    private MatchScorer() {
    }

    public static Outcome match(MatchProfile p, List<JobCandidate> jobs, EngineConfig cfg, boolean publicScope) {
        Map<FilterReason, Integer> filtered = new LinkedHashMap<>();
        List<JobCandidate> passed = new ArrayList<>();
        for (JobCandidate j : jobs) {
            Optional<FilterReason> r = hardFilter(p, j);
            if (r.isPresent()) {
                filtered.merge(r.get(), 1, Integer::sum);
                continue;
            }
            passed.add(j);
        }
        boolean byRank = p.salaryByRank();
        Map<String, SalaryRank> ranks = byRank ? salaryRanks(passed) : Map.of();
        List<Scored> scored = new ArrayList<>();
        for (JobCandidate j : passed) {
            scored.add(score(p, j, cfg, ranks.get(j.jobId())));
        }
        scored.sort(Comparator.comparing(Scored::sortScore).reversed()
                .thenComparing(Comparator.comparing(Scored::matchScore).reversed())
                .thenComparing(s -> -s.job().quotaRemaining())
                .thenComparing(s -> s.job().jobId()));
        List<Scored> top = new ArrayList<>();
        Map<String, Integer> perCompany = new HashMap<>();
        for (Scored s : scored) {
            if (top.size() >= cfg.resultCount()) {
                break;
            }
            int n = perCompany.getOrDefault(s.job().companyId(), 0);
            if (publicScope && n >= cfg.maxPerCompanyPublic()) {
                continue;
            }
            perCompany.put(s.job().companyId(), n + 1);
            top.add(s);
        }
        return new Outcome(List.copyOf(top), jobs.size(), Map.copyOf(filtered), byRank);
    }

    static Optional<FilterReason> hardFilter(MatchProfile p, JobCandidate j) {
        if (!j.recruiting()) {
            return Optional.of(FilterReason.NOT_RECRUITING);
        }
        if (j.quotaRemaining() <= 0) {
            return Optional.of(FilterReason.QUOTA_FULL);
        }
        if (j.companyBlocked()) {
            return Optional.of(FilterReason.COMPANY_BLOCKED);
        }
        if (j.jobWeight() == null || j.jobWeight().signum() <= 0) {
            return Optional.of(FilterReason.ZERO_WEIGHT);
        }
        if (p.factory() == MatchProfile.FactoryWillingness.NO && j.factoryJob()) {
            return Optional.of(FilterReason.FACTORY);
        }
        if (p.lockedCity() != null && !sameCity(p.lockedCity(), j.city())) {
            return Optional.of(FilterReason.REGION);
        }
        if (p.age() != null && (p.age() < j.ageMin() || p.age() > j.ageMax())) {
            return Optional.of(FilterReason.AGE);
        }
        return Optional.empty();
    }

    /**
     * 工资排位：按月薪区间中值去重排序，最低 {@link #RANK_FLOOR} 分、最高 100 分、中间线性；只有一种工资时都给 100。
     * 候选 = 本次通过硬过滤的岗位（私域 = 本公司，公域 = 全平台），所以同一岗位在不同人、不同范围下排位可能不同，
     * 每次匹配的因子分都落在 match_result.factor_scores 里，回放以快照为准。
     */
    static Map<String, SalaryRank> salaryRanks(List<JobCandidate> passed) {
        List<BigDecimal> distinct = passed.stream().map(MatchScorer::payMid).distinct().sorted().toList();
        Map<String, SalaryRank> out = new HashMap<>();
        for (JobCandidate j : passed) {
            if (distinct.size() <= 1) {
                out.put(j.jobId(), new SalaryRank(100, false));
                continue;
            }
            double pct = (double) distinct.indexOf(payMid(j)) / (distinct.size() - 1);
            int score = (int) Math.round(RANK_FLOOR + (100 - RANK_FLOOR) * pct);
            out.put(j.jobId(), new SalaryRank(score, passed.size() >= 3 && pct >= HIGH_PAY_PERCENTILE));
        }
        return out;
    }

    private static BigDecimal payMid(JobCandidate j) {
        BigDecimal min = j.salaryMin() == null ? BigDecimal.ZERO : j.salaryMin();
        BigDecimal max = j.salaryMax() == null ? min : j.salaryMax();
        return min.add(max).divide(BigDecimal.valueOf(2), 0, RoundingMode.HALF_UP);
    }

    static Scored score(MatchProfile p, JobCandidate j, EngineConfig cfg) {
        return score(p, j, cfg, null);
    }

    /** @param rank 工资排位（没问期望工资时）；null = 按期望工资比较，或只有这一个岗位 */
    static Scored score(MatchProfile p, JobCandidate j, EngineConfig cfg, SalaryRank rank) {
        EngineConfig.FactorWeights w = cfg.factorWeights();
        Double km = p.hasLocation() && j.hasLocation()
                ? Geo.km(p.lat().doubleValue(), p.lng().doubleValue(), j.lat().doubleValue(), j.lng().doubleValue()) : null;
        FactorScores f = new FactorScores(
                jobTypeScore(p, j),
                p.salaryByRank() ? (rank == null ? 100 : rank.score()) : salaryScore(p, j),
                distanceScore(p, j, km, cfg),
                shiftScore(p, j),
                dormScore(p, j),
                j.minWorkYears() <= p.workYears() ? 100 : Math.max(0, 100 - 50 * (j.minWorkYears() - p.workYears())));
        int weighted = w.jobType() * f.jobType() + w.salary() * f.salary() + w.distance() * f.distance()
                + w.shift() * f.shift() + w.dorm() * f.dorm() + w.experience() * f.experience();
        BigDecimal match = BigDecimal.valueOf(weighted).divide(BigDecimal.valueOf(w.total()), 2, RoundingMode.HALF_UP);
        if (rejectsShift(p, j)) {
            match = match.multiply(REJECTED_SHIFT_FACTOR).setScale(2, RoundingMode.HALF_UP);
        }
        BigDecimal sort = match.multiply(j.jobWeight()).setScale(3, RoundingMode.HALF_UP);
        boolean displayed = match.compareTo(BigDecimal.valueOf(cfg.displayThreshold())) >= 0;
        return new Scored(j, match, f, sort, displayed, ReasonText.of(p, j, f, km, rank != null && rank.high()));
    }

    /** 班次：v2 三态（接受 100 / 看情况 60 / 不接受 0，没列出的班次 60）；v1 单选按兼容表。 */
    static int shiftScore(MatchProfile p, JobCandidate j) {
        if (p.shiftTolerance() != null) {
            MatchProfile.ShiftTolerance t = p.shiftTolerance().get(j.shift());
            if (t == null) {
                return 60;
            }
            return switch (t) {
                case ACCEPT -> 100;
                case DEPENDS -> 60;
                case REJECT -> 0;
            };
        }
        return SHIFT.getOrDefault(p.shift() == null ? ShiftType.NIGHT : p.shift(), Map.of()).getOrDefault(j.shift(), 0);
    }

    static boolean rejectsShift(MatchProfile p, JobCandidate j) {
        return p.shiftTolerance() != null && p.shiftTolerance().get(j.shift()) == MatchProfile.ShiftTolerance.REJECT;
    }

    static int jobTypeScore(MatchProfile p, JobCandidate j) {
        if (p.jobType() == null) {
            return 80;
        }
        return p.jobType() == j.jobType() ? 100 : 0;
    }

    /** 岗位最高收入达到期望下限即满分；差距越大分越低，差 25% 及以上为 0。 */
    static int salaryScore(MatchProfile p, JobCandidate j) {
        if (p.salaryMin() == null || p.salaryMin().signum() <= 0) {
            return 100;
        }
        if (j.salaryMax().compareTo(p.salaryMin()) >= 0) {
            return 100;
        }
        BigDecimal gapRatio = p.salaryMin().subtract(j.salaryMax()).divide(p.salaryMin(), 4, RoundingMode.HALF_UP);
        return Math.max(0, 100 - gapRatio.multiply(BigDecimal.valueOf(400)).intValue());
    }

    static int distanceScore(MatchProfile p, JobCandidate j, Double km, EngineConfig cfg) {
        if (km != null) {
            for (EngineConfig.DistanceTier t : cfg.distanceScore()) {
                if (t.maxKm() == null || km <= t.maxKm()) {
                    return t.score();
                }
            }
            return 0;
        }
        if (p.lockedCity() != null) {
            // 已按城市硬过滤，同城
            return 100;
        }
        // 没有定位、也没锁定城市：给中性分，不让距离因子左右排序
        return 60;
    }

    static int dormScore(MatchProfile p, JobCandidate j) {
        if (p.dorm() == null || p.dorm() == MatchProfile.DormRequirement.NONE) {
            return 100;
        }
        if (!j.dormProvided()) {
            return 0;
        }
        return switch (p.dorm()) {
            case REQUIRED -> 100;
            case SMALL_ROOM -> j.dormRoomSize() != null && j.dormRoomSize() <= 4 ? 100 : 60;
            case AIRCON -> Boolean.TRUE.equals(j.dormAircon()) ? 100 : 60;
            case NONE -> 100;
        };
    }

    static boolean sameCity(String a, String b) {
        if (a == null || b == null) {
            return false;
        }
        return strip(a).equals(strip(b));
    }

    private static String strip(String c) {
        String s = c.trim();
        return s.endsWith("市") ? s.substring(0, s.length() - 1) : s;
    }

    /** 球面距离（公里）。 */
    static final class Geo {
        private Geo() {
        }

        static double km(double lat1, double lng1, double lat2, double lng2) {
            double r = 6371.0;
            double dLat = Math.toRadians(lat2 - lat1);
            double dLng = Math.toRadians(lng2 - lng1);
            double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                    + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
            return 2 * r * Math.asin(Math.sqrt(a));
        }
    }
}
