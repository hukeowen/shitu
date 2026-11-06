package com.shitu.tenant.member;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.shitu.common.enums.ActorRole;
import com.shitu.common.enums.AuthDomain;
import com.shitu.common.enums.MemberStatus;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.common.util.Masks;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.id.BizIdGenerator;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.tenant.mapper.MemberMapper;
import com.shitu.tenant.mapper.MemberProjectMapper;
import com.shitu.tenant.mapper.ProjectMapper;
import com.shitu.tenant.project.Project;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 组织与权限（T-502）：成员、角色（可多选）、负责项目。一个手机号在全平台只能属于一家公司。
 * <p>本类方法在 TENANT 模式下执行时，SQL 自动带 company_id 条件，看不到其他公司的成员。
 */
@Service
public class MemberService {

    public record MemberCommand(String name, String phone, Set<ActorRole> roles, List<String> projectIds) {
    }

    public record MemberView(String memberId, String name, String phoneMasked, Set<ActorRole> roles,
                             List<ProjectRef> projects, MemberStatus status, LocalDateTime lastLoginAt,
                             LocalDateTime createdAt) {
    }

    public record ProjectRef(String projectId, String name) {
    }

    private final MemberMapper members;
    private final MemberProjectMapper memberProjects;
    private final ProjectMapper projects;
    private final FieldCipher cipher;
    private final BizIdGenerator ids;
    private final AuditLogger audit;
    private final Clock clock;

    public MemberService(MemberMapper members, MemberProjectMapper memberProjects, ProjectMapper projects,
                         FieldCipher cipher, BizIdGenerator ids, AuditLogger audit, Clock clock) {
        this.members = members;
        this.memberProjects = memberProjects;
        this.projects = projects;
        this.cipher = cipher;
        this.ids = ids;
        this.audit = audit;
        this.clock = clock;
    }

    // ------------------------------------------------------------------ 登录（SYSTEM 模式，跨租户）

    /** 按手机号找成员（登录用）。 */
    public Optional<Member> findByPhone(String phone) {
        String hash = cipher.blindIndex(phone);
        return Optional.ofNullable(TenantContext.runAsSystem(() ->
                members.selectOne(new LambdaQueryWrapper<Member>().eq(Member::getPhoneHash, hash))));
    }

    /** 登录 / 刷新时构造主体；成员停用则拒绝。 */
    public AuthPrincipal principalOf(String memberId) {
        Member m = TenantContext.runAsSystem(() -> members.selectById(memberId));
        BizException.check(m != null && m.getStatus() == MemberStatus.NORMAL, ErrorCode.AUTH_ACCOUNT_DISABLED);
        return new AuthPrincipal(AuthDomain.TENANT, m.getMemberId(), m.getCompanyId(),
                m.roleSet().stream().map(Enum::name).collect(Collectors.toSet()), null, m.getName());
    }

    public void touchLogin(String memberId) {
        TenantContext.runAsSystem(() -> {
            Member upd = new Member();
            upd.setMemberId(memberId);
            upd.setLastLoginAt(LocalDateTime.now(clock));
            return members.updateById(upd);
        });
    }

    // ------------------------------------------------------------------ 公司后台（TENANT 模式）

    public List<MemberView> list(String keyword, ActorRole role) {
        List<Member> list = members.selectList(new LambdaQueryWrapper<Member>()
                .like(keyword != null && !keyword.isBlank(), Member::getName, keyword)
                .like(role != null, Member::getRoles, role == null ? null : role.name())
                .orderByAsc(Member::getCreatedAt));
        Map<String, List<ProjectRef>> refs = projectRefs(list.stream().map(Member::getMemberId).toList());
        return list.stream().map(m -> view(m, refs.getOrDefault(m.getMemberId(), List.of()))).toList();
    }

    public MemberView get(String memberId) {
        Member m = mustGet(memberId);
        return view(m, projectRefs(List.of(memberId)).getOrDefault(memberId, List.of()));
    }

    @Transactional
    public MemberView create(String companyId, MemberCommand cmd) {
        validate(cmd, true);
        String hash = cipher.blindIndex(cmd.phone());
        Long taken = TenantContext.runAsSystem(() -> members.selectCount(new LambdaQueryWrapper<Member>().eq(Member::getPhoneHash, hash)));
        BizException.check(taken == 0, ErrorCode.TEN_PHONE_TAKEN);
        Member m = new Member();
        m.setMemberId(ids.dated("M", 4));
        m.setCompanyId(companyId);
        m.setName(cmd.name().trim());
        m.setPhoneEnc(cipher.encrypt(cmd.phone()));
        m.setPhoneHash(hash);
        m.setRoles(Member.joinRoles(cmd.roles()));
        m.setStatus(MemberStatus.NORMAL);
        m.setCreatedAt(LocalDateTime.now(clock));
        members.insert(m);
        replaceProjects(companyId, m.getMemberId(), cmd.projectIds());
        audit.log("MEMBER_CREATE", "MEMBER", m.getMemberId(), Map.of("roles", m.getRoles(), "projects", safe(cmd.projectIds())));
        return get(m.getMemberId());
    }

    /** 修改姓名、角色、负责项目（手机号不可改：换号需新建成员并停用旧成员）。 */
    @Transactional
    public MemberView update(String companyId, String memberId, MemberCommand cmd) {
        validate(cmd, false);
        Member m = mustGet(memberId);
        Set<ActorRole> before = m.roleSet();
        if (before.contains(ActorRole.OWNER) && !cmd.roles().contains(ActorRole.OWNER)) {
            ensureAnotherOwner(memberId);
        }
        m.setName(cmd.name().trim());
        m.setRoles(Member.joinRoles(cmd.roles()));
        members.updateById(m);
        replaceProjects(companyId, memberId, cmd.projectIds());
        if (!before.equals(cmd.roles())) {
            audit.log("ROLE_CHANGE", "MEMBER", memberId, Map.of("before", Member.joinRoles(before), "after", m.getRoles()));
        }
        audit.log("MEMBER_UPDATE", "MEMBER", memberId, Map.of("projects", safe(cmd.projectIds())));
        return get(memberId);
    }

    /** 停用 / 启用。调用方负责在停用后吊销该成员的全部会话。 */
    @Transactional
    public MemberView setStatus(String memberId, MemberStatus status, String operatorId) {
        BizException.check(!memberId.equals(operatorId), ErrorCode.SYS_BAD_REQUEST, "不能停用自己的账号");
        Member m = mustGet(memberId);
        if (status == MemberStatus.DISABLED && m.roleSet().contains(ActorRole.OWNER)) {
            ensureAnotherOwner(memberId);
        }
        m.setStatus(status);
        members.updateById(m);
        audit.log(status == MemberStatus.DISABLED ? "MEMBER_DISABLE" : "MEMBER_ENABLE", "MEMBER", memberId, null);
        return get(memberId);
    }

    /** 成员负责的项目 ID（数据范围）。 */
    public Set<String> projectIdsOf(String memberId) {
        return memberProjects.selectList(new LambdaQueryWrapper<MemberProject>().eq(MemberProject::getMemberId, memberId))
                .stream().map(MemberProject::getProjectId).collect(Collectors.toSet());
    }

    @Transactional
    public void assignProject(String companyId, String memberId, String projectId) {
        Long exists = memberProjects.selectCount(new LambdaQueryWrapper<MemberProject>()
                .eq(MemberProject::getMemberId, memberId).eq(MemberProject::getProjectId, projectId));
        if (exists == 0) {
            memberProjects.insert(new MemberProject(companyId, memberId, projectId));
        }
    }

    public Map<String, String> namesOf(Collection<String> memberIds) {
        if (memberIds == null || memberIds.isEmpty()) {
            return new HashMap<>();
        }
        Map<String, String> m = new HashMap<>();
        members.selectBatchIds(memberIds).forEach(x -> m.put(x.getMemberId(), x.getName()));
        return m;
    }

    // ------------------------------------------------------------------

    private void replaceProjects(String companyId, String memberId, List<String> projectIds) {
        Set<String> wanted = new LinkedHashSet<>(safe(projectIds));
        if (!wanted.isEmpty()) {
            // 只能指派本公司的项目（TENANT 模式下 selectBatchIds 自动限定本公司）
            long valid = projects.selectBatchIds(wanted).stream().map(Project::getProjectId).distinct().count();
            BizException.check(valid == wanted.size(), ErrorCode.SYS_NOT_FOUND, "负责项目不存在");
        }
        memberProjects.delete(new LambdaQueryWrapper<MemberProject>().eq(MemberProject::getMemberId, memberId));
        for (String pid : wanted) {
            memberProjects.insert(new MemberProject(companyId, memberId, pid));
        }
    }

    private Map<String, List<ProjectRef>> projectRefs(List<String> memberIds) {
        if (memberIds.isEmpty()) {
            return new HashMap<>();
        }
        List<MemberProject> mps = memberProjects.selectList(new LambdaQueryWrapper<MemberProject>()
                .in(MemberProject::getMemberId, memberIds));
        Set<String> pids = mps.stream().map(MemberProject::getProjectId).collect(Collectors.toSet());
        Map<String, String> names = new HashMap<>();
        if (!pids.isEmpty()) {
            projects.selectBatchIds(pids).forEach(p -> names.put(p.getProjectId(), p.getName()));
        }
        Map<String, List<ProjectRef>> out = new HashMap<>();
        for (MemberProject mp : mps) {
            out.computeIfAbsent(mp.getMemberId(), k -> new java.util.ArrayList<>())
                    .add(new ProjectRef(mp.getProjectId(), names.getOrDefault(mp.getProjectId(), mp.getProjectId())));
        }
        return out;
    }

    private Member mustGet(String memberId) {
        Member m = members.selectById(memberId);
        // 跨租户访问统一 404，不暴露数据是否存在（02-架构 §11.3）
        BizException.check(m != null, ErrorCode.SYS_NOT_FOUND);
        return m;
    }

    private void ensureAnotherOwner(String exceptId) {
        long owners = members.selectCount(new LambdaQueryWrapper<Member>()
                .eq(Member::getStatus, MemberStatus.NORMAL)
                .like(Member::getRoles, ActorRole.OWNER.name())
                .ne(Member::getMemberId, exceptId));
        BizException.check(owners > 0, ErrorCode.TEN_LAST_OWNER);
    }

    private static void validate(MemberCommand cmd, boolean creating) {
        BizException.check(cmd.name() != null && !cmd.name().isBlank() && cmd.name().trim().length() <= 32,
                ErrorCode.SYS_BAD_REQUEST, "请填写姓名");
        if (creating) {
            BizException.check(Masks.isMobile(cmd.phone()), ErrorCode.AUTH_PHONE_INVALID);
        }
        BizException.check(cmd.roles() != null && !cmd.roles().isEmpty() && Member.TENANT_ROLES.containsAll(cmd.roles()),
                ErrorCode.SYS_BAD_REQUEST, "请选择角色");
    }

    private MemberView view(Member m, List<ProjectRef> refs) {
        return new MemberView(m.getMemberId(), m.getName(), Masks.phone(cipher.decrypt(m.getPhoneEnc())), m.roleSet(),
                refs, m.getStatus(), m.getLastLoginAt(), m.getCreatedAt());
    }

    private static List<String> safe(List<String> l) {
        return l == null ? List.of() : new java.util.ArrayList<>(new HashSet<>(l));
    }
}
