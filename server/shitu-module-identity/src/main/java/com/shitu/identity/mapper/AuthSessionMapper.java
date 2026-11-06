package com.shitu.identity.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.shitu.identity.session.AuthSession;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface AuthSessionMapper extends BaseMapper<AuthSession> {
}
