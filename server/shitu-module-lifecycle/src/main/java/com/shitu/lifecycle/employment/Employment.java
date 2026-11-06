package com.shitu.lifecycle.employment;

import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** 任职记录：计费的唯一事实依据（02-架构 §6.2）。同一用户同时只有一段在职（生成列唯一）。 */
@Data
@TableName("employment")
public class Employment {
    public static final String ORIGIN_PLATFORM = "PLATFORM_ONBOARD";
    public static final String ORIGIN_ROSTER = "ROSTER_IMPORT";

    @TableId(type = IdType.INPUT)
    private String employmentId;
    private String userId;
    private String companyId;
    private String projectId;
    private String jobId;
    private String applicationId;
    private String employeeNo;
    private LocalDate startDate;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private LocalDate endDate;
    /** 入职时的来源公司快照（R-05：流转费归属依据） */
    private String sourceCompanyIdSnapshot;
    /** source ≠ 入职公司 → 产生流转费 */
    private Boolean isTransfer;
    private Boolean isStock;
    private String origin;
    private String contractId;
    private String endReason;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    @TableField(insertStrategy = FieldStrategy.NEVER, updateStrategy = FieldStrategy.NEVER)
    private String activeUserId;
}
