package com.shitu.platform.admin;

import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;

import java.security.SecureRandom;

/** 平台账号密码规则：至少 8 位，同时包含字母和数字，最长 64 位。 */
public final class Passwords {

    private static final char[] ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789".toCharArray();
    private static final SecureRandom RANDOM = new SecureRandom();

    private Passwords() {
    }

    public static void checkStrength(String pwd) {
        boolean ok = pwd != null && pwd.length() >= 8 && pwd.length() <= 64
                && pwd.chars().anyMatch(Character::isLetter)
                && pwd.chars().anyMatch(Character::isDigit);
        BizException.check(ok, ErrorCode.AUTH_PASSWORD_WEAK);
    }

    /** 随机初始密码（一定同时含字母和数字）。 */
    public static String random(int len) {
        while (true) {
            char[] c = new char[len];
            for (int i = 0; i < len; i++) {
                c[i] = ALPHABET[RANDOM.nextInt(ALPHABET.length)];
            }
            String s = new String(c);
            if (s.chars().anyMatch(Character::isLetter) && s.chars().anyMatch(Character::isDigit)) {
                return s;
            }
        }
    }
}
