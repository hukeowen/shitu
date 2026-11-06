package com.shitu.circulation;

import com.shitu.matching.domain.MatchProfile;

import java.util.ArrayList;
import java.util.List;

/** AI 分析报告的画像摘要（模板拼接；大模型润色可选，02-架构 §8）。 */
final class ProfileSummary {

    private ProfileSummary() {
    }

    static String of(MatchProfile p, int matchCount, String trigger) {
        List<String> parts = new ArrayList<>();
        parts.add(switch (p.factory()) {
            case YES -> "接受进厂";
            case MAYBE -> "可以考虑进厂";
            case NO -> "不接受进厂";
        });
        parts.add(p.lockedCity() == null ? "地域不限" : "只看" + p.lockedCity());
        parts.add(p.jobType() == null ? "工种不限" : "期望" + p.jobType().label());
        if (p.salaryMin() != null) {
            parts.add("期望月薪 " + p.salaryMin().stripTrailingZeros().toPlainString() + "–"
                    + p.salaryMax().stripTrailingZeros().toPlainString() + " 元");
        }
        if (p.shift() != null) {
            parts.add("可接受" + p.shift().label());
        }
        if (p.dorm() != null) {
            parts.add(switch (p.dorm()) {
                case REQUIRED -> "必须包住";
                case SMALL_ROOM -> "要求 4 人间以内";
                case AIRCON -> "宿舍要有空调";
                case NONE -> "不需要住宿";
            });
        }
        parts.add(switch (p.workYears()) {
            case 0 -> "无相关经验";
            case 1 -> "经验 1 年以内";
            case 2 -> "经验 1–3 年";
            default -> "经验 3 年以上";
        });
        String why = switch (trigger == null ? "" : trigger) {
            case "LOW_MATCH" -> "匹配度不足 80% 自动转入";
            case "REMATCH_LIMIT" -> "本周期已匹配 " + matchCount + " 次未报名";
            case "SITE_TRANSFER" -> "驻场流转";
            default -> "";
        };
        return String.join("，", parts) + (why.isEmpty() ? "" : "。入池原因：" + why);
    }
}
