package com.shitu.framework.tenant;

import java.util.function.Supplier;

/**
 * 当前请求的租户上下文。
 * <ul>
 *   <li>{@link Mode#TENANT}：公司后台 / 驻场端请求（/api/v1/tenant/**），必须带 companyId，SQL 自动追加 company_id 条件；</li>
 *   <li>{@link Mode#SEEKER}：C 端请求，跨租户（匹配全平台岗位），由业务层按「关系」做数据范围校验；</li>
 *   <li>{@link Mode#OPS}：平台中台，跨租户；</li>
 *   <li>{@link Mode#SYSTEM}：定时任务 / 事件投递，跨租户。</li>
 * </ul>
 * 由各账号域的鉴权过滤器在请求开始时设置、结束时清除；定时任务用 {@link #runAsSystem}。
 */
public final class TenantContext {

    public enum Mode { TENANT, SEEKER, OPS, SYSTEM }

    private record State(Mode mode, String companyId) {
    }

    private static final ThreadLocal<State> HOLDER = new ThreadLocal<>();

    private TenantContext() {
    }

    public static void setTenant(String companyId) {
        if (companyId == null || companyId.isBlank()) {
            throw new IllegalArgumentException("tenant companyId required");
        }
        HOLDER.set(new State(Mode.TENANT, companyId));
    }

    public static void set(Mode mode) {
        if (mode == Mode.TENANT) {
            throw new IllegalArgumentException("use setTenant(companyId)");
        }
        HOLDER.set(new State(mode, null));
    }

    /** 未设置时返回 null —— 由拦截器按 fail-closed 处理。 */
    public static Mode mode() {
        State s = HOLDER.get();
        return s == null ? null : s.mode();
    }

    public static String companyId() {
        State s = HOLDER.get();
        return s == null ? null : s.companyId();
    }

    public static void clear() {
        HOLDER.remove();
    }

    public static <T> T runAs(Mode mode, String companyId, Supplier<T> action) {
        State prev = HOLDER.get();
        try {
            if (mode == Mode.TENANT) {
                setTenant(companyId);
            } else {
                set(mode);
            }
            return action.get();
        } finally {
            if (prev == null) {
                HOLDER.remove();
            } else {
                HOLDER.set(prev);
            }
        }
    }

    public static <T> T runAsSystem(Supplier<T> action) {
        return runAs(Mode.SYSTEM, null, action);
    }
}
