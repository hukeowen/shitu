package com.shitu.tenant.client;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/** 甲方用工企业（全平台共享主数据）。 */
@Data
@TableName("client_company")
public class ClientCompany {

    @TableId(type = IdType.INPUT)
    private String clientId;
    private String name;
    private String unifiedCreditCode;
    private String city;
    private LocalDateTime createdAt;
}
