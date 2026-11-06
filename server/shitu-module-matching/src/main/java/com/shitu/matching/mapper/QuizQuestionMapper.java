package com.shitu.matching.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.shitu.matching.quiz.QuizQuestion;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface QuizQuestionMapper extends BaseMapper<QuizQuestion> {
}
