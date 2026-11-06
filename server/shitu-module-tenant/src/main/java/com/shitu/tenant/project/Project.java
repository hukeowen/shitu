package com.shitu.tenant.project;

import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.shitu.common.enums.ProjectStatus;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Data
@TableName("project")
public class Project {

    @TableId(type = IdType.INPUT)
    private String projectId;
    private String companyId;
    private String clientId;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private String contractId;
    private String name;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private String province;
    private String city;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private String district;
    private String address;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private BigDecimal lng;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private BigDecimal lat;
    private ProjectStatus status;
    private LocalDateTime createdAt;
}
