package com.shitu.app.ops;

import com.shitu.common.enums.AuthDomain;
import com.shitu.common.enums.CompanyStatus;
import com.shitu.identity.session.AuthSessionService;
import com.shitu.job.JobService;
import com.shitu.lifecycle.employment.ResignService;
import com.shitu.tenant.company.CompanyService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 公司注销 / 倒闭（P-02 / P-08）：一个事务内完成 —— 公司状态、成员停用、岗位强制下架、用户批量解绑（在岗结束任职，
 * 私域与报名中释放至公域）；事务提交后吊销成员会话。作为来源方的流转分成此后全归平台（R-11，计费按公司状态自动处理）。
 */
@Service
public class CompanyClosureFacade {

    public record Result(int unboundUsers, int offlineJobs, int disabledMembers) {
    }

    private final CompanyService companies;
    private final JobService jobs;
    private final ResignService resign;
    private final AuthSessionService sessions;

    public CompanyClosureFacade(CompanyService companies, JobService jobs, ResignService resign, AuthSessionService sessions) {
        this.companies = companies;
        this.jobs = jobs;
        this.resign = resign;
        this.sessions = sessions;
    }

    @Transactional
    public Result close(String companyId, CompanyStatus target, String remark, String operatorId) {
        List<String> memberIds = companies.close(companyId, target, remark, operatorId);
        int offline = jobs.forceOfflineAllOfCompany(companyId, "公司" + target.label() + "：" + remark, operatorId);
        int unbound = resign.unbindCompany(companyId, operatorId);
        memberIds.forEach(m -> sessions.revokeAll(AuthDomain.TENANT, m, "COMPANY_CLOSED"));
        return new Result(unbound, offline, memberIds.size());
    }
}
