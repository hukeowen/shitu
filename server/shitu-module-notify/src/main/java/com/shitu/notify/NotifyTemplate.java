package com.shitu.notify;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/** 通知模板（P-16，改文案不发版）。channels：逗号分隔 INBOX / SMS。 */
@Data
@TableName("notify_template")
public class NotifyTemplate {
    @TableId(type = IdType.INPUT)
    private String templateCode;
    private String channels;
    private String title;
    private String content;
    private String variables;
    private String smsTemplateId;
    private Boolean respectQuietHours;
    private Boolean enabled;
    private String updatedBy;
    private LocalDateTime updatedAt;

    public boolean hasChannel(String ch) {
        return channels != null && (',' + channels.replace(" ", "") + ',').contains(',' + ch + ',');
    }
}
