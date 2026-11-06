package com.shitu.tenant.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.shitu.tenant.member.Member;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface MemberMapper extends BaseMapper<Member> {
}
