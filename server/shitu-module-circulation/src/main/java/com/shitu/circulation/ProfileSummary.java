package com.shitu.circulation;

import com.shitu.matching.domain.MatchProfile;

import java.util.ArrayList;
import java.util.List;

/** AI 分析报告的画像摘要（模板拼接；大模型润色可选，02-架构 §8）。 */
final class ProfileSummary {

    private ProfileSummary() {
    }

    /** 题库 v2 班次三态：「白班、长白班可以；夜班不接受；两班倒看情况（要包住）」。 */
    static List<String> shiftTolerance(MatchProfile p) {
        if (p.shiftTolerance() == null) {
            return List.of();
        }
        java.util.Map<MatchProfile.ShiftTolerance, List<String>> by = new java.util.EnumMap<>(MatchProfile.ShiftTolerance.class);
        for (com.shitu.common.enums.ShiftType s : com.shitu.common.enums.ShiftType.values()) {
            MatchProfile.ShiftTolerance t = p.shiftTolerance().get(s);
            if (t == null) {
                continue;
            }
            String note = p.shiftNotes() == null ? null : p.shiftNotes().get(s);
            by.computeIfAbsent(t, k -> new ArrayList<>()).add(note == null ? s.label() : s.label() + "（" + note + "）");
        }
        List<String> out = new ArrayList<>();
        if (by.containsKey(MatchProfile.ShiftTolerance.ACCEPT)) {
            out.add(String.join("、", by.get(MatchProfile.ShiftTolerance.ACCEPT)) + "可以");
        }
        if (by.containsKey(MatchProfile.ShiftTolerance.DEPENDS)) {
            out.add(String.join("、", by.get(MatchProfile.ShiftTolerance.DEPENDS)) + "看情况");
        }
        if (by.containsKey(MatchProfile.ShiftTolerance.REJECT)) {
            out.add(String.join("、", by.get(MatchProfile.ShiftTolerance.REJECT)) + "不接受");
        }
        return out;
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
        parts.addAll(shiftTolerance(p));
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
