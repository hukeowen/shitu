package com.shitu.tenant.company;

import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.Version;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import com.baomidou.mybatisplus.annotation.TableField;
import com.shitu.common.enums.CompanyStatus;
import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

@Data
@TableName(value = "company", autoResultMap = true)
public class Company {

    @TableId(type = IdType.INPUT)
    private String companyId;
    private String name;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private String shortName;
    private String unifiedCreditCode;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private String dispatchLicenseNo;
    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<String> licenseFiles;
    private String contactName;
    private String contactPhoneEnc;
    private LocalDateTime submittedAt;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private String auditRemark;
    private String auditedBy;
    private LocalDateTime auditedAt;
    private CompanyStatus companyStatus;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private String statusRemark;
    private LocalDate onboardDate;
    private LocalDate freePeriodEnd;
    private Integer creditScore;
    private Integer penaltyLevel;
    private LocalDate penaltyUntil;
    private Boolean feeRightsRevoked;
    private Integer paydayOfMonth;
    private LocalDateTime closedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    @Version
    private Integer version;
}
