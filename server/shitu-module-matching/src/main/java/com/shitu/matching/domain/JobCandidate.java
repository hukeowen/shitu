package com.shitu.matching.domain;

import com.shitu.common.enums.JobType;
import com.shitu.common.enums.ShiftType;

import java.math.BigDecimal;

/**
 * 参与匹配的岗位（已经过「范围」筛选：私域 = 本公司，公域 = 全平台）。
 *
 * @param recruiting      岗位状态是否为招聘中
 * @param companyBlocked  公司被封禁 / 取消收费服务权限（D-24）→ 不参与匹配
 * @param jobWeight       岗位权重（每日任务预先算好，{@link JobWeightCalculator}）
 */
public record JobCandidate(String jobId, String companyId, String title, String city, BigDecimal lng, BigDecimal lat,
                           JobType jobType, boolean factoryJob, BigDecimal salaryMin, BigDecimal salaryMax,
                           ShiftType shift, boolean dormProvided, Integer dormRoomSize, Boolean dormAircon,
                           boolean mealProvided, int minWorkYears, int ageMin, int ageMax, int quotaRemaining,
                           boolean recruiting, boolean companyBlocked, BigDecimal jobWeight) {

    public boolean hasLocation() {
        return lng != null && lat != null;
    }
}
