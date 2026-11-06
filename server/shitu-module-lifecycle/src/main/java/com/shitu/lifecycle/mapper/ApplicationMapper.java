package com.shitu.lifecycle.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.shitu.lifecycle.seeker.Application;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface ApplicationMapper extends BaseMapper<Application> {
}
