package com.shitu.notify;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/** 站内信（C-507 / 驻场端消息）。同一事件对同一收件人同一模板只发一次（唯一索引幂等）。 */
@Data
@TableName("notification")
public class Notification {
    public static final String SEEKER = "SEEKER";
    public static final String MEMBER = "MEMBER";

    @TableId(type = IdType.AUTO)
    private Long id;
    private String recipientType;
    private String recipientId;
    private String templateCode;
    private String title;
    private String content;
    private String link;
    private Integer priority;
    private Long outboxId;
    private LocalDateTime readAt;
    private LocalDateTime createdAt;
}
