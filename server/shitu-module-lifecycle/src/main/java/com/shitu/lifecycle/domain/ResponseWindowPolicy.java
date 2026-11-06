package com.shitu.lifecycle.domain;

import java.time.Duration;
import java.time.LocalTime;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * 24h 响应窗口（文档第四节，D-06 / D-14）。全部参数可由平台配置。
 *
 * @param window        窗口时长，默认 24h
 * @param dayStart      白天开始，默认 08:00
 * @param dayEnd        白天结束，默认 22:00
 * @param dayInterval   白天提醒间隔，默认 6h
 * @param nightInterval 夜间提醒间隔，默认 12h
 */
public record ResponseWindowPolicy(Duration window, LocalTime dayStart, LocalTime dayEnd,
                                   Duration dayInterval, Duration nightInterval) {

    public static final ResponseWindowPolicy DEFAULT = new ResponseWindowPolicy(
            Duration.ofHours(24), LocalTime.of(8, 0), LocalTime.of(22, 0),
            Duration.ofHours(6), Duration.ofHours(12));

    public ResponseWindowPolicy {
        Objects.requireNonNull(window);
        if (!dayStart.isBefore(dayEnd)) {
            throw new IllegalArgumentException("dayStart must be before dayEnd");
        }
        if (dayInterval.isZero() || dayInterval.isNegative() || nightInterval.isZero() || nightInterval.isNegative()) {
            throw new IllegalArgumentException("intervals must be positive");
        }
    }

    public ZonedDateTime deadline(ZonedDateTime stageEnteredAt) {
        return stageEnteredAt.plus(window);
    }

    public boolean isDaytime(ZonedDateTime t) {
        LocalTime lt = t.toLocalTime();
        return !lt.isBefore(dayStart) && lt.isBefore(dayEnd);
    }

    /**
     * 窗口内向驻场 / 项目经理 / 老板推送跟进提醒的时间点（不含开始时刻，严格早于截止时刻）。
     * 下一次提醒的间隔由「上一次提醒所处的时段」决定：白天 6h、夜间 12h。
     */
    public List<ZonedDateTime> followUpTimes(ZonedDateTime stageEnteredAt) {
        ZonedDateTime deadline = deadline(stageEnteredAt);
        List<ZonedDateTime> result = new ArrayList<>();
        ZonedDateTime t = stageEnteredAt;
        while (true) {
            t = t.plus(isDaytime(t) ? dayInterval : nightInterval);
            if (!t.isBefore(deadline)) {
                return result;
            }
            result.add(t);
        }
    }
}
