package com.shitu.platform.audit;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.shitu.common.api.PageResult;
import com.shitu.framework.web.Pages;
import com.shitu.platform.mapper.AuditLogMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDate;

/** 审计日志查询（P-11，仅平台中台）。 */
@Service
public class AuditQueryService {

    public record Query(String actorDomain, String actorId, String companyId, String action, String targetType,
                        String targetId, LocalDate from, LocalDate to, Integer page, Integer pageSize) {
    }

    private final AuditLogMapper mapper;

    public AuditQueryService(AuditLogMapper mapper) {
        this.mapper = mapper;
    }

    public PageResult<AuditLogEntry> query(Query q) {
        LambdaQueryWrapper<AuditLogEntry> w = new LambdaQueryWrapper<AuditLogEntry>()
                .eq(notBlank(q.actorDomain()), AuditLogEntry::getActorDomain, q.actorDomain())
                .eq(notBlank(q.actorId()), AuditLogEntry::getActorId, q.actorId())
                .eq(notBlank(q.companyId()), AuditLogEntry::getCompanyId, q.companyId())
                .eq(notBlank(q.action()), AuditLogEntry::getAction, q.action())
                .eq(notBlank(q.targetType()), AuditLogEntry::getTargetType, q.targetType())
                .eq(notBlank(q.targetId()), AuditLogEntry::getTargetId, q.targetId())
                .ge(q.from() != null, AuditLogEntry::getCreatedAt, q.from() == null ? null : q.from().atStartOfDay())
                .lt(q.to() != null, AuditLogEntry::getCreatedAt, q.to() == null ? null : q.to().plusDays(1).atStartOfDay())
                .orderByDesc(AuditLogEntry::getId);
        return Pages.map(mapper.selectPage(Pages.of(q.page(), q.pageSize()), w), e -> e);
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }
}
