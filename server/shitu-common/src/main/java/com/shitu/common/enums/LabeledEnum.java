package com.shitu.common.enums;

/**
 * 所有业务枚举实现此接口：英文常量落库，中文 label 仅用于展示（spec §02）。
 * 字典接口 /api/v1/dict 通过它统一输出给前端。
 */
public interface LabeledEnum {
    String name();

    String label();
}
