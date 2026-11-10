package com.shitu.tenant.channel;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.shitu.common.enums.ChannelType;
import com.shitu.common.enums.CompanyStatus;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.id.BizIdGenerator;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.tenant.company.Company;
import com.shitu.tenant.mapper.ChannelCodeMapper;
import com.shitu.tenant.mapper.CompanyMapper;
import com.shitu.tenant.member.MemberService;
import com.shitu.tenant.project.ProjectService;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * 渠道码（T-501 / C-101）：公司码、成员专属码、项目专属码。
 * <ul>
 *   <li>二维码内容 {@code {h5}/r/{code}}，短码 8 位不可猜测，不暴露公司 ID；</li>
 *   <li>扫码先进后端 {@code /r/{code}}：记录访问、写 7 天 Cookie、302 到 H5；</li>
 *   <li>公司码（含成员码、项目码）注册 → 私域；公司未通过审核 / 被封禁 / 已注销时码失效，注册按自主注册处理。</li>
 * </ul>
 */
@Service
public class ChannelCodeService {

    private static final int CODE_LENGTH = 8;

    /** 解析结果（C 端注册用）。 */
    public record Resolved(String code, ChannelType channelType, String companyId, String companyName,
                           String memberId, String projectId, boolean bindsCompany) {
    }

    public record ChannelView(String code, ChannelType channelType, String name, String memberId, String memberName,
                              String projectId, String projectName, String status, LocalDateTime createdAt,
                              long visits) {
    }

    public record CreateCommand(String name, String memberId, String projectId) {
    }

    private final ChannelCodeMapper codes;
    private final CompanyMapper companies;
    private final MemberService members;
    private final ProjectService projects;
    private final JdbcTemplate jdbc;
    private final BizIdGenerator ids;
    private final AuditLogger audit;
    private final Clock clock;

    public ChannelCodeService(ChannelCodeMapper codes, CompanyMapper companies, MemberService members,
                              ProjectService projects, JdbcTemplate jdbc, BizIdGenerator ids, AuditLogger audit,
                              Clock clock) {
        this.codes = codes;
        this.companies = companies;
        this.members = members;
        this.projects = projects;
        this.jdbc = jdbc;
        this.ids = ids;
        this.audit = audit;
        this.clock = clock;
    }

    // ------------------------------------------------------------------ C 端（匿名，SYSTEM 模式）

    /** 解析渠道码；不存在 / 已停用 / 公司不可用返回空。 */
    public Optional<Resolved> resolve(String code) {
        if (code == null || !code.matches("^[A-Za-z0-9]{4,16}$")) {
            return Optional.empty();
        }
        return TenantContext.runAsSystem(() -> {
            ChannelCode c = codes.selectById(code);
            if (c == null || !ChannelCode.ACTIVE.equals(c.getStatus())) {
                return Optional.<Resolved>empty();
            }
            if (!c.getChannelType().bindsCompany()) {
                return Optional.of(new Resolved(c.getCode(), c.getChannelType(), null, null, null, null, false));
            }
            Company co = companies.selectById(c.getCompanyId());
            if (co == null || !(co.getCompanyStatus() == CompanyStatus.NORMAL || co.getCompanyStatus() == CompanyStatus.THROTTLED)) {
                return Optional.<Resolved>empty();
            }
            String display = co.getShortName() != null && !co.getShortName().isBlank() ? co.getShortName() : co.getName();
            return Optional.of(new Resolved(c.getCode(), c.getChannelType(), co.getCompanyId(), display,
                    c.getMemberId(), c.getProjectId(), true));
        });
    }

    /** 记录扫码访问（渠道转化报表的「访问」层）。channel_visit 为平台专属表，直接写。 */
    public void recordVisit(String code, String visitorKey, String userId, String ip, String userAgent) {
        jdbc.update("INSERT INTO channel_visit (code, visitor_key, user_id, ip, user_agent) VALUES (?, ?, ?, ?, ?)",
                code, visitorKey, userId, ip, userAgent);
    }

    // ------------------------------------------------------------------ 公司后台（TENANT 模式）

    public List<ChannelView> list(AuthPrincipal p, boolean onlyMine) {
        List<ChannelCode> list = codes.selectList(new LambdaQueryWrapper<ChannelCode>()
                .eq(onlyMine, ChannelCode::getMemberId, p.subjectId())
                .orderByDesc(ChannelCode::getCreatedAt));
        return views(list);
    }

    @Transactional
    public ChannelView create(AuthPrincipal p, CreateCommand cmd) {
        BizException.check(cmd.name() != null && !cmd.name().isBlank() && cmd.name().trim().length() <= 64,
                ErrorCode.SYS_BAD_REQUEST, "请填写渠道码名称");
        if (cmd.memberId() != null && !cmd.memberId().isBlank()) {
            members.get(cmd.memberId());
        }
        if (cmd.projectId() != null && !cmd.projectId().isBlank()) {
            projects.mustGet(cmd.projectId());
        }
        ChannelCode c = newCode(p.companyId(), blankToNull(cmd.memberId()), blankToNull(cmd.projectId()), cmd.name().trim(), p.subjectId());
        audit.log("CHANNEL_CODE_CREATE", "CHANNEL_CODE", c.getCode(), Map.of("name", c.getName()));
        return views(List.of(c)).get(0);
    }

    /** 成员的专属码（驻场 / 经纪人分享用），没有则自动生成。 */
    @Transactional
    public ChannelView mine(AuthPrincipal p) {
        ChannelCode c = codes.selectOne(new LambdaQueryWrapper<ChannelCode>()
                .eq(ChannelCode::getMemberId, p.subjectId())
                .isNull(ChannelCode::getProjectId)
                .eq(ChannelCode::getStatus, ChannelCode.ACTIVE)
                .orderByAsc(ChannelCode::getCreatedAt)
                .last("LIMIT 1"));
        if (c == null) {
            c = newCode(p.companyId(), p.subjectId(), null, (p.name() == null ? "成员" : p.name()) + "的专属码", p.subjectId());
        }
        return views(List.of(c)).get(0);
    }

    @Transactional
    public ChannelView setStatus(String code, boolean active) {
        ChannelCode c = codes.selectById(code);
        BizException.check(c != null, ErrorCode.SYS_NOT_FOUND);
        c.setStatus(active ? ChannelCode.ACTIVE : ChannelCode.DISABLED);
        codes.updateById(c);
        audit.log(active ? "CHANNEL_CODE_ENABLE" : "CHANNEL_CODE_DISABLE", "CHANNEL_CODE", code, null);
        return views(List.of(c)).get(0);
    }

    /** 访问人数（按访客去重；channel_visit 是平台专属表，用 JDBC 按已经过租户过滤的码列表统计）。 */
    public Map<String, Long> visitCounts(Collection<String> codeList) {
        if (codeList.isEmpty()) {
            return new HashMap<>();
        }
        String in = codeList.stream().map(x -> "?").collect(Collectors.joining(","));
        Map<String, Long> m = new HashMap<>();
        jdbc.query("SELECT code, COUNT(DISTINCT visitor_key) FROM channel_visit WHERE code IN (" + in + ") GROUP BY code",
                rs -> {
                    m.put(rs.getString(1), rs.getLong(2));
                }, codeList.toArray());
        return m;
    }

    // ------------------------------------------------------------------

    private ChannelCode newCode(String companyId, String memberId, String projectId, String name, String createdBy) {
        for (int i = 0; i < 5; i++) {
            ChannelCode c = new ChannelCode();
            c.setCode(ids.shortCode(CODE_LENGTH));
            c.setChannelType(ChannelType.COMPANY_QR);
            c.setCompanyId(companyId);
            c.setMemberId(memberId);
            c.setProjectId(projectId);
            c.setName(name);
            c.setStatus(ChannelCode.ACTIVE);
            c.setCreatedBy(createdBy);
            c.setCreatedAt(LocalDateTime.now(clock));
            try {
                codes.insert(c);
                return c;
            } catch (DuplicateKeyException e) {
                // 8 位 55 进制碰撞概率极低，重试即可
            }
        }
        throw new IllegalStateException("channel code generation failed");
    }

    private List<ChannelView> views(List<ChannelCode> list) {
        Map<String, String> memberNames = members.namesOf(list.stream().map(ChannelCode::getMemberId)
                .filter(java.util.Objects::nonNull).distinct().toList());
        Map<String, String> projectNames = projects.namesOf(list.stream().map(ChannelCode::getProjectId)
                .filter(java.util.Objects::nonNull).distinct().toList());
        Map<String, Long> visits = visitCounts(list.stream().map(ChannelCode::getCode).toList());
        return list.stream().map(c -> new ChannelView(c.getCode(), c.getChannelType(), c.getName(), c.getMemberId(),
                memberNames.get(c.getMemberId()), c.getProjectId(), projectNames.get(c.getProjectId()), c.getStatus(),
                c.getCreatedAt(), visits.getOrDefault(c.getCode(), 0L))).toList();
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
