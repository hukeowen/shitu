package com.shitu.integration.storage;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayInputStream;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

class StoragePolicyTest {

    @Test
    void 按文件头识别类型_不信任扩展名() {
        assertThat(UploadPolicy.detect(new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, 0x00})).contains("jpg");
        assertThat(UploadPolicy.detect(new byte[]{(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0})).contains("png");
        assertThat(UploadPolicy.detect("%PDF-1.7".getBytes())).contains("pdf");
        assertThat(UploadPolicy.detect("<script>alert(1)</script>".getBytes())).isEmpty();
        assertThat(UploadPolicy.detect("MZ\u0090\u0000".getBytes())).isEmpty();
        assertThat(UploadPolicy.detect(new byte[2])).isEmpty();
    }

    @Test
    void 本地存储读写_非法key不能穿越目录(@TempDir Path dir) {
        LocalFileStorage s = new LocalFileStorage(dir);
        String key = s.put("license", "png", new ByteArrayInputStream(new byte[]{1, 2, 3}), 3, "image/png");
        assertThat(key).matches("license/\\d{4}/\\d{2}/[0-9a-f]{32}\\.png");
        assertThat(s.get(key)).isPresent();
        assertThat(s.get(key).get().size()).isEqualTo(3);
        assertThat(s.get("../../etc/passwd")).isEmpty();
        assertThat(s.get("license/2026/11/../../../x.png")).isEmpty();
        s.delete(key);
        assertThat(s.get(key)).isEmpty();
    }
}
