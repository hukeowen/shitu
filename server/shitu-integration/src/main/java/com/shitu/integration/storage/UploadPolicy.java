package com.shitu.integration.storage;

import java.util.Arrays;
import java.util.Optional;

/**
 * 上传白名单：按文件头魔数判断真实类型（不信任扩展名和 Content-Type），只允许 JPG / PNG / PDF，最大 10MB。
 */
public final class UploadPolicy {

    public static final long MAX_BYTES = 10L * 1024 * 1024;

    private UploadPolicy() {
    }

    /** @return 识别出的扩展名（jpg / png / pdf）；不在白名单返回空 */
    public static Optional<String> detect(byte[] head) {
        if (head == null || head.length < 4) {
            return Optional.empty();
        }
        if ((head[0] & 0xFF) == 0xFF && (head[1] & 0xFF) == 0xD8 && (head[2] & 0xFF) == 0xFF) {
            return Optional.of("jpg");
        }
        if (head.length >= 8 && Arrays.equals(Arrays.copyOf(head, 8),
                new byte[]{(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A})) {
            return Optional.of("png");
        }
        if (head[0] == '%' && head[1] == 'P' && head[2] == 'D' && head[3] == 'F') {
            return Optional.of("pdf");
        }
        return Optional.empty();
    }
}
