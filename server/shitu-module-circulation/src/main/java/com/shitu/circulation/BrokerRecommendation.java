package com.shitu.circulation;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/** 经纪人二次推荐（T-203）：用户在 C 端确认后走正常实名 + 告知书报名流程。 */
@Data
@TableName("broker_recommendation")
public class BrokerRecommendation {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String companyId;
    private Long brokerCaseId;
    private String jobId;
    private String brokerId;
    private String note;
    /** PENDING / ACCEPTED / DECLINED */
    private String userDecision;
    private LocalDateTime decidedAt;
    private LocalDateTime createdAt;
}
