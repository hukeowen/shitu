package com.shitu.notify;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class TemplateRendererTest {

    @Test
    void 替换变量_缺失变量置空_值里的特殊字符原样保留() {
        String t = "你报名的「${jobTitle}」面试时间 ${interviewAt}，地点 ${address}。请带好：${documents}。";
        assertThat(TemplateRenderer.render(t, Map.of("jobTitle", "SMT 操作工", "interviewAt", "11-08 09:00",
                "address", "昆山 $1 号门\\东")))
                .isEqualTo("你报名的「SMT 操作工」面试时间 11-08 09:00，地点 昆山 $1 号门\\东。请带好：。");
        assertThat(TemplateRenderer.render(null, Map.of())).isEmpty();
        assertThat(TemplateRenderer.render("无变量", null)).isEqualTo("无变量");
    }
}
