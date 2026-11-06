package com.shitu.lifecycle.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.shitu.lifecycle.seeker.UserStatusLog;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface UserStatusLogMapper extends BaseMapper<UserStatusLog> {
}
