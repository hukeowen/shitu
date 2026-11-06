package com.shitu.tenant.member;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@TableName("member_project")
public class MemberProject {
    private String companyId;
    private String memberId;
    private String projectId;
}
