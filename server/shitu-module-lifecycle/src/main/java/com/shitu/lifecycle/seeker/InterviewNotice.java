package com.shitu.lifecycle.seeker;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

/** 面试确认信息（驻场「知悉」后推送给求职者，C-408 / M-02）。 */
@Data
@TableName(value = "interview_notice", autoResultMap = true)
public class InterviewNotice {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String companyId;
    private String applicationId;
    private LocalDateTime interviewAt;
    private String address;
    private BigDecimal lng;
    private BigDecimal lat;
    private String routeTips;
    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<String> documents;
    private String contactName;
    private String contactPhoneEnc;
    private String pushedBy;
    private LocalDateTime pushedAt;
}
