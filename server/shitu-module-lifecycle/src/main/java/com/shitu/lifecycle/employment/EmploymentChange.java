package com.shitu.lifecycle.employment;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** 内部调岗记录（计费不中断，E-07）。 */
@Data
@TableName("employment_change_log")
public class EmploymentChange {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String companyId;
    private String employmentId;
    private String changeType;
    private String fromProject;
    private String toProject;
    private String fromJob;
    private String toJob;
    private LocalDate effectiveDate;
    private String operatorId;
    private LocalDateTime createdAt;
}
