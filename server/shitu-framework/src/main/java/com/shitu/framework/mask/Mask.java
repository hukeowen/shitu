package com.shitu.framework.mask;

import com.fasterxml.jackson.annotation.JacksonAnnotationsInside;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.shitu.common.enums.ActorRole;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 按当前角色脱敏（R-13）。例：{@code @Mask(type = PHONE, visibleTo = SITE)} → 驻场看完整手机号，其他角色看脱敏值。
 * 角色取自 {@link ViewerContext}，由鉴权过滤器写入。
 */
@Target({ElementType.FIELD, ElementType.RECORD_COMPONENT, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@JacksonAnnotationsInside
@JsonSerialize(using = MaskSerializer.class)
public @interface Mask {
    MaskType type();

    /** 可以看到明文的角色；默认谁都看不到明文。 */
    ActorRole[] visibleTo() default {};
}
