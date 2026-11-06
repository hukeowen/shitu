package com.shitu.lifecycle.employment;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.shitu.common.Constants;
import com.shitu.common.api.PageResult;
import com.shitu.common.enums.ActorRole;
import com.shitu.common.util.Masks;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.framework.web.Pages;
import com.shitu.job.Job;
import com.shitu.job.mapper.JobMapper;
import com.shitu.lifecycle.mapper.DutyAbsenceMapper;
import com.shitu.lifecycle.mapper.EmploymentMapper;
import com.shitu.lifecycle.mapper.SeekerUserMapper;
import com.shitu.lifecycle.seeker.SeekerUser;
import com.shitu.tenant.company.CompanyService;
import com.shitu.tenant.mapper.ProjectMapper;
import com.shitu.tenant.project.Project;
import com.shitu.tenant.scope.DataScope;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 在岗人员查询：公司后台人员管理（T-307）与 C 端「我的工作」（C-505）。
 * 来源归属展示：本公司 / 平台自主 / 流转（来源为其他公司，产生流转费）。老板只看聚合数据，不调用本接口（R-13）。
 */
@Service
public class EmploymentQueryService {

    public enum SourceKind { OWN, PLATFORM, TRANSFER }

    public record StaffRow(String employmentId, String userId, String name, String phone, String projectId,
                           String projectName, String jobId, String jobTitle, String employeeNo, LocalDate startDate,
                           LocalDate endDate, long dutyDays, int absenceDaysThisMonth, SourceKind source,
                           String sourceCompanyName) {
    }

    public record MyWork(String employmentId, String companyName, String projectName, String city, String address,
                         String jobTitle, LocalDate startDate, LocalDate endDate, long dutyDays, String employeeNo) {
    }

    private final EmploymentMapper employments;
    private final DutyAbsenceMapper absences;
    private final SeekerUserMapper users;
    private final JobMapper jobs;
    private final ProjectMapper projects;
    private final CompanyService companies;
    private final DataScope scope;
    private final FieldCipher cipher;
    private final Clock clock;

    public EmploymentQueryService(EmploymentMapper employments, DutyAbsenceMapper absences, SeekerUserMapper users,
                                  JobMapper jobs, ProjectMapper projects, CompanyService companies, DataScope scope,
                                  FieldCipher cipher, Clock clock) {
        this.employments = employments;
        this.absences = absences;
        this.users = users;
        this.jobs = jobs;
        this.projects = projects;
        this.companies = companies;
        this.scope = scope;
        this.cipher = cipher;
        this.clock = clock;
    }

    /** @param active true 在岗 / false 已离职 / null 全部 */
    public PageResult<StaffRow> staff(AuthPrincipal p, Boolean active, String projectId, String keyword, Integer page,
                                      Integer pageSize) {
        DataScope.Scope s = scope.of(p);
        if (!s.all() && s.projectIds().isEmpty()) {
            return new PageResult<>(List.of(), 0, 1, 20);
        }
        Set<String> keywordUsers = keyword == null || keyword.isBlank() ? null : usersByEmployeeNoOrName(keyword.trim());
        Page<Employment> pg = employments.selectPage(Pages.of(page, pageSize), new LambdaQueryWrapper<Employment>()
                .in(!s.all(), Employment::getProjectId, s.projectIds())
                .isNull(Boolean.TRUE.equals(active), Employment::getEndDate)
                .isNotNull(Boolean.FALSE.equals(active), Employment::getEndDate)
                .eq(projectId != null && !projectId.isBlank(), Employment::getProjectId, projectId)
                .and(keywordUsers != null, w -> w.eq(Employment::getEmployeeNo, keyword)
                        .or().in(!keywordUsers.isEmpty(), Employment::getUserId, keywordUsers))
                .orderByDesc(Employment::getStartDate));
        List<Employment> list = pg.getRecords();
        Map<String, SeekerUser> us = byId(list.stream().map(Employment::getUserId).collect(Collectors.toSet()),
                ids -> TenantContext.runAsSystem(() -> users.selectBatchIds(ids)), SeekerUser::getUserId);
        Map<String, Project> ps = byId(list.stream().map(Employment::getProjectId).collect(Collectors.toSet()),
                ids -> TenantContext.runAsSystem(() -> projects.selectBatchIds(ids)), Project::getProjectId);
        Map<String, Job> js = byId(list.stream().map(Employment::getJobId).filter(java.util.Objects::nonNull).collect(Collectors.toSet()),
                ids -> TenantContext.runAsSystem(() -> jobs.selectBatchIds(ids)), Job::getJobId);
        Map<String, String> sourceNames = companies.namesOf(list.stream().map(Employment::getSourceCompanyIdSnapshot)
                .filter(x -> !Constants.PLATFORM.equals(x)).collect(Collectors.toSet()));
        Map<String, Integer> absenceCount = absenceThisMonth(list.stream().map(Employment::getEmploymentId).toList());
        boolean site = p.hasRole(ActorRole.SITE.name());
        LocalDate today = LocalDate.now(clock.withZone(Constants.ZONE));
        List<StaffRow> rows = list.stream().map(e -> {
            SeekerUser u = us.get(e.getUserId());
            String name = u == null || u.getRealNameEnc() == null ? "未实名" : cipher.decrypt(u.getRealNameEnc());
            Project pr = ps.get(e.getProjectId());
            Job j = e.getJobId() == null ? null : js.get(e.getJobId());
            SourceKind kind = Constants.PLATFORM.equals(e.getSourceCompanyIdSnapshot()) ? SourceKind.PLATFORM
                    : e.getSourceCompanyIdSnapshot().equals(e.getCompanyId()) ? SourceKind.OWN : SourceKind.TRANSFER;
            LocalDate end = e.getEndDate() == null ? today : e.getEndDate();
            return new StaffRow(e.getEmploymentId(), e.getUserId(), site ? name : Masks.name(name),
                    site && u != null ? cipher.decrypt(u.getPhoneEnc()) : null, e.getProjectId(),
                    pr == null ? null : pr.getName(), e.getJobId(), j == null ? null : j.getTitle(), e.getEmployeeNo(),
                    e.getStartDate(), e.getEndDate(), Math.max(0, ChronoUnit.DAYS.between(e.getStartDate(), end) + 1),
                    absenceCount.getOrDefault(e.getEmploymentId(), 0), kind,
                    kind == SourceKind.TRANSFER ? sourceNames.get(e.getSourceCompanyIdSnapshot()) : null);
        }).toList();
        return new PageResult<>(rows, pg.getTotal(), pg.getCurrent(), pg.getSize());
    }

    /** C-505：当前在岗；已离职时返回最近一段。 */
    public Optional<MyWork> myWork(String userId) {
        return TenantContext.runAsSystem(() -> {
            Employment e = employments.selectOne(new LambdaQueryWrapper<Employment>().eq(Employment::getUserId, userId)
                    .isNull(Employment::getEndDate));
            if (e == null) {
                e = employments.selectOne(new LambdaQueryWrapper<Employment>().eq(Employment::getUserId, userId)
                        .orderByDesc(Employment::getStartDate).last("LIMIT 1"));
            }
            if (e == null) {
                return Optional.<MyWork>empty();
            }
            Project pr = projects.selectById(e.getProjectId());
            Job j = e.getJobId() == null ? null : jobs.selectById(e.getJobId());
            LocalDate end = e.getEndDate() == null ? LocalDate.now(clock.withZone(Constants.ZONE)) : e.getEndDate();
            return Optional.of(new MyWork(e.getEmploymentId(), companies.namesOf(List.of(e.getCompanyId())).get(e.getCompanyId()),
                    pr == null ? null : pr.getName(), pr == null ? null : pr.getCity(), pr == null ? null : pr.getAddress(),
                    j == null ? null : j.getTitle(), e.getStartDate(), e.getEndDate(),
                    Math.max(0, ChronoUnit.DAYS.between(e.getStartDate(), end) + 1), e.getEmployeeNo()));
        });
    }

    public List<DutyAbsence> absences(String employmentId, LocalDate from, LocalDate to) {
        return absences.selectList(new LambdaQueryWrapper<DutyAbsence>().eq(DutyAbsence::getEmploymentId, employmentId)
                .ge(DutyAbsence::getAbsenceDate, from).le(DutyAbsence::getAbsenceDate, to).orderByAsc(DutyAbsence::getAbsenceDate));
    }

    private Set<String> usersByEmployeeNoOrName(String keyword) {
        // 姓名加密存储无法模糊查；关键字按工号精确匹配，或按完整手机号盲索引查人
        if (com.shitu.common.util.Masks.isMobile(keyword)) {
            String hash = cipher.blindIndex(keyword);
            return TenantContext.runAsSystem(() -> users.selectList(new LambdaQueryWrapper<SeekerUser>()
                    .eq(SeekerUser::getPhoneHash, hash))).stream().map(SeekerUser::getUserId).collect(Collectors.toSet());
        }
        return Set.of();
    }

    private Map<String, Integer> absenceThisMonth(List<String> employmentIds) {
        Map<String, Integer> m = new HashMap<>();
        if (employmentIds.isEmpty()) {
            return m;
        }
        LocalDate first = LocalDate.now(clock.withZone(Constants.ZONE)).withDayOfMonth(1);
        absences.selectList(new LambdaQueryWrapper<DutyAbsence>().in(DutyAbsence::getEmploymentId, employmentIds)
                        .ge(DutyAbsence::getAbsenceDate, first))
                .forEach(d -> m.merge(d.getEmploymentId(), 1, Integer::sum));
        return m;
    }

    private static <T> Map<String, T> byId(Set<String> ids, Function<Set<String>, List<T>> loader, Function<T, String> key) {
        if (ids.isEmpty()) {
            return Map.of();
        }
        return loader.apply(ids).stream().collect(Collectors.toMap(key, Function.identity(), (a, b) -> a));
    }
}
