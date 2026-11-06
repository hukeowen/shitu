package com.shitu.framework.audit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.framework.security.CurrentUser;
import com.shitu.framework.web.ClientInfo;
import com.shitu.framework.web.TraceIdFilter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Optional;

/**
 * 审计日志（P-11）：只追加。与业务写入在同一事务里提交 —— 业务回滚，审计也不留下「做过但没生效」的记录。
 * <p>{@code audit_log} 是平台专属表，租户请求经 MyBatis 访问会被拦截；这里用 JdbcTemplate 直接写，不经过租户拦截器。
 */
@Component
public class AuditLogger {

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public AuditLogger(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /** 操作人取当前登录主体；公司取主体所属公司（租户域）。 */
    public void log(String action, String targetType, String targetId, Map<String, ?> detail) {
        Optional<AuthPrincipal> p = CurrentUser.find();
        write(p.map(x -> x.domain().name()).orElse("SYSTEM"), p.map(AuthPrincipal::subjectId).orElse(null),
                p.map(AuthPrincipal::companyId).orElse(null), action, targetType, targetId, detail);
    }

    /** 显式指定受影响的公司（如运营审核某公司入驻、登录前的匿名操作）。 */
    public void logForCompany(String companyId, String action, String targetType, String targetId, Map<String, ?> detail) {
        Optional<AuthPrincipal> p = CurrentUser.find();
        write(p.map(x -> x.domain().name()).orElse("SYSTEM"), p.map(AuthPrincipal::subjectId).orElse(null),
                companyId, action, targetType, targetId, detail);
    }

    /** 登录等尚无主体的场景，显式给出操作人。 */
    public void logAs(String actorDomain, String actorId, String companyId, String action,
                      String targetType, String targetId, Map<String, ?> detail) {
        write(actorDomain, actorId, companyId, action, targetType, targetId, detail);
    }

    private void write(String domain, String actorId, String companyId, String action,
                       String targetType, String targetId, Map<String, ?> detail) {
        String detailJson;
        try {
            detailJson = detail == null || detail.isEmpty() ? null : json.writeValueAsString(detail);
        } catch (JsonProcessingException e) {
            detailJson = null;
        }
        jdbc.update("INSERT INTO audit_log (actor_domain, actor_id, company_id, action, target_type, target_id, detail, ip, trace_id) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                domain, actorId, companyId, action, targetType, targetId, detailJson, ClientInfo.ip(), TraceIdFilter.current());
    }
}
