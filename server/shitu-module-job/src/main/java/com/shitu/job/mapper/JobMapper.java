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

    /**
     * 报名占用 1 个名额（D-12）：条件更新保证并发下不超卖 —— 50 人抢最后 1 个名额只有 1 人成功。
     * 只有招聘中的岗位可以报名。返回 0 表示名额已满或岗位已不在招聘。
     */
    @Update("UPDATE job SET quota_remaining = quota_remaining - 1 "
            + "WHERE job_id = #{jobId} AND job_status = 'RECRUITING' AND quota_remaining > 0")
    int takeQuota(@Param("jobId") String jobId);

    /** 报名在入职前结束（取消 / 爽约 / 面试未过 / 超时）回补名额，不超过总名额。 */
    @Update("UPDATE job SET quota_remaining = quota_remaining + 1 WHERE job_id = #{jobId} AND quota_remaining < quota_total")
    int returnQuota(@Param("jobId") String jobId);
}
