package com.shitu.job.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.shitu.job.Job;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface JobMapper extends BaseMapper<Job> {

    /**
     * 调整总名额：剩余名额随之增减，已占用（报名中 / 已入职）不变；新总数小于已占用时不更新（返回 0）。
     * 租户拦截器会追加 company_id 条件。
     */
    @Update("UPDATE job SET quota_remaining = quota_remaining + (#{total} - quota_total), quota_total = #{total}, "
            + "version = version + 1, last_info_update_at = #{now} "
            + "WHERE job_id = #{jobId} AND quota_total - quota_remaining <= #{total}")
    int adjustQuota(@Param("jobId") String jobId, @Param("total") int total, @Param("now") java.time.LocalDateTime now);
}
