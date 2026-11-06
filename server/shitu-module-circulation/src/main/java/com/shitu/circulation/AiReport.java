package com.shitu.circulation;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/** AI 岗位匹配分析报告（T-202）。recommendations 为 JSON：[{jobId, title, matchScore, reason}]。 */
@Data
@TableName("ai_report")
public class AiReport {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String companyId;
    private Long brokerCaseId;
    private String summary;
    private String recommendations;
    /** TEMPLATE / LLM */
    private String generator;
    private LocalDateTime createdAt;
}
