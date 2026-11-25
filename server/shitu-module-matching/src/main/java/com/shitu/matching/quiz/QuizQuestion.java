package com.shitu.matching.quiz;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import com.shitu.matching.domain.ProfileBuilder;
import lombok.Data;

import java.util.List;

@Data
@TableName(value = "quiz_question", autoResultMap = true)
public class QuizQuestion {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Integer versionId;
    private Integer seq;
    /** JUDGE 判断题 / CHOICE 选择题 / NUMBER 数字题 / MATRIX 矩阵题（D-62） */
    private String questionType;
    private String stem;
    private String hint;
    private String profileField;
    /** HARD_FILTER / SOFT_WEIGHT */
    private String matchRole;
    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<ProfileBuilder.OptionDef> options;
    /** 题型参数：数字题的范围 / 单位，矩阵题「看情况」的追问；单选题为 null（V1_7_7 新增列） */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private ProfileBuilder.QuestionConfig config;

    public ProfileBuilder.QuestionDef toDef() {
        return new ProfileBuilder.QuestionDef(seq, questionType, profileField, matchRole,
                options == null ? List.of() : options, config);
    }
}
