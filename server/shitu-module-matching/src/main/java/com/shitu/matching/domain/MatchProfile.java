package com.shitu.matching.domain;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.shitu.common.enums.JobType;
import com.shitu.common.enums.ShiftType;

import java.math.BigDecimal;
import java.util.Map;

/**
 * 求职画像（由 7 道题的答案生成，C-303）。字段兼容题库 v1（问期望工资、单选班次）与 v2（D-62：不问工资、班次三态）。
 *
 * @param factory        Q1 进厂意愿
 * @param lockedCity     Q2 只看某城市时的城市名；null = 不限
 * @param jobType        Q3 期望工种；null = 都可以
 * @param salaryMin      v1 Q4 期望月综合收入下限；v2 不问，为 null（按到手工资排位打分）
 * @param salaryMax      v1 Q4 期望月综合收入上限
 * @param shift          v1 Q5 可接受班次（单选）；v2 为 null
 * @param dorm           Q6 住宿要求（v2 的「需要 / 不需要」= REQUIRED / NONE）
 * @param workYears      Q7 相关经验档位：0 没做过 / 1 一年内 / 2 一到三年 / 3 三年以上
 * @param age            实名年龄优先；未实名时用 v2 Q4 自报年龄；都没有为 null（不做年龄过滤，报名时再拦截）
 * @param lng            用户定位（可空，未授权定位时按城市粗略打分）
 * @param lat            用户定位
 * @param shiftTolerance v2 Q5 每种班次 接受 / 不接受 / 看情况；v1 为 null
 * @param shiftNotes     v2 Q5 选「看情况」时补充的「什么情况下可以」（只给顾问参考，不打分）
 */
public record MatchProfile(FactoryWillingness factory, String lockedCity, JobType jobType,
                           BigDecimal salaryMin, BigDecimal salaryMax, ShiftType shift, DormRequirement dorm,
                           int workYears, Integer age, BigDecimal lng, BigDecimal lat,
                           Map<ShiftType, ShiftTolerance> shiftTolerance, Map<ShiftType, String> shiftNotes) {

    public enum FactoryWillingness { YES, MAYBE, NO }

    public enum DormRequirement { REQUIRED, SMALL_ROOM, AIRCON, NONE }

    public enum ShiftTolerance { ACCEPT, REJECT, DEPENDS }

    @JsonCreator
    public MatchProfile {
        shiftTolerance = shiftTolerance == null || shiftTolerance.isEmpty() ? null : Map.copyOf(shiftTolerance);
        shiftNotes = shiftNotes == null || shiftNotes.isEmpty() ? null : Map.copyOf(shiftNotes);
    }

    /** 题库 v1 的画像（没有班次三态）。 */
    public MatchProfile(FactoryWillingness factory, String lockedCity, JobType jobType, BigDecimal salaryMin,
                        BigDecimal salaryMax, ShiftType shift, DormRequirement dorm, int workYears, Integer age,
                        BigDecimal lng, BigDecimal lat) {
        this(factory, lockedCity, jobType, salaryMin, salaryMax, shift, dorm, workYears, age, lng, lat, null, null);
    }

    public boolean hasLocation() {
        return lng != null && lat != null;
    }

    /** 没问期望工资（v2）：工资因子按候选岗位到手工资高低排位。 */
    public boolean salaryByRank() {
        return salaryMin == null || salaryMin.signum() <= 0;
    }

    /** 放宽进厂意愿与地域锁定（经纪人报告找备选用，T-202）。 */
    public MatchProfile loosened() {
        return new MatchProfile(FactoryWillingness.YES, null, jobType, salaryMin, salaryMax, shift, dorm, workYears, age,
                lng, lat, shiftTolerance, shiftNotes);
    }
}
