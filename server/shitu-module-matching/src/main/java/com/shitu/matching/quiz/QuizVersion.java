package com.shitu.matching.quiz;

import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/** 题库版本：DRAFT / ACTIVE / ARCHIVED，同一时刻只有一个 ACTIVE（生成列唯一）。 */
@Data
@TableName("quiz_version")
public class QuizVersion {
    @TableId(type = IdType.INPUT)
    private Integer versionId;
    private String name;
    private String status;
    private String publishedBy;
    private LocalDateTime publishedAt;
    private LocalDateTime createdAt;
    @TableField(insertStrategy = FieldStrategy.NEVER, updateStrategy = FieldStrategy.NEVER)
    private Integer activeFlag;
}
