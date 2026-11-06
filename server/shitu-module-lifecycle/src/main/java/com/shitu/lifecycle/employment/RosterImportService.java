package com.shitu.lifecycle.employment;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.shitu.common.Constants;
import com.shitu.common.enums.ActorRole;
import com.shitu.common.enums.UserStatus;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.common.util.Masks;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.id.BizIdGenerator;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.job.Job;
import com.shitu.job.mapper.JobMapper;
import com.shitu.lifecycle.domain.IdCards;
import com.shitu.lifecycle.domain.LifecycleEvent;
import com.shitu.lifecycle.domain.TransitionContext;
import com.shitu.lifecycle.mapper.EmploymentMapper;
import com.shitu.lifecycle.seeker.KycService;
import com.shitu.lifecycle.seeker.LifecycleService;
import com.shitu.lifecycle.seeker.SeekerUser;
import com.shitu.tenant.company.Company;
import com.shitu.tenant.company.CompanyService;
import com.shitu.tenant.mapper.ProjectMapper;
import com.shitu.tenant.project.Project;
import com.shitu.tenant.scope.DataScope;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 花名册导入（T-503 / P-03）：把公司已有的在岗员工一次性导入为「私域在岗」。
 * <ul>
 *   <li>逐行独立事务：一行失败不影响其他行，失败原因写进报告，可下载失败行修改后重传；</li>
 *   <li>新手机号 → 新建用户（来源 = 本公司）；已有账号且处于公域 → ROSTER_IMPORT（来源不变，R-05）；
 *       已在任何公司私域 / 流程中 → 失败（不能抢别家的人）；</li>
 *   <li>实名同样走校验码、年龄、一证一号、二要素；</li>
 *   <li>免费期内导入的人员标记为存量（is_stock），计入存量基数（文档 2.2、J-07）。</li>
 * </ul>
 */
@Service
public class RosterImportService {

    /** 一行花名册（Excel 由应用层解析）。 */
    public record Row(int rowNo, String name, String phone, String idCard, String project, String jobId, LocalDate startDate,
                      String employeeNo) {
    }

    public record RowResult(int rowNo, boolean success, String error, String userId) {
    }

    public record BatchResult(String batchId, int total, int success, int failed, boolean inFreePeriod, List<RowResult> rows) {
    }

    private static final int MAX_ROWS = 2000;

    private final LifecycleService lifecycle;
    private final KycService kyc;
    private final EmploymentMapper employments;
    private final ProjectMapper projects;
    private final JobMapper jobs;
    private final CompanyService companies;
    private final DataScope scope;
    private final FieldCipher cipher;
    private final BizIdGenerator ids;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final AuditLogger audit;
    private final ObjectMapper json;
    private final Clock clock;

    public RosterImportService(LifecycleService lifecycle, KycService kyc, EmploymentMapper employments, ProjectMapper projects,
                               JobMapper jobs, CompanyService companies, DataScope scope, FieldCipher cipher,
                               BizIdGenerator ids, JdbcTemplate jdbc, TransactionTemplate tx, AuditLogger audit,
                               ObjectMapper json, Clock clock) {
        this.lifecycle = lifecycle;
        this.kyc = kyc;
        this.employments = employments;
        this.projects = projects;
        this.jobs = jobs;
        this.companies = companies;
        this.scope = scope;
        this.cipher = cipher;
        this.ids = ids;
        this.jdbc = jdbc;
        this.tx = tx;
        this.audit = audit;
        this.json = json;
        this.clock = clock;
    }

    /** @param fileKey 原文件存储 key（留档） */
    public BatchResult importRows(AuthPrincipal p, String fileKey, List<Row> rows) {
        BizException.check(p.hasRole(ActorRole.PM.name()), ErrorCode.LC_ACTOR_NOT_ALLOWED, "花名册导入由项目经理操作");
        BizException.check(rows != null && !rows.isEmpty(), ErrorCode.SYS_BAD_REQUEST, "表格中没有数据行");
        BizException.check(rows.size() <= MAX_ROWS, ErrorCode.SYS_BAD_REQUEST, "单次最多导入 " + MAX_ROWS + " 行");
        String companyId = p.companyId();
        Company co = companies.find(companyId);
        LocalDate today = LocalDate.now(clock.withZone(Constants.ZONE));
        boolean inFree = co.getFreePeriodEnd() != null && !today.isAfter(co.getFreePeriodEnd());
        String batchId = ids.dated("RB", 4);
        jdbc.update("INSERT INTO roster_batch (batch_id, company_id, file_key, total_rows, in_free_period, operator_id) VALUES (?, ?, ?, ?, ?, ?)",
                batchId, companyId, fileKey == null ? "-" : fileKey, rows.size(), inFree, p.subjectId());

        Map<String, Project> byKey = new LinkedHashMap<>();
        TenantContext.runAs(TenantContext.Mode.TENANT, companyId, () -> projects.selectList(null))
                .forEach(pr -> {
                    byKey.put(pr.getProjectId(), pr);
                    byKey.putIfAbsent(pr.getName(), pr);
                });
        Set<String> seenPhones = new HashSet<>();
        Set<String> seenIds = new HashSet<>();
        List<RowResult> results = new ArrayList<>();
        for (Row r : rows) {
            RowResult res;
            try {
                String err = precheck(r, today, seenPhones, seenIds);
                if (err != null) {
                    res = new RowResult(r.rowNo(), false, err, null);
                } else {
                    Project pr = byKey.get(r.project() == null ? "" : r.project().trim());
                    if (pr == null) {
                        res = new RowResult(r.rowNo(), false, "项目不存在：" + r.project(), null);
                    } else if (!scope.of(p).covers(pr.getProjectId())) {
                        res = new RowResult(r.rowNo(), false, "不是你负责的项目：" + pr.getName(), null);
                    } else {
                        String uid = TenantContext.runAs(TenantContext.Mode.TENANT, companyId,
                                () -> tx.execute(s -> importOne(p, r, pr, inFree)));
                        res = new RowResult(r.rowNo(), true, null, uid);
                    }
                }
            } catch (BizException e) {
                res = new RowResult(r.rowNo(), false, e.getMessage(), null);
            } catch (DuplicateKeyException e) {
                res = new RowResult(r.rowNo(), false, "该人员已有在职记录", null);
            }
            results.add(res);
            recordRow(batchId, companyId, r, res);
        }
        int ok = (int) results.stream().filter(RowResult::success).count();
        jdbc.update("UPDATE roster_batch SET success_rows = ?, failed_rows = ?, status = 'DONE', finished_at = ? WHERE batch_id = ?",
                ok, results.size() - ok, LocalDateTime.now(clock), batchId);
        audit.log("ROSTER_IMPORT", "ROSTER_BATCH", batchId, Map.of("total", rows.size(), "success", ok));
        return new BatchResult(batchId, rows.size(), ok, results.size() - ok, inFree, results);
    }

    private String importOne(AuthPrincipal p, Row r, Project pr, boolean inFree) {
        String companyId = p.companyId();
        String phone = r.phone().trim();
        SeekerUser u = lifecycle.findByPhone(phone).orElse(null);
        if (u == null) {
            u = lifecycle.rosterCreate(phone, companyId, ActorRole.PM, p.subjectId());
        } else {
            BizException.check(EnumSet.of(UserStatus.GUEST, UserStatus.PUBLIC_SEEKING).contains(u.getUserStatus()),
                    ErrorCode.LC_ILLEGAL_TRANSITION, "该人员当前处于「" + u.getUserStatus().label() + "」，不能导入");
            kyc.bindForRoster(u.getUserId(), r.name(), r.idCard());
            lifecycle.transition(u.getUserId(), LifecycleEvent.ROSTER_IMPORT,
                    TransitionContext.tenant(ActorRole.PM, companyId).withTarget(companyId), p.subjectId(), "花名册导入");
            u = lifecycle.find(u.getUserId()).orElseThrow();
        }
        if (!"VERIFIED".equals(u.getKycStatus())) {
            kyc.bindForRoster(u.getUserId(), r.name(), r.idCard());
        }
        String jobId = null;
        if (r.jobId() != null && !r.jobId().isBlank()) {
            Job j = jobs.selectById(r.jobId().trim());
            BizException.check(j != null && j.getProjectId().equals(pr.getProjectId()), ErrorCode.SYS_BAD_REQUEST, "岗位不属于该项目");
            jobId = j.getJobId();
        }
        Employment e = new Employment();
        e.setEmploymentId(ids.dated("EM", 5));
        e.setUserId(u.getUserId());
        e.setCompanyId(companyId);
        e.setProjectId(pr.getProjectId());
        e.setJobId(jobId);
        e.setEmployeeNo(r.employeeNo() == null || r.employeeNo().isBlank() ? null : r.employeeNo().trim());
        e.setStartDate(r.startDate());
        e.setSourceCompanyIdSnapshot(u.getSourceCompanyId());
        e.setIsTransfer(!companyId.equals(u.getSourceCompanyId()));
        e.setIsStock(inFree);
        e.setOrigin(Employment.ORIGIN_ROSTER);
        e.setCreatedAt(LocalDateTime.now(clock));
        employments.insert(e);
        return u.getUserId();
    }

    private static String precheck(Row r, LocalDate today, Set<String> phones, Set<String> idCards) {
        if (r.name() == null || r.name().isBlank()) {
            return "姓名为空";
        }
        if (!Masks.isMobile(r.phone() == null ? null : r.phone().trim())) {
            return "手机号格式不正确";
        }
        if (!IdCards.isValid(r.idCard())) {
            return "身份证号码不正确";
        }
        if (r.startDate() == null || r.startDate().isAfter(today)) {
            return "入职日期为空或晚于今天";
        }
        if (!phones.add(r.phone().trim())) {
            return "表内手机号重复";
        }
        if (!idCards.add(IdCards.normalize(r.idCard()))) {
            return "表内身份证重复";
        }
        return null;
    }

    private void recordRow(String batchId, String companyId, Row r, RowResult res) {
        String raw;
        try {
            // 敏感字段加密后留档（失败行下载时解密回填）
            raw = json.writeValueAsString(Map.of("name", cipher.encrypt(r.name() == null ? "" : r.name()),
                    "phone", cipher.encrypt(r.phone() == null ? "" : r.phone()),
                    "idCard", cipher.encrypt(r.idCard() == null ? "" : r.idCard()),
                    "project", r.project() == null ? "" : r.project(), "jobId", r.jobId() == null ? "" : r.jobId(),
                    "startDate", r.startDate() == null ? "" : r.startDate().toString(),
                    "employeeNo", r.employeeNo() == null ? "" : r.employeeNo()));
        } catch (JsonProcessingException e) {
            raw = "{}";
        }
        jdbc.update("INSERT INTO roster_row (company_id, batch_id, row_no, raw, result, error_msg, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                companyId, batchId, r.rowNo(), raw, res.success() ? "SUCCESS" : "FAILED",
                res.error() == null ? null : res.error().length() > 255 ? res.error().substring(0, 255) : res.error(), res.userId());
    }

    /** 失败行（解密后）供下载修改重传。 */
    public List<Map<String, String>> failedRows(String companyId, String batchId) {
        List<Map<String, String>> out = new ArrayList<>();
        jdbc.query("SELECT row_no, raw, error_msg FROM roster_row WHERE company_id = ? AND batch_id = ? AND result = 'FAILED' ORDER BY row_no",
                rs -> {
                    try {
                        Map<String, String> m = new LinkedHashMap<>(json.readValue(rs.getString(2),
                                json.getTypeFactory().constructMapType(Map.class, String.class, String.class)));
                        for (String k : List.of("name", "phone", "idCard")) {
                            String v = m.get(k);
                            m.put(k, v == null || v.isEmpty() ? "" : cipher.decrypt(v));
                        }
                        m.put("rowNo", String.valueOf(rs.getInt(1)));
                        m.put("error", rs.getString(3));
                        out.add(m);
                    } catch (JsonProcessingException e) {
                        throw new IllegalStateException(e);
                    }
                }, companyId, batchId);
        return out;
    }

    public List<Map<String, Object>> batches(String companyId) {
        return jdbc.queryForList("SELECT batch_id, total_rows, success_rows, failed_rows, in_free_period, status, operator_id, created_at "
                + "FROM roster_batch WHERE company_id = ? ORDER BY created_at DESC LIMIT 50", companyId);
    }
}
