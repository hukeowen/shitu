package com.shitu.matching.domain;

import java.util.ArrayList;
import java.util.List;

/**
 * 推荐理由（模板拼接；大模型润色是可选项，02-架构 §8）。
 * 只挑得分高的因子说，按用户最关心的顺序：工种 → 薪资 → 距离 → 食宿 → 班次，最多 4 条，用 · 连接。
 */
final class ReasonText {

    private static final int MAX_PARTS = 4;

    private ReasonText() {
    }

    static String of(MatchProfile p, JobCandidate j, MatchScorer.FactorScores f, Double km) {
        List<String> parts = new ArrayList<>();
        if (f.jobType() == 100) {
            parts.add("工种对口");
        }
        if (f.salary() == 100) {
            parts.add("月薪 " + j.salaryMin().stripTrailingZeros().toPlainString() + "–"
                    + j.salaryMax().stripTrailingZeros().toPlainString() + " 元");
        }
        if (km != null && f.distance() >= 80) {
            parts.add("距你约 " + Math.max(1, Math.round(km)) + " 公里");
        }
        if (j.dormProvided() && f.dorm() >= 60) {
            StringBuilder d = new StringBuilder(j.mealProvided() ? "包吃住" : "包住");
            if (j.dormRoomSize() != null) {
                d.append(" ").append(j.dormRoomSize()).append(" 人间");
            }
            if (Boolean.TRUE.equals(j.dormAircon())) {
                d.append("有空调");
            }
            parts.add(d.toString());
        } else if (j.mealProvided()) {
            parts.add("包吃");
        }
        if (f.shift() == 100 && p.shift() != null) {
            parts.add(switch (j.shift()) {
                case DAY -> "白班";
                case NIGHT -> "夜班";
                case TWO_SHIFT -> "两班倒";
                case LONG_DAY -> "长白班";
            });
        }
        if (parts.isEmpty()) {
            parts.add("综合条件较匹配");
        }
        return String.join(" · ", parts.subList(0, Math.min(MAX_PARTS, parts.size())));
    }
}
