package com.shitu.tenant.project;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.shitu.common.enums.ActorRole;
import com.shitu.common.enums.ProjectStatus;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.id.BizIdGenerator;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.tenant.client.ClientContract;
import com.shitu.tenant.client.ClientService;
import com.shitu.tenant.mapper.ProjectMapper;
import com.shitu.tenant.member.MemberService;
import com.shitu.tenant.scope.DataScope;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 项目管理（T-301）：项目 = 劳务公司在某个甲方厂区的用工项目，关联甲方企业与合作合同。
 * 项目经理新建的项目自动由本人负责。
 */
@Service
public class ProjectService {

    public record ProjectCommand(String name, String clientId, String contractId, String province, String city,
                                 String district, String address, BigDecimal lng, BigDecimal lat) {
    }

    public record ProjectView(String projectId, String name, String clientId, String clientName, String contractId,
                              String province, String city, String district, String address, BigDecimal lng,
                              BigDecimal lat, ProjectStatus status, boolean contractEffective, LocalDateTime createdAt) {
    }

    private final ProjectMapper projects;
    private final ClientService clients;
    private final MemberService members;
    private final DataScope scope;
    private final BizIdGenerator ids;
    private final AuditLogger audit;
    private final Clock clock;

    public ProjectService(ProjectMapper projects, ClientService clients, MemberService members, DataScope scope,
                          BizIdGenerator ids, AuditLogger audit, Clock clock) {
        this.projects = projects;
        this.clients = clients;
        this.members = members;
        this.scope = scope;
        this.ids = ids;
        this.audit = audit;
        this.clock = clock;
    }

    public List<ProjectView> list(AuthPrincipal p, ProjectStatus status, String keyword) {
        DataScope.Scope s = scope.of(p);
        if (!s.all() && s.projectIds().isEmpty()) {
            return List.of();
        }
        List<Project> list = projects.selectList(new LambdaQueryWrapper<Project>()
                .in(!s.all(), Project::getProjectId, s.projectIds())
                .eq(status != null, Project::getStatus, status)
                .like(keyword != null && !keyword.isBlank(), Project::getName, keyword)
                .orderByDesc(Project::getCreatedAt));
        return views(list);
    }

    public ProjectView get(AuthPrincipal p, String projectId) {
        Project pr = mustGet(projectId);
        scope.checkProject(p, projectId);
        return views(List.of(pr)).get(0);
    }

    /** TENANT 模式下自动限定本公司；不存在或属于其他公司都返回 404。 */
    public Project mustGet(String projectId) {
        Project pr = projects.selectById(projectId);
        BizException.check(pr != null, ErrorCode.SYS_NOT_FOUND, "项目不存在");
        return pr;
    }

    public Project find(String projectId) {
        return projects.selectById(projectId);
    }

    @Transactional
    public ProjectView create(AuthPrincipal p, ProjectCommand cmd) {
        validate(cmd);
        Project pr = new Project();
        pr.setProjectId(ids.dated("P", 3));
        pr.setCompanyId(p.companyId());
        apply(pr, cmd);
        pr.setStatus(ProjectStatus.ACTIVE);
        pr.setCreatedAt(LocalDateTime.now(clock));
        projects.insert(pr);
        if (p.hasRole(ActorRole.PM.name()) && !p.hasRole(ActorRole.OWNER.name())) {
            members.assignProject(p.companyId(), p.subjectId(), pr.getProjectId());
        }
        audit.log("PROJECT_CREATE", "PROJECT", pr.getProjectId(), Map.of("name", pr.getName(), "clientId", pr.getClientId()));
        return views(List.of(pr)).get(0);
    }

    @Transactional
    public ProjectView update(AuthPrincipal p, String projectId, ProjectCommand cmd) {
        validate(cmd);
        Project pr = mustGet(projectId);
        scope.checkProject(p, projectId);
        BizException.check(pr.getStatus() == ProjectStatus.ACTIVE, ErrorCode.TEN_ILLEGAL_STATUS, "项目已结束");
        BizException.check(pr.getClientId().equals(cmd.clientId()), ErrorCode.SYS_BAD_REQUEST, "项目创建后不能更换甲方");
        apply(pr, cmd);
        projects.updateById(pr);
        audit.log("PROJECT_UPDATE", "PROJECT", projectId, null);
        return views(List.of(pr)).get(0);
    }

    /** 结束项目。调用方需先确认项目下没有招聘中的岗位。 */
    @Transactional
    public ProjectView close(AuthPrincipal p, String projectId) {
        Project pr = mustGet(projectId);
        scope.checkProject(p, projectId);
        BizException.check(pr.getStatus() == ProjectStatus.ACTIVE, ErrorCode.TEN_ILLEGAL_STATUS);
        pr.setStatus(ProjectStatus.CLOSED);
        projects.updateById(pr);
        audit.log("PROJECT_CLOSE", "PROJECT", projectId, null);
        return views(List.of(pr)).get(0);
    }

    public Map<String, String> namesOf(Collection<String> projectIds) {
        if (projectIds == null || projectIds.isEmpty()) {
            return new HashMap<>();
        }
        Map<String, String> m = new HashMap<>();
        projects.selectBatchIds(projectIds).forEach(x -> m.put(x.getProjectId(), x.getName()));
        return m;
    }

    private void validate(ProjectCommand cmd) {
        BizException.check(cmd.name() != null && !cmd.name().isBlank() && cmd.name().trim().length() <= 64,
                ErrorCode.SYS_BAD_REQUEST, "请填写项目名称");
        BizException.check(cmd.city() != null && !cmd.city().isBlank(), ErrorCode.SYS_BAD_REQUEST, "请选择城市");
        BizException.check(cmd.address() != null && !cmd.address().isBlank(), ErrorCode.SYS_BAD_REQUEST, "请填写厂区地址");
        BizException.check(cmd.clientId() != null && clients.findClient(cmd.clientId()) != null,
                ErrorCode.SYS_NOT_FOUND, "甲方企业不存在");
        if (cmd.contractId() != null && !cmd.contractId().isBlank()) {
            ClientContract c = clients.findContract(cmd.contractId());
            BizException.check(c != null && c.getClientId().equals(cmd.clientId()), ErrorCode.SYS_BAD_REQUEST, "合同与甲方不匹配");
        }
    }

    private static void apply(Project pr, ProjectCommand cmd) {
        pr.setName(cmd.name().trim());
        pr.setClientId(cmd.clientId());
        pr.setContractId(cmd.contractId() == null || cmd.contractId().isBlank() ? null : cmd.contractId());
        pr.setProvince(cmd.province());
        pr.setCity(cmd.city().trim());
        pr.setDistrict(cmd.district());
        pr.setAddress(cmd.address().trim());
        pr.setLng(cmd.lng());
        pr.setLat(cmd.lat());
    }

    private List<ProjectView> views(List<Project> list) {
        Map<String, String> clientNames = clients.clientNames(list.stream().map(Project::getClientId).distinct().toList());
        LocalDate today = LocalDate.now(clock);
        return list.stream().map(pr -> new ProjectView(pr.getProjectId(), pr.getName(), pr.getClientId(),
                clientNames.get(pr.getClientId()), pr.getContractId(), pr.getProvince(), pr.getCity(), pr.getDistrict(),
                pr.getAddress(), pr.getLng(), pr.getLat(), pr.getStatus(),
                clients.hasEffectiveContract(pr.getCompanyId(), pr.getClientId(), today), pr.getCreatedAt())).toList();
    }
}
