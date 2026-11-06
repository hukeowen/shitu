package com.shitu.lifecycle.seeker;

import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.Version;
import com.shitu.common.enums.ApplicationStatus;
import com.shitu.common.enums.UserStatus;
import lombok.Data;

import java.time.LocalDateTime;

/** 报名 / 报备（同一用户同时只有一条有效报名：生成列 active_user_id 唯一）。 */
@Data
@TableName("application")
public class Application {

    @TableId(type = IdType.INPUT)
    private String applicationId;
    private String userId;
    private String companyId;
    private String projectId;
    private String jobId;
    private String matchSessionId;
    private Long brokerCaseId;
    private UserStatus preApplyStatus;
    private String preApplyBound;
    private ApplicationStatus status;
    private LocalDateTime acknowledgedAt;
    private String acknowledgedBy;
    private LocalDateTime interviewAt;
    private String interviewAddress;
    private LocalDateTime arrivedAt;
    private String interviewResult;
    private LocalDateTime endedAt;
    private String endReason;
    private String endOperatorId;
    private String endRemark;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    @Version
    private Integer version;
    @TableField(insertStrategy = FieldStrategy.NEVER, updateStrategy = FieldStrategy.NEVER)
    private String activeUserId;
}
