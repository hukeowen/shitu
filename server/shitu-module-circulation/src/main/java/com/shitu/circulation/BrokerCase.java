package com.shitu.circulation;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/** 人才经纪人流转工单（T-201）。同一用户在同一公司同时只有一张未结工单。 */
@Data
@TableName("broker_case")
public class BrokerCase {
    /** 未结状态。 */
    public static final java.util.Set<String> OPEN_STATES = java.util.Set.of("OPEN", "CONTACTED", "RECOMMENDED");

    @TableId(type = IdType.AUTO)
    private Long id;
    private String userId;
    private String companyId;
    /** LOW_MATCH / REMATCH_LIMIT / SITE_TRANSFER / JOB_CHANGE */
    private String triggerType;
    private String matchSessionId;
    private String fromMemberId;
    private String brokerId;
    /** OPEN / CONTACTED / RECOMMENDED / APPLIED / RELEASED / CLOSED */
    private String status;
    private LocalDateTime contactDueAt;
    private LocalDateTime resolveDueAt;
    private LocalDateTime contactedAt;
    private LocalDateTime contactRemindedAt;
    private LocalDateTime closedAt;
    private LocalDateTime createdAt;
}
