package com.shitu.framework.mask;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.shitu.common.enums.ActorRole;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class MaskSerializerTest {

    record SeekerView(@Mask(type = MaskType.PHONE, visibleTo = ActorRole.SITE) String phone,
                      @Mask(type = MaskType.ID_CARD) String idCard,
                      @Mask(type = MaskType.NAME, visibleTo = {ActorRole.SITE, ActorRole.BROKER}) String name) {
    }

    final ObjectMapper om = new ObjectMapper();
    final SeekerView v = new SeekerView("13822012201", "320583199508124517", "张浩");

    @AfterEach
    void clear() {
        ViewerContext.clear();
    }

    @Test
    void 驻场看完整手机号_证件始终脱敏() throws Exception {
        ViewerContext.set(Set.of(ActorRole.SITE));
        assertThat(om.writeValueAsString(v))
                .contains("\"phone\":\"13822012201\"")
                .contains("\"idCard\":\"3205**********4517\"")
                .contains("\"name\":\"张浩\"");
    }

    @Test
    void 项目经理_手机号姓名都脱敏() throws Exception {
        ViewerContext.set(Set.of(ActorRole.PM));
        assertThat(om.writeValueAsString(v))
                .contains("\"phone\":\"138****2201\"")
                .contains("\"name\":\"张*\"");
    }

    @Test
    void 多角色_任一角色可见即明文() throws Exception {
        ViewerContext.set(Set.of(ActorRole.PM, ActorRole.SITE));
        assertThat(om.writeValueAsString(v)).contains("\"phone\":\"13822012201\"");
    }

    @Test
    void 未登录_全部脱敏() throws Exception {
        assertThat(om.writeValueAsString(v)).contains("138****2201").contains("张*");
    }
}
