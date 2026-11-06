package com.shitu.job;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/** 岗位审核记录：SUBMIT / APPROVE / REJECT / FORCE_OFFLINE。 */
@Data
@TableName("job_audit")
public class JobAudit {

    @TableId(type = IdType.AUTO)
    private Long id;
    private String companyId;
    private String jobId;
    private String action;
    private String remark;
    private String operatorId;
    private LocalDateTime createdAt;
}
