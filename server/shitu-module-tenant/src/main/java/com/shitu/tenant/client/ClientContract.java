package com.shitu.tenant.client;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.shitu.common.enums.ClientContractStatus;
import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** 劳务公司与甲方的合作合同（岗位发布前必须审核通过，P-04）。 */
@Data
@TableName("client_contract")
public class ClientContract {

    @TableId(type = IdType.INPUT)
    private String contractId;
    private String companyId;
    private String clientId;
    private String fileKey;
    private LocalDate validFrom;
    private LocalDate validTo;
    private ClientContractStatus auditStatus;
    private String auditRemark;
    private String auditedBy;
    private LocalDateTime auditedAt;
    private LocalDateTime createdAt;

    public boolean coversDate(LocalDate d) {
        return auditStatus == ClientContractStatus.APPROVED && !d.isBefore(validFrom) && !d.isAfter(validTo);
    }
}
