package com.shitu;

import com.shitu.framework.tenant.TenantTables;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 迁移脚本里的每一张表都必须在 {@link TenantTables} 中登记；
 * 租户表必须有 company_id 列。
 */
class SchemaTenantCoverageTest {

    static final Pattern CREATE = Pattern.compile("CREATE TABLE\\s+`?(\\w+)`?\\s*\\((.*?)\\)\\s*COMMENT",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL);

    @Test
    void 每张表都已分类_租户表都有company_id列() throws Exception {
        Set<String> tables = new TreeSet<>();
        Set<String> tenantMissingColumn = new TreeSet<>();
        for (Resource r : new PathMatchingResourcePatternResolver().getResources("classpath:db/migration/*.sql")) {
            String sql = r.getContentAsString(StandardCharsets.UTF_8);
            Matcher m = CREATE.matcher(sql);
            while (m.find()) {
                String table = m.group(1).toLowerCase();
                tables.add(table);
                if (TenantTables.TENANT.contains(table)
                        && !Pattern.compile("^\\s*company_id\\s", Pattern.MULTILINE).matcher(m.group(2)).find()) {
                    tenantMissingColumn.add(table);
                }
            }
        }
        Set<String> classified = new HashSet<>();
        classified.addAll(TenantTables.TENANT);
        classified.addAll(TenantTables.SHARED);
        classified.addAll(TenantTables.PLATFORM_ONLY);

        assertThat(tables).as("迁移脚本解析到的表").hasSizeGreaterThan(50);
        assertThat(classified).as("未在 TenantTables 登记的表").containsAll(tables);
        assertThat(tenantMissingColumn).as("租户表缺少 company_id 列").isEmpty();
    }
}
