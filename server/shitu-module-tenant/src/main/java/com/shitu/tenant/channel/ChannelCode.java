package com.shitu.tenant.channel;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.shitu.common.enums.ChannelType;
import lombok.Data;

import java.time.LocalDateTime;

/** 渠道码：二维码内容为 {h5}/r/{code}，短码映射到公司 / 成员 / 项目，不在 URL 暴露公司 ID。 */
@Data
@TableName("channel_code")
public class ChannelCode {

    public static final String ACTIVE = "ACTIVE";
    public static final String DISABLED = "DISABLED";

    @TableId(type = IdType.INPUT)
    private String code;
    private ChannelType channelType;
    private String companyId;
    private String memberId;
    private String projectId;
    private String referrerUserId;
    private String name;
    private String status;
    private String createdBy;
    private LocalDateTime createdAt;
}
