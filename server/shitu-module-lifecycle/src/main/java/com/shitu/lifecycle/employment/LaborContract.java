package com.shitu.lifecycle.employment;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.shitu.common.enums.ContractStatus;
import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** 劳动合同（电子签，{@code contract} 表）。esign_flow_id 唯一 → 回调幂等。 */
@Data
@TableName("contract")
public class LaborContract {
    @TableId(type = IdType.INPUT)
    private String contractId;
    private String contractNo;
    private String userId;
    private String companyId;
    private String applicationId;
    private String employmentId;
    private String employeeNo;
    private String templateCode;
    private String title;
    private LocalDate termStart;
    private LocalDate termEnd;
    private ContractStatus status;
    private String esignFlowId;
    private String signUrl;
    private String signedFileKey;
    private LocalDateTime signedAt;
    private LocalDateTime endedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
