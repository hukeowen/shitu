package com.shitu.framework.mask;

import com.shitu.common.enums.ActorRole;

import java.util.EnumSet;
import java.util.Set;

/** 当前请求的查看者角色（一个人可以有多个角色）。由鉴权过滤器设置、请求结束时清除。 */
public final class ViewerContext {
    private static final ThreadLocal<Set<ActorRole>> ROLES = ThreadLocal.withInitial(() -> EnumSet.noneOf(ActorRole.class));

    private ViewerContext() {
    }

    public static void set(Set<ActorRole> roles) {
        ROLES.set(roles.isEmpty() ? EnumSet.noneOf(ActorRole.class) : EnumSet.copyOf(roles));
    }

    public static Set<ActorRole> roles() {
        return ROLES.get();
    }

    public static void clear() {
        ROLES.remove();
    }
}
