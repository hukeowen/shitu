package com.shitu.framework.crypto;

import org.junit.jupiter.api.Test;

import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FieldCipherTest {

    static byte[] key(int seed) {
        byte[] k = new byte[32];
        Arrays.fill(k, (byte) seed);
        return k;
    }

    final FieldCipher cipher = new FieldCipher(key(1), key(2));

    @Test
    void 加解密往返_且每次密文不同() {
        String id = "320583199508124517";
        String c1 = cipher.encrypt(id);
        String c2 = cipher.encrypt(id);
        assertThat(c1).startsWith("v1:").isNotEqualTo(c2);
        assertThat(cipher.decrypt(c1)).isEqualTo(id);
        assertThat(cipher.decrypt(c2)).isEqualTo(id);
    }

    @Test
    void 中文姓名() {
        assertThat(cipher.decrypt(cipher.encrypt("张浩"))).isEqualTo("张浩");
    }

    @Test
    void 篡改密文_解密失败() {
        String c = cipher.encrypt("13800138000");
        char last = c.charAt(c.length() - 2);
        String tampered = c.substring(0, c.length() - 2) + (last == 'A' ? 'B' : 'A') + c.charAt(c.length() - 1);
        assertThatThrownBy(() -> cipher.decrypt(tampered)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void 盲索引_确定性_且规范化身份证x大小写与空格() {
        assertThat(cipher.blindIndex("32058319950812451x"))
                .isEqualTo(cipher.blindIndex(" 32058319950812451X "))
                .hasSize(64);
        assertThat(cipher.blindIndex("13800138000")).isNotEqualTo(cipher.blindIndex("13800138001"));
    }

    @Test
    void 不同mac密钥_盲索引不同() {
        FieldCipher other = new FieldCipher(key(1), key(3));
        assertThat(other.blindIndex("13800138000")).isNotEqualTo(cipher.blindIndex("13800138000"));
    }
}
