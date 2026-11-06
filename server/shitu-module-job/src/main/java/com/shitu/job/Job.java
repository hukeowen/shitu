package com.shitu.job;

import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.Version;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import com.shitu.common.enums.JobStatus;
import com.shitu.common.enums.JobType;
import com.shitu.common.enums.ShiftType;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

@Data
@TableName(value = "job", autoResultMap = true)
public class Job {

    @TableId(type = IdType.INPUT)
    private String jobId;
    private String companyId;
    private String projectId;
    private String clientId;
    private String title;
    private JobType jobType;
    private Boolean factoryJob;
    private BigDecimal salaryMin;
    private BigDecimal salaryMax;
    private ShiftType shiftType;
    private Boolean dormProvided;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private Integer dormRoomSize;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private Boolean dormAircon;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private Boolean dormPrivateBath;
    private Boolean mealProvided;
    private Integer minWorkYears;
    private Integer ageMin;
    private Integer ageMax;
    private String duties;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private String benefits;
    @TableField(typeHandler = JacksonTypeHandler.class, updateStrategy = FieldStrategy.ALWAYS)
    private List<String> requiredDocuments;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private String notes;
    private String interviewAddress;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private String interviewTimeDesc;
    private Integer quotaTotal;
    private Integer quotaRemaining;
    private JobStatus jobStatus;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private String auditRemark;
    private LocalDateTime submittedAt;
    private LocalDateTime postedAt;
    private LocalDateTime decayResetAt;
    /** 仅平台可见（R-14），租户接口不得返回。 */
    private BigDecimal matchWeight;
    private Integer complaintVerified;
    private LocalDateTime lastInfoUpdateAt;
    private String createdBy;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    @Version
    private Integer version;

    public int occupied() {
        return quotaTotal - quotaRemaining;
    }
}
