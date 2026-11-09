package com.shitu.it;

import com.shitu.billing.service.DailyBillingService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;

import java.sql.Date;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 性能基线（不进 CI，SHITU_PERF=true 时运行）：每日计费在 2 万在岗、20% 流转的规模下的耗时。
 * 目标：&lt; 60 秒（任务锁 30 分钟，00:30 开始，留足重跑余量）。数据跑完即删除。
 */
@EnabledIfEnvironmentVariable(named = "SHITU_PERF", matches = "true")
@SpringBootTest(properties = {
        FlowItSupport.IT_DB,
        "shitu.sms.expose-code-in-mock=true",
        "shitu.sms.captcha-after-per-ip=100000",
        "shitu.sms.ip-hourly-limit=100000",
        "shitu.ops.init-password=ItSuper2026",
        "shitu.scheduling.enabled=false",
        "shitu.storage.local-dir=./target/it-uploads"
})
@AutoConfigureMockMvc
class BillingPerfIT extends FlowItSupport {

    static final int COMPANIES = 5;
    static final int PER_COMPANY = 4000;

    @Autowired
    DailyBillingService daily;

    @Test
    void dailyBillingAt20kEmployees() throws Exception {
        List<Company> cs = new ArrayList<>();
        for (int i = 0; i < COMPANIES; i++) {
            cs.add(company());
        }
        String tag = "PF" + Long.toString(System.nanoTime(), 36).toUpperCase();
        LocalDate start = LocalDate.now().minusDays(60);
        List<Object[]> rows = new ArrayList<>();
        for (int ci = 0; ci < COMPANIES; ci++) {
            Company c = cs.get(ci);
            for (int k = 0; k < PER_COMPANY; k++) {
                boolean transfer = k % 5 == 0;
                String source = transfer ? cs.get((ci + 1) % COMPANIES).companyId() : c.companyId();
                String id = tag + ci + "_" + k;
                rows.add(new Object[]{id, "U" + id, c.companyId(), c.projectId(), Date.valueOf(start.plusDays(k % 50)), source,
                        transfer, "PLATFORM_ONBOARD"});
            }
        }
        long t0 = System.nanoTime();
        jdbc.batchUpdate("INSERT INTO employment (employment_id, user_id, company_id, project_id, start_date, source_company_id_snapshot, "
                + "is_transfer, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", rows);
        long insertMs = (System.nanoTime() - t0) / 1_000_000;
        try {
            LocalDate day = LocalDate.now().minusDays(1);
            long t1 = System.nanoTime();
            var r = daily.run(day);
            long runMs = (System.nanoTime() - t1) / 1_000_000;
            long t2 = System.nanoTime();
            daily.run(day);   // 重跑（幂等覆盖）
            long rerunMs = (System.nanoTime() - t2) / 1_000_000;
            System.out.printf("PERF daily billing: %d employments (insert %d ms), run %d ms, rerun %d ms, companies=%d, transferLines=%d%n",
                    rows.size(), insertMs, runMs, rerunMs, r.companies(), r.transferLines());
            assertThat(r.transferLines()).isGreaterThanOrEqualTo(COMPANIES * PER_COMPANY / 5);
            assertThat(runMs).as("每日计费耗时").isLessThan(60_000);
            assertThat(rerunMs).as("重跑耗时").isLessThan(60_000);
        } finally {
            for (Company c : cs) {
                jdbc.update("DELETE FROM billing_daily WHERE company_id = ? OR supply_company_id = ?", c.companyId(), c.companyId());
                jdbc.update("DELETE FROM company_fee_daily WHERE company_id = ?", c.companyId());
            }
            jdbc.update("DELETE FROM employment WHERE employment_id LIKE ?", tag + "%");
        }
    }
}
