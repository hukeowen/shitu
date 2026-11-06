package com.shitu.platform.audit;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/** 审计日志（只读视图；写入统一走 framework 的 AuditLogger）。 */
@Data
@TableName("audit_log")
public class AuditLogEntry {

    @TableId(type = IdType.AUTO)
    private Long id;
    private String actorDomain;
    private String actorId;
    private String companyId;
    private String action;
    private String targetType;
    private String targetId;
    private String detail;
    private String ip;
    private String traceId;
    private LocalDateTime createdAt;
}
