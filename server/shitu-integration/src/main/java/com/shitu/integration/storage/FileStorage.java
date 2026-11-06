package com.shitu.integration.storage;

import java.io.InputStream;
import java.util.Optional;

/**
 * 私有文件存储（营业执照、许可证、合作合同、证件照）。生产为阿里云 OSS 私有桶，开发为本地目录。
 * <p>业务表只存 key，不存 URL；前端查看时由后端按权限读取或签发短期 URL。
 */
public interface FileStorage {

    /**
     * @param category 业务分类目录，如 license / contract
     * @param ext      扩展名（不含点），已由调用方校验白名单
     * @return 文件 key，如 license/2026/11/3f2a….jpg
     */
    String put(String category, String ext, InputStream content, long size, String contentType);

    Optional<StoredFile> get(String key);

    void delete(String key);

    record StoredFile(String key, String contentType, long size, InputStream content) {
    }
}
