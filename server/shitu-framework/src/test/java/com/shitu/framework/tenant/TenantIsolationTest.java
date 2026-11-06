package com.shitu.framework.tenant;

import com.baomidou.mybatisplus.extension.plugins.inner.TenantLineInnerInterceptor;
import com.shitu.common.exception.BizException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TenantIsolationTest {

    final TenantLineInnerInterceptor interceptor = new TenantLineInnerInterceptor(new ShituTenantLineHandler());

    @AfterEach
    void clear() {
        TenantContext.clear();
    }

    /** 直接调用插件的 SQL 改写，与运行时走的是同一段逻辑。 */
    String rewrite(String sql) throws Exception {
        return interceptor.parserSingle(sql, null);
    }

    @Test
    void 租户请求_租户表自动追加company_id() throws Exception {
        TenantContext.setTenant("C10023");
        assertThat(rewrite("SELECT * FROM application WHERE status = 'PENDING_INTERVIEW'"))
                .contains("company_id = 'C10023'");
    }

    @Test
    void 租户请求_更新和删除也会被限定() throws Exception {
        TenantContext.setTenant("C10023");
        assertThat(rewrite("UPDATE job SET quota_remaining = quota_remaining - 1 WHERE job_id = 'J1' AND quota_remaining > 0"))
                .contains("company_id = 'C10023'");
        assertThat(rewrite("DELETE FROM kb_entry WHERE id = 1")).contains("company_id = 'C10023'");
    }

    @Test
    void 租户请求_关联查询两张租户表都被限定() throws Exception {
        TenantContext.setTenant("C10023");
        String sql = rewrite("SELECT a.* FROM application a JOIN job j ON a.job_id = j.job_id");
        assertThat(sql).contains("a.company_id = 'C10023'").contains("j.company_id = 'C10023'");
    }

    @Test
    void 租户请求_共享表不追加条件() throws Exception {
        TenantContext.setTenant("C10023");
        assertThat(rewrite("SELECT * FROM `user` WHERE user_id = 'U1'")).doesNotContain("company_id");
    }

    @Test
    void 租户请求_平台专属表被拒绝_看不到岗位真实权重() {
        TenantContext.setTenant("C10023");
        assertThatThrownBy(() -> rewrite("SELECT * FROM job_weight_daily")).isInstanceOf(BizException.class);
        assertThatThrownBy(() -> rewrite("SELECT * FROM credit_score_log")).isInstanceOf(BizException.class);
    }

    @Test
    void 租户请求_未登记的表被拒绝() {
        TenantContext.setTenant("C10023");
        assertThatThrownBy(() -> rewrite("SELECT * FROM some_new_table")).isInstanceOf(BizException.class);
    }

    @Test
    void 未设置上下文_一律拒绝() {
        assertThatThrownBy(() -> rewrite("SELECT * FROM job")).isInstanceOf(BizException.class);
    }

    @Test
    void C端和系统任务_跨租户不追加条件() throws Exception {
        TenantContext.set(TenantContext.Mode.SEEKER);
        assertThat(rewrite("SELECT * FROM job WHERE job_status = 'RECRUITING'")).doesNotContain("company_id");
        assertThat(TenantContext.runAsSystem(() -> {
            try {
                return rewrite("SELECT * FROM billing_daily");
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        })).doesNotContain("company_id");
        assertThat(TenantContext.mode()).isEqualTo(TenantContext.Mode.SEEKER);
    }

    @Test
    void 三类表互不重叠() {
        assertThat(TenantTables.TENANT).doesNotContainAnyElementsOf(TenantTables.SHARED)
                .doesNotContainAnyElementsOf(TenantTables.PLATFORM_ONLY);
        assertThat(TenantTables.SHARED).doesNotContainAnyElementsOf(TenantTables.PLATFORM_ONLY);
    }
}
