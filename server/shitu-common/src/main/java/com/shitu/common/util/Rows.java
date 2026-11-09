package com.shitu.common.util;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * JDBC 聚合查询结果对外输出前统一转成驼峰键（project_id → projectId），与其余 DTO 保持一致。
 * 只用在直接返回给前端的行数据上；不要用在以业务编码为键的 Map 上。
 */
public final class Rows {

    private Rows() {
    }

    public static List<Map<String, Object>> camel(List<Map<String, Object>> rows) {
        return rows.stream().map(Rows::camel).toList();
    }

    public static Map<String, Object> camel(Map<String, Object> row) {
        Map<String, Object> out = new LinkedHashMap<>();
        row.forEach((k, v) -> out.put(camel(k), v));
        return out;
    }

    public static String camel(String key) {
        if (key.indexOf('_') < 0) {
            return key;
        }
        StringBuilder sb = new StringBuilder(key.length());
        boolean up = false;
        for (char ch : key.toCharArray()) {
            if (ch == '_') {
                up = sb.length() > 0;
            } else {
                sb.append(up ? Character.toUpperCase(ch) : Character.toLowerCase(ch));
                up = false;
            }
        }
        return sb.toString();
    }
}
