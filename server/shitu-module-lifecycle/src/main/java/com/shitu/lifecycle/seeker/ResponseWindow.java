package com.shitu.lifecycle.seeker;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/** 24h 响应窗口：每个用户同一时刻最多一个 OPEN 窗口（生成列 open_user_id 唯一）。 */
@Data
@TableName("response_window")
public class ResponseWindow {

    public static final String OPEN = "OPEN";
    public static final String CLOSED = "CLOSED";

    @TableId(type = IdType.AUTO)
    private Long id;
    private String userId;
    private String companyId;
    private String stage;
    private String applicationId;
    private LocalDateTime startedAt;
    private LocalDateTime deadline;
    private String status;
    private LocalDateTime closedAt;
    /** 生成列，只读。 */
    @TableField(insertStrategy = com.baomidou.mybatisplus.annotation.FieldStrategy.NEVER,
            updateStrategy = com.baomidou.mybatisplus.annotation.FieldStrategy.NEVER)
    private String openUserId;
}
