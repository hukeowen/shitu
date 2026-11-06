package com.shitu.matching.quiz;

import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("engine_config")
public class EngineConfigRow {
    @TableId(type = IdType.INPUT)
    private Integer versionId;
    private String status;
    /** JSON，结构见 {@link com.shitu.matching.domain.EngineConfig} */
    private String config;
    private String publishedBy;
    private LocalDateTime publishedAt;
    private LocalDateTime createdAt;
    @TableField(insertStrategy = FieldStrategy.NEVER, updateStrategy = FieldStrategy.NEVER)
    private Integer activeFlag;
}
