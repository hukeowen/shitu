package com.shitu.app.config;

import com.shitu.common.enums.ActorRole;
import com.shitu.common.enums.AuthDomain;
import com.shitu.common.enums.JobType;
import com.shitu.common.enums.ShiftType;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.job.JobService;
import com.shitu.tenant.channel.ChannelCodeService;
import com.shitu.tenant.client.ClientService;
import com.shitu.tenant.company.CompanyService;
import com.shitu.tenant.member.MemberService;
import com.shitu.tenant.project.ProjectService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;

/**
 * 本地演示数据（仅 {@code shitu.dev.seed-demo=true}，默认只在 local profile 打开；生产绝不能开）。
 * 空库首次启动时创建一家已审核的演示劳务公司，方便前端联调和手工走查：
 * <pre>
 * 老板 13800000001 · 项目经理 13800000002 · 驻场 13800000003（验证码在开发环境直接回显）
 * 项目：苏州昆山，3 个招聘中的岗位；公司二维码见启动日志
 * </pre>
 */
@Component
@ConditionalOnProperty(name = "shitu.dev.seed-demo", havingValue = "true")
public class DemoDataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoDataSeeder.class);
    private static final String CREDIT = "91320583MA1DEM7001";

    private final CompanyService companies;
    private final MemberService members;
    private final ClientService clients;
    private final ProjectService projects;
    private final JobService jobs;
    private final ChannelCodeService channels;
    private final JdbcTemplate jdbc;
    private final Clock clock;

    public DemoDataSeeder(CompanyService companies, MemberService members, ClientService clients, ProjectService projects,
                          JobService jobs, ChannelCodeService channels, JdbcTemplate jdbc, Clock clock) {
        this.companies = companies;
        this.members = members;
        this.clients = clients;
        this.projects = projects;
        this.jobs = jobs;
        this.channels = channels;
        this.jdbc = jdbc;
        this.clock = clock;
    }

    @Override
    public void run(ApplicationArguments args) {
        Long exists = jdbc.queryForObject("SELECT COUNT(*) FROM company WHERE unified_credit_code = ?", Long.class, CREDIT);
        if (exists != null && exists > 0) {
            return;
        }
        try {
            seed();
        } catch (RuntimeException e) {
            log.warn("演示数据初始化失败（不影响启动）：{}", e.getMessage());
        }
    }

    private void seed() {
        CompanyService.Applied applied = companies.apply("13800000001", new CompanyService.ApplyCommand(
                "昆山仕兔演示劳务派遣有限公司", "仕兔演示劳务", CREDIT, "320583DEMO", List.of("license/demo.png"), "郭伟"));
        String cid = applied.companyId();
        LocalDate today = LocalDate.now(clock);
        TenantContext.runAs(TenantContext.Mode.OPS, null, () ->
                companies.approve(cid, today, today.plusMonths(3).minusDays(1), "演示数据", "SYSTEM"));

        TenantContext.runAs(TenantContext.Mode.TENANT, cid, () -> {
            AuthPrincipal owner = new AuthPrincipal(AuthDomain.TENANT, applied.memberId(), cid, Set.of("OWNER"), null, "郭伟");
            String pmId = members.create(cid, new MemberService.MemberCommand("刘建国", "13800000002", Set.of(ActorRole.PM), List.of())).memberId();
            AuthPrincipal pm = new AuthPrincipal(AuthDomain.TENANT, pmId, cid, Set.of("PM"), null, "刘建国");
            ClientService.ClientView client = clients.createOrGet("立讯精密工业（昆山）有限公司", null, "苏州");
            ClientService.ContractView contract = clients.submitContract(cid, new ClientService.ContractCommand(
                    client.clientId(), "contract/demo.pdf", today.minusDays(1), today.plusYears(1)));
            TenantContext.runAs(TenantContext.Mode.OPS, null, () -> clients.audit(contract.contractId(), true, "演示数据", "SYSTEM"));
            String projectId = projects.create(pm, new ProjectService.ProjectCommand("立讯精密昆山二期", client.clientId(),
                    contract.contractId(), "江苏", "苏州", "昆山", "昆山市锦溪镇长云路 1 号",
                    new BigDecimal("120.958000"), new BigDecimal("31.385000"))).projectId();
            members.create(cid, new MemberService.MemberCommand("王磊", "13800000003", Set.of(ActorRole.SITE), List.of(projectId)));

            job(pm, projectId, "SMT 贴片操作工（长白班）", JobType.ELECTRONICS, 5500, 6800, ShiftType.LONG_DAY, 4, true, 30);
            job(pm, projectId, "电子组装普工（两班倒）", JobType.GENERAL, 6000, 7500, ShiftType.TWO_SHIFT, 6, false, 50);
            job(pm, projectId, "成品仓储分拣员", JobType.WAREHOUSE, 5000, 6200, ShiftType.DAY, 8, true, 10);
            String code = channels.create(owner, new ChannelCodeService.CreateCommand("演示门店海报", null, null)).code();
            log.warn("========== 已创建演示公司 {}：老板 13800000001 / 项目经理 13800000002 / 驻场 13800000003；公司码 /r/{} ==========",
                    cid, code);
            return null;
        });
    }

    private void job(AuthPrincipal pm, String projectId, String title, JobType type, int min, int max, ShiftType shift,
                     int room, boolean aircon, int quota) {
        String jobId = jobs.create(pm, new JobService.JobCommand(projectId, title, type, true, BigDecimal.valueOf(min),
                BigDecimal.valueOf(max), shift, true, room, aircon, false, true, 0, 18, 45,
                "按作业指导书完成本岗位操作，服从班组长安排；入职统一岗前培训。", "五险一金、月度全勤奖、节日福利",
                List.of("身份证", "一寸照片 2 张"), "面试请穿运动鞋，不要化浓妆", "昆山市锦溪镇长云路 1 号东门招聘中心",
                "工作日 09:00 / 14:00", quota)).jobId();
        TenantContext.runAs(TenantContext.Mode.OPS, null, () -> jobs.approve(jobId, "演示数据", "SYSTEM"));
    }
}
