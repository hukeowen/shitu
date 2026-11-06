package com.shitu.notify;

import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 模板变量替换：{@code ${name}} → 值；缺失的变量替换为空串（不把占位符原样发给用户）。 */
public final class TemplateRenderer {

    private static final Pattern VAR = Pattern.compile("\\$\\{([A-Za-z0-9_]+)}");

    private TemplateRenderer() {
    }

    public static String render(String template, Map<String, ?> vars) {
        if (template == null) {
            return "";
        }
        Matcher m = VAR.matcher(template);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            Object v = vars == null ? null : vars.get(m.group(1));
            m.appendReplacement(sb, Matcher.quoteReplacement(v == null ? "" : String.valueOf(v)));
        }
        m.appendTail(sb);
        return sb.toString();
    }
}
