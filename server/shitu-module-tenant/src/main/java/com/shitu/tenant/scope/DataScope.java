package com.shitu.tenant.scope;

import com.shitu.common.enums.ActorRole;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.tenant.member.MemberService;
import org.springframework.stereotype.Component;

import java.util.Set;

/**
 * 租户内的数据范围（02-架构 §11.3）：老板、经纪人看全公司；驻场、项目经理只看自己负责的项目。
 * 公司之间的隔离由租户拦截器保证，这里只处理公司内部。
 */
@Component
public class DataScope {

    /** 全公司范围。 */
    public record Scope(boolean all, Set<String> projectIds) {
        public boolean covers(String projectId) {
            return all || projectIds.contains(projectId);
        }
    }

    private final MemberService members;

    public DataScope(MemberService members) {
        this.members = members;
    }

    public Scope of(AuthPrincipal p) {
        if (p.hasAnyRole(ActorRole.OWNER.name(), ActorRole.BROKER.name())) {
            return new Scope(true, Set.of());
        }
        return new Scope(false, members.projectIdsOf(p.subjectId()));
    }

    public void checkProject(AuthPrincipal p, String projectId) {
        BizException.check(of(p).covers(projectId), ErrorCode.TEN_PROJECT_SCOPE);
    }
}
