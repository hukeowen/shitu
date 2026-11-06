package com.shitu.lifecycle.domain;

import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.Period;
import java.util.Optional;

/**
 * 居民身份证号（18 位，GB 11643）校验与实名合规规则（C-404 / C-406，D-15）。
 * <ul>
 *   <li>两次输入必须一致（防手误）；</li>
 *   <li>校验码、出生日期合法；</li>
 *   <li>未满 {@code minAgeRegister}（默认 16）周岁硬阻断；未满 {@code minAgeApply}（默认 18）周岁不能报名。</li>
 * </ul>
 * 出生日期以 OCR 结果为准（D-15），这里从号码解析只用于与 OCR 交叉校验和兜底。
 */
public final class IdCards {

    private static final int[] WEIGHTS = {7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2};
    private static final char[] CHECK = {'1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'};

    public enum AgeVerdict { UNDERAGE_BLOCKED, CANNOT_APPLY, OK }

    private IdCards() {
    }

    /** 去空格、末位 x 转大写。 */
    public static String normalize(String raw) {
        return raw == null ? null : raw.replaceAll("\\s", "").toUpperCase();
    }

    public static boolean sameInput(String first, String second) {
        String a = normalize(first);
        return a != null && a.equals(normalize(second));
    }

    public static boolean isValid(String raw) {
        String id = normalize(raw);
        if (id == null || !id.matches("^[1-9]\\d{16}[0-9X]$")) {
            return false;
        }
        int sum = 0;
        for (int i = 0; i < 17; i++) {
            sum += (id.charAt(i) - '0') * WEIGHTS[i];
        }
        return CHECK[sum % 11] == id.charAt(17) && birthDate(id).isPresent();
    }

    public static Optional<LocalDate> birthDate(String raw) {
        String id = normalize(raw);
        if (id == null || id.length() != 18) {
            return Optional.empty();
        }
        try {
            LocalDate d = LocalDate.of(Integer.parseInt(id.substring(6, 10)), Integer.parseInt(id.substring(10, 12)),
                    Integer.parseInt(id.substring(12, 14)));
            return d.getYear() < 1900 ? Optional.empty() : Optional.of(d);
        } catch (DateTimeException | NumberFormatException e) {
            return Optional.empty();
        }
    }

    /** 性别：第 17 位奇数为男（M），偶数为女（F）。 */
    public static Optional<String> gender(String raw) {
        String id = normalize(raw);
        if (id == null || id.length() != 18) {
            return Optional.empty();
        }
        return Optional.of((id.charAt(16) - '0') % 2 == 1 ? "M" : "F");
    }

    /** 周岁（生日当天满一岁）。 */
    public static int age(LocalDate birth, LocalDate today) {
        return Period.between(birth, today).getYears();
    }

    public static AgeVerdict ageVerdict(LocalDate birth, LocalDate today, int minAgeRegister, int minAgeApply) {
        int age = age(birth, today);
        if (age < minAgeRegister) {
            return AgeVerdict.UNDERAGE_BLOCKED;
        }
        if (age < minAgeApply) {
            return AgeVerdict.CANNOT_APPLY;
        }
        return AgeVerdict.OK;
    }
}
