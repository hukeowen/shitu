package com.shitu.framework.tenant;

import com.baomidou.mybatisplus.extension.plugins.handler.TenantLineHandler;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import net.sf.jsqlparser.expression.Expression;
import net.sf.jsqlparser.expression.StringValue;

/**
 * MyBatis-Plus 多租户行处理器（fail-closed）：
 * <ul>
 *   <li>未设置上下文：直接拒绝，防止漏设导致越权；</li>
 *   <li>SEEKER / OPS / SYSTEM：不追加租户条件；</li>
 *   <li>TENANT：租户表追加 {@code company_id = ?}；共享表放行（由业务层校验关系）；平台专属表和未登记的表拒绝。</li>
 * </ul>
 */
public class ShituTenantLineHandler implements TenantLineHandler {

    @Override
    public Expression getTenantId() {
        return new StringValue(TenantContext.companyId());
    }

    @Override
    public String getTenantIdColumn() {
        return TenantTables.TENANT_COLUMN;
    }

    /** 返回 true = 该表不追加租户条件。 */
    @Override
    public boolean ignoreTable(String tableName) {
        return decide(TenantContext.mode(), TenantTables.normalize(tableName));
    }

    static boolean decide(TenantContext.Mode mode, String table) {
        if (mode == null) {
            throw new BizException(ErrorCode.SYS_FORBIDDEN, "missing tenant context for table " + table);
        }
        if (mode != TenantContext.Mode.TENANT) {
            return true;
        }
        if (TenantTables.TENANT.contains(table)) {
            return false;
        }
        if (TenantTables.SHARED.contains(table)) {
            return true;
        }
        throw new BizException(ErrorCode.SYS_FORBIDDEN, "tenant request cannot access table " + table);
    }
}
