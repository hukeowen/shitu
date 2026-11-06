package com.shitu.framework.crypto;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Objects;

/**
 * 敏感字段加密（02-架构 §12）：
 * <ul>
 *   <li>{@link #encrypt}/{@link #decrypt}：AES-256-GCM，随机 12 字节 IV，密文格式 {@code v1:base64(iv|ciphertext|tag)}；</li>
 *   <li>{@link #blindIndex}：HMAC-SHA256 盲索引，用于手机号 / 身份证的唯一约束与等值查询（一证一号）。</li>
 * </ul>
 * 两把密钥相互独立，生产环境由 KMS 下发，不写进配置文件。
 */
public final class FieldCipher {
    private static final String PREFIX = "v1:";
    private static final int IV_LEN = 12;
    private static final int TAG_BITS = 128;

    private final SecretKeySpec encKey;
    private final SecretKeySpec macKey;
    private final SecureRandom random = new SecureRandom();

    /** @param encKey32 / macKey32 各 32 字节 */
    public FieldCipher(byte[] encKey32, byte[] macKey32) {
        if (encKey32 == null || encKey32.length != 32 || macKey32 == null || macKey32.length != 32) {
            throw new IllegalArgumentException("keys must be 32 bytes");
        }
        this.encKey = new SecretKeySpec(encKey32, "AES");
        this.macKey = new SecretKeySpec(macKey32, "HmacSHA256");
    }

    public static FieldCipher fromBase64(String encKeyB64, String macKeyB64) {
        return new FieldCipher(Base64.getDecoder().decode(encKeyB64), Base64.getDecoder().decode(macKeyB64));
    }

    public String encrypt(String plain) {
        if (plain == null) {
            return null;
        }
        try {
            byte[] iv = new byte[IV_LEN];
            random.nextBytes(iv);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, encKey, new GCMParameterSpec(TAG_BITS, iv));
            byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            return PREFIX + Base64.getEncoder().encodeToString(ByteBuffer.allocate(IV_LEN + ct.length).put(iv).put(ct).array());
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("encrypt failed", e);
        }
    }

    public String decrypt(String stored) {
        if (stored == null) {
            return null;
        }
        if (!stored.startsWith(PREFIX)) {
            throw new IllegalArgumentException("unknown cipher version");
        }
        try {
            byte[] all = Base64.getDecoder().decode(stored.substring(PREFIX.length()));
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, encKey, new GCMParameterSpec(TAG_BITS, all, 0, IV_LEN));
            return new String(c.doFinal(all, IV_LEN, all.length - IV_LEN), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("decrypt failed", e);
        }
    }

    /** 盲索引：先做规范化（去空格、身份证 x 大写），保证同一值得到同一索引。 */
    public String blindIndex(String plain) {
        Objects.requireNonNull(plain, "plain");
        String normalized = plain.replaceAll("\\s+", "").toUpperCase();
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(macKey);
            return HexFormat.of().formatHex(mac.doFinal(normalized.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("hmac failed", e);
        }
    }
}
