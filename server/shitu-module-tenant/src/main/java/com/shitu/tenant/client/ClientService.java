package com.shitu.tenant.client;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.shitu.common.api.PageResult;
import com.shitu.common.enums.ClientContractStatus;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.id.BizIdGenerator;
import com.shitu.framework.outbox.OutboxWriter;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.framework.web.Pages;
import com.shitu.tenant.mapper.ClientCompanyMapper;
import com.shitu.tenant.mapper.ClientContractMapper;
import com.shitu.tenant.mapper.CompanyMapper;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 甲方用工企业（共享主数据）与合作合同（租户表，平台审核备案，T-301 / P-04）。
 * 岗位只能挂在「已审核通过且在有效期内」的合同所覆盖的甲方下。
 */
@Service
public class ClientService {

    public record ClientView(String clientId, String name, String unifiedCreditCode, String city) {
        static ClientView of(ClientCompany c) {
            return new ClientView(c.getClientId(), c.getName(), c.getUnifiedCreditCode(), c.getCity());
        }
    }

    public record ContractCommand(String clientId, String fileKey, LocalDate validFrom, LocalDate validTo) {
    }

    public record ContractView(String contractId, String companyId, String companyName, String clientId,
                               String clientName, String fileKey, LocalDate validFrom, LocalDate validTo,
                               ClientContractStatus auditStatus, String auditRemark, LocalDateTime auditedAt,
                               LocalDateTime createdAt, boolean effective) {
    }

    private final ClientCompanyMapper clients;
    private final ClientContractMapper contracts;
    private final CompanyMapper companies;
    private final BizIdGenerator ids;
    private final AuditLogger audit;
    private final OutboxWriter outbox;
    private final Clock clock;

    public ClientService(ClientCompanyMapper clients, ClientContractMapper contracts, CompanyMapper companies, BizIdGenerator ids,
                         AuditLogger audit, OutboxWriter outbox, Clock clock) {
        this.clients = clients;
        this.contracts = contracts;
        this.companies = companies;
        this.ids = ids;
        this.audit = audit;
        this.outbox = outbox;
        this.clock = clock;
    }

    // ------------------------------------------------------------------ 甲方主数据

    public List<ClientView> search(String keyword) {
        return clients.selectList(new LambdaQueryWrapper<ClientCompany>()
                        .like(keyword != null && !keyword.isBlank(), ClientCompany::getName, keyword)
                        .orderByAsc(ClientCompany::getName)
                        .last("LIMIT 20"))
                .stream().map(ClientView::of).toList();
    }

    /** 按全称查找，不存在则新建（甲方是全平台共享主数据，名称唯一）。 */
    @Transactional
    public ClientView createOrGet(String name, String creditCode, String city) {
        BizException.check(name != null && name.trim().length() >= 4, ErrorCode.SYS_BAD_REQUEST, "请填写甲方企业全称");
        String n = name.trim();
        ClientCompany exist = clients.selectOne(new LambdaQueryWrapper<ClientCompany>().eq(ClientCompany::getName, n));
        if (exist != null) {
            return ClientView.of(exist);
        }
        ClientCompany c = new ClientCompany();
        c.setClientId(ids.global("K", 1001));
        c.setName(n);
        c.setUnifiedCreditCode(creditCode == null || creditCode.isBlank() ? null : creditCode.trim().toUpperCase());
        c.setCity(city == null || city.isBlank() ? null : city.trim());
        c.setCreatedAt(LocalDateTime.now(clock));
        try {
            clients.insert(c);
        } catch (DuplicateKeyException e) {
            // 并发新建同名甲方
            return ClientView.of(clients.selectOne(new LambdaQueryWrapper<ClientCompany>().eq(ClientCompany::getName, n)));
        }
        return ClientView.of(c);
    }

    public ClientCompany findClient(String clientId) {
        return clients.selectById(clientId);
    }

    public Map<String, String> clientNames(Collection<String> clientIds) {
        if (clientIds == null || clientIds.isEmpty()) {
            return new HashMap<>();
        }
        Map<String, String> m = new HashMap<>();
        clients.selectBatchIds(clientIds).forEach(c -> m.put(c.getClientId(), c.getName()));
        return m;
    }

    // ------------------------------------------------------------------ 合作合同（租户）

    public List<ContractView> listContracts(String clientId) {
        List<ClientContract> list = contracts.selectList(new LambdaQueryWrapper<ClientContract>()
                .eq(clientId != null && !clientId.isBlank(), ClientContract::getClientId, clientId)
                .orderByDesc(ClientContract::getCreatedAt));
        return views(list, Map.of());
    }

    @Transactional
    public ContractView submitContract(String companyId, ContractCommand cmd) {
        BizException.check(cmd.clientId() != null && clients.selectById(cmd.clientId()) != null, ErrorCode.SYS_NOT_FOUND, "甲方企业不存在");
        BizException.check(cmd.fileKey() != null && !cmd.fileKey().isBlank(), ErrorCode.SYS_BAD_REQUEST, "请上传合作合同");
        BizException.check(cmd.validFrom() != null && cmd.validTo() != null && !cmd.validTo().isBefore(cmd.validFrom()),
                ErrorCode.SYS_BAD_REQUEST, "合同有效期不正确");
        BizException.check(!cmd.validTo().isBefore(LocalDate.now(clock)), ErrorCode.SYS_BAD_REQUEST, "合同已过期");
        ClientContract c = new ClientContract();
        c.setContractId(ids.dated("HT", 3));
        c.setCompanyId(companyId);
        c.setClientId(cmd.clientId());
        c.setFileKey(cmd.fileKey());
        c.setValidFrom(cmd.validFrom());
        c.setValidTo(cmd.validTo());
        c.setAuditStatus(ClientContractStatus.PENDING);
        c.setCreatedAt(LocalDateTime.now(clock));
        contracts.insert(c);
        audit.log("CLIENT_CONTRACT_SUBMIT", "CLIENT_CONTRACT", c.getContractId(), Map.of("clientId", c.getClientId()));
        outbox.publish("CLIENT_CONTRACT_SUBMITTED", "CLIENT_CONTRACT", c.getContractId(), Map.of("companyId", companyId));
        return views(List.of(c), Map.of()).get(0);
    }

    /** 本公司与该甲方是否有覆盖指定日期、且审核通过的合同。 */
    public boolean hasEffectiveContract(String companyId, String clientId, LocalDate date) {
        // 条件里显式带 company_id：TENANT 模式（自动再追加一次本公司条件）与 OPS 模式（审核岗位时）结果一致
        return contracts.selectCount(new LambdaQueryWrapper<ClientContract>()
                .eq(ClientContract::getCompanyId, companyId)
                .eq(ClientContract::getClientId, clientId)
                .eq(ClientContract::getAuditStatus, ClientContractStatus.APPROVED)
                .le(ClientContract::getValidFrom, date)
                .ge(ClientContract::getValidTo, date)) > 0;
    }

    // ------------------------------------------------------------------ 合同审核（平台中台）

    public PageResult<ContractView> listForOps(ClientContractStatus status, String companyId, Integer page, Integer pageSize) {
        Page<ClientContract> p = contracts.selectPage(Pages.of(page, pageSize), new LambdaQueryWrapper<ClientContract>()
                .eq(status != null, ClientContract::getAuditStatus, status)
                .eq(companyId != null && !companyId.isBlank(), ClientContract::getCompanyId, companyId)
                .orderByAsc(status == ClientContractStatus.PENDING, ClientContract::getCreatedAt)
                .orderByDesc(status != ClientContractStatus.PENDING, ClientContract::getCreatedAt));
        List<ContractView> v = views(p.getRecords(), null);
        return new PageResult<>(v, p.getTotal(), p.getCurrent(), p.getSize());
    }

    @Transactional
    public ContractView audit(String contractId, boolean approve, String remark, String operatorId) {
        ClientContract c = contracts.selectById(contractId);
        BizException.check(c != null, ErrorCode.SYS_NOT_FOUND);
        BizException.check(c.getAuditStatus() == ClientContractStatus.PENDING, ErrorCode.TEN_ILLEGAL_STATUS);
        BizException.check(approve || (remark != null && !remark.isBlank()), ErrorCode.SYS_BAD_REQUEST, "请填写驳回原因");
        c.setAuditStatus(approve ? ClientContractStatus.APPROVED : ClientContractStatus.REJECTED);
        c.setAuditRemark(remark == null ? null : remark.trim());
        c.setAuditedBy(operatorId);
        c.setAuditedAt(LocalDateTime.now(clock));
        contracts.updateById(c);
        audit.logForCompany(c.getCompanyId(), approve ? "CLIENT_CONTRACT_APPROVE" : "CLIENT_CONTRACT_REJECT",
                "CLIENT_CONTRACT", contractId, remark == null ? null : Map.of("remark", remark));
        return views(List.of(c), null).get(0);
    }

    public ClientContract findContract(String contractId) {
        return contracts.selectById(contractId);
    }

    /** @param companyNames null 表示需要查询公司名（平台中台）；租户端传空 Map 即可 */
    private List<ContractView> views(List<ClientContract> list, Map<String, String> companyNames) {
        Map<String, String> clientNames = clientNames(list.stream().map(ClientContract::getClientId).distinct().toList());
        Map<String, String> cn = companyNames;
        if (cn == null) {
            cn = companyNameLookup(list.stream().map(ClientContract::getCompanyId).distinct().toList());
        }
        LocalDate today = LocalDate.now(clock);
        Map<String, String> finalCn = cn;
        return list.stream().map(c -> new ContractView(c.getContractId(), c.getCompanyId(), finalCn.get(c.getCompanyId()),
                c.getClientId(), clientNames.get(c.getClientId()), c.getFileKey(), c.getValidFrom(), c.getValidTo(),
                c.getAuditStatus(), c.getAuditRemark(), c.getAuditedAt(), c.getCreatedAt(), c.coversDate(today))).toList();
    }

    private Map<String, String> companyNameLookup(List<String> companyIds) {
        if (companyIds.isEmpty()) {
            return new HashMap<>();
        }
        Map<String, String> m = new HashMap<>();
        TenantContext.runAsSystem(() -> companies.selectBatchIds(companyIds))
                .forEach(c -> m.put(c.getCompanyId(), c.getName()));
        return m;
    }
}
