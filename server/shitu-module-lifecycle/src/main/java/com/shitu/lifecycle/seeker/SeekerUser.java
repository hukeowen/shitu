package com.shitu.lifecycle.seeker;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.Version;
import com.shitu.common.enums.ChannelType;
import com.shitu.common.enums.ReleaseReason;
import com.shitu.common.enums.UserStatus;
import com.shitu.lifecycle.domain.UserSnapshot;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/** 求职者（{@code user} 表）。user_status / bound_company_id 只允许 LifecycleService 修改。 */
@Data
@TableName("`user`")
public class SeekerUser {

    @TableId(type = IdType.INPUT)
    private String userId;
    private String phoneEnc;
    private String phoneHash;
    private String realNameEnc;
    private String idCardEnc;
    private String idCardHash;
    private LocalDate birthDate;
    private String gender;
    private String kycStatus;
    private String sourceCompanyId;
    private String boundCompanyId;
    private UserStatus userStatus;
    private ReleaseReason lastReleaseReason;
    private String currentApplicationId;
    private String registerChannelCode;
    private ChannelType registerChannelType;
    private Integer matchCycleCount;
    private Integer profileVersion;
    private BigDecimal advanceDebt;
    private Boolean blacklistFlag;
    private LocalDateTime registeredAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    @Version
    private Integer version;

    public UserSnapshot snapshot() {
        return new UserSnapshot(userStatus, sourceCompanyId, boundCompanyId);
    }
}
