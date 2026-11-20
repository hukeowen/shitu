package com.shitu.app.kb;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/** 知识库命中除了全文索引分数，还要求问题和问答有共同的汉字双字词：只靠数字、字母对上的不算。 */
class KnowledgeMatchTest {

    static final String DORM = "宿舍是几人间？有没有空调和热水？ 4 到 6 人间，有空调、独立卫生间和 24 小时热水，水电费公司承担。";

    @Test
    void digitsAndLettersAloneDoNotCount() {
        assertThat(KnowledgeService.sharesHanBigram("验收提问824018乌龟鹦鹉仓鼠蜥蜴", DORM)).as("只有「24」对上").isFalse();
        assertThat(KnowledgeService.sharesHanBigram("WiFi 24h ok?", DORM)).isFalse();
        assertThat(KnowledgeService.sharesHanBigram("", DORM)).isFalse();
    }

    @Test
    void realQuestionsStillMatch() {
        assertThat(KnowledgeService.sharesHanBigram("宿舍几个人一间", DORM)).isTrue();
        assertThat(KnowledgeService.sharesHanBigram("有空调吗", DORM)).isTrue();
        assertThat(KnowledgeService.sharesHanBigram("24 小时有热水吗", DORM)).isTrue();
    }
}
