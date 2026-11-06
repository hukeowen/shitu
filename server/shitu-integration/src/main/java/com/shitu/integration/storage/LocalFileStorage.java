package com.shitu.integration.storage;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

/** 本地目录实现（开发环境）。key 严格校验格式，防止路径穿越。 */
public class LocalFileStorage implements FileStorage {

    private static final Pattern KEY = Pattern.compile("^[a-z]{2,16}/\\d{4}/\\d{2}/[0-9a-f]{32}\\.[a-z0-9]{2,5}$");

    private final Path root;

    public LocalFileStorage(Path root) {
        this.root = root.toAbsolutePath().normalize();
        try {
            Files.createDirectories(this.root);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Override
    public String put(String category, String ext, InputStream content, long size, String contentType) {
        LocalDate d = LocalDate.now();
        String key = String.format("%s/%04d/%02d/%s.%s", category, d.getYear(), d.getMonthValue(),
                UUID.randomUUID().toString().replace("-", ""), ext);
        Path target = resolve(key);
        try {
            Files.createDirectories(target.getParent());
            Files.copy(content, target, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return key;
    }

    @Override
    public Optional<StoredFile> get(String key) {
        if (key == null || !KEY.matcher(key).matches()) {
            return Optional.empty();
        }
        Path p = resolve(key);
        if (!Files.isRegularFile(p)) {
            return Optional.empty();
        }
        try {
            return Optional.of(new StoredFile(key, contentTypeOf(key), Files.size(p), Files.newInputStream(p)));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Override
    public void delete(String key) {
        if (key == null || !KEY.matcher(key).matches()) {
            return;
        }
        try {
            Files.deleteIfExists(resolve(key));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private Path resolve(String key) {
        Path p = root.resolve(key).normalize();
        if (!p.startsWith(root)) {
            throw new IllegalArgumentException("illegal key");
        }
        return p;
    }

    static String contentTypeOf(String key) {
        String ext = key.substring(key.lastIndexOf('.') + 1);
        return switch (ext) {
            case "jpg", "jpeg" -> "image/jpeg";
            case "png" -> "image/png";
            case "pdf" -> "application/pdf";
            case "webp" -> "image/webp";
            default -> "application/octet-stream";
        };
    }
}
