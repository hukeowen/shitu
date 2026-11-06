package com.shitu.matching.domain;

import com.shitu.common.enums.JobType;
import com.shitu.common.enums.ShiftType;

import java.math.BigDecimal;

/**
 * 求职画像（由 7 道题的答案生成，C-303）。
 *
 * @param factory       Q1 进厂意愿
 * @param lockedCity    Q2 只看某城市时的城市名；null = 不限
 * @param jobType       Q3 期望工种；null = 都可以
 * @param salaryMin     Q4 期望月综合收入下限
 * @param salaryMax     Q4 期望月综合收入上限
 * @param shift         Q5 可接受班次
 * @param dorm          Q6 住宿要求
 * @param workYears     Q7 相关经验档位：0 没做过 / 1 一年内 / 2 一到三年 / 3 三年以上
 * @param age           实名后才知道（匹配时可为空，为空不做年龄过滤，报名时再拦截）
 * @param lng           用户定位（可空，未授权定位时按城市粗略打分）
 * @param lat           用户定位
 */
public record MatchProfile(FactoryWillingness factory, String lockedCity, JobType jobType,
                           BigDecimal salaryMin, BigDecimal salaryMax, ShiftType shift, DormRequirement dorm,
                           int workYears, Integer age, BigDecimal lng, BigDecimal lat) {

    public enum FactoryWillingness { YES, MAYBE, NO }

    public enum DormRequirement { REQUIRED, SMALL_ROOM, AIRCON, NONE }

    public boolean hasLocation() {
        return lng != null && lat != null;
    }
}
