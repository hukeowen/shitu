package com.shitu.lifecycle.seeker;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/** 24h 窗口内的跟进提醒排期（白天 6h / 夜间 12h，由扫描任务发送，Sprint 2 接入）。 */
@Data
@TableName("follow_up_reminder")
public class FollowUpReminder {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long windowId;
    private Integer roundNo;
    private LocalDateTime remindAt;
    private String status;
    private LocalDateTime sentAt;
}
