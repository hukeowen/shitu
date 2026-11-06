package com.shitu.lifecycle.seeker;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/** 状态迁移日志（只追加）。 */
@Data
@TableName("user_status_log")
public class UserStatusLog {

    @TableId(type = IdType.AUTO)
    private Long id;
    private String userId;
    private String event;
    private String fromStatus;
    private String toStatus;
    private String boundBefore;
    private String boundAfter;
    private String releaseReason;
    private String applicationId;
    private String actorRole;
    private String actorId;
    private String actorCompanyId;
    private String remark;
    private String ip;
    private String traceId;
    private LocalDateTime createdAt;
}
