package com.shitu.app.notify;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

class NotificationRoutesTest {

    /** 路由里写了 case 却没登记到 EVENTS 的事件会被悄悄丢掉（面试结果通知就这样漏过一次）。 */
    @Test
    void everyRoutedEventIsRegistered() throws Exception {
        NotificationRoutes routes = new NotificationRoutes(null, null, null, null, null);
        String src = Files.readString(Path.of("src/main/java/com/shitu/app/notify/NotificationRoutes.java"));
        Matcher m = Pattern.compile("case \"([A-Z_]+)\"").matcher(src);
        int n = 0;
        while (m.find()) {
            n++;
            assertThat(routes.supports(m.group(1))).as("事件 %s 未登记到 EVENTS", m.group(1)).isTrue();
        }
        assertThat(n).isGreaterThan(20);
    }
}
