package com.shitu.notify;

import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;

/** P-16 短信免打扰时段：跨零点、不跨零点、边界、配置错误。 */
class QuietHoursTest {

    private static LocalDateTime at(String t) {
        return LocalDateTime.parse("2026-11-10T" + t);
    }

    @Test
    void overnightWindow() {
        assertThat(NotificationService.quietUntil(at("21:59:59"), "22:00", "08:00")).isNull();
        assertThat(NotificationService.quietUntil(at("22:00:00"), "22:00", "08:00")).isEqualTo(LocalDateTime.parse("2026-11-11T08:00:00"));
        assertThat(NotificationService.quietUntil(at("03:30:00"), "22:00", "08:00")).isEqualTo(at("08:00:00"));
        assertThat(NotificationService.quietUntil(at("08:00:00"), "22:00", "08:00")).isNull();
        assertThat(NotificationService.quietUntil(at("14:00:00"), "22:00", "08:00")).isNull();
    }

    @Test
    void sameDayWindowAndBadConfig() {
        assertThat(NotificationService.quietUntil(at("12:30:00"), "12:00", "14:00")).isEqualTo(at("14:00:00"));
        assertThat(NotificationService.quietUntil(at("14:00:00"), "12:00", "14:00")).isNull();
        assertThat(NotificationService.quietUntil(at("03:00:00"), "08:00", "08:00")).as("起止相同 = 不启用").isNull();
        assertThat(NotificationService.quietUntil(at("03:00:00"), "abc", "08:00")).as("配置错误不拦短信").isNull();
    }
}
