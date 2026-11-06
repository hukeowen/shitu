package com.shitu.identity.captcha;

import com.shitu.framework.kv.KvStore;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.AffineTransform;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.UUID;

/** 图形验证码：4 位字符，3 分钟有效，一次性（校验后无论对错都作废）。 */
@Service
public class CaptchaService {

    private static final char[] ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ".toCharArray();
    private static final Duration TTL = Duration.ofMinutes(3);
    private static final int W = 120;
    private static final int H = 40;

    public record Captcha(String captchaId, String imageBase64) {
    }

    private final KvStore kv;
    private final SecureRandom random = new SecureRandom();

    public CaptchaService(KvStore kv) {
        this.kv = kv;
        System.setProperty("java.awt.headless", "true");
    }

    public Captcha create() {
        char[] c = new char[4];
        for (int i = 0; i < c.length; i++) {
            c[i] = ALPHABET[random.nextInt(ALPHABET.length)];
        }
        String answer = new String(c);
        String id = UUID.randomUUID().toString().replace("-", "");
        kv.set("cap:" + id, answer, TTL);
        return new Captcha(id, "data:image/png;base64," + Base64.getEncoder().encodeToString(render(answer)));
    }

    public boolean verify(String captchaId, String input) {
        if (captchaId == null || input == null || !captchaId.matches("[0-9a-f]{32}")) {
            return false;
        }
        return kv.take("cap:" + captchaId).map(a -> a.equalsIgnoreCase(input.trim())).orElse(false);
    }

    private byte[] render(String text) {
        BufferedImage img = new BufferedImage(W, H, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setColor(new Color(245, 247, 250));
            g.fillRect(0, 0, W, H);
            for (int i = 0; i < 6; i++) {
                g.setColor(randomColor(150, 210));
                g.setStroke(new BasicStroke(1 + random.nextFloat()));
                g.drawLine(random.nextInt(W), random.nextInt(H), random.nextInt(W), random.nextInt(H));
            }
            g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 26));
            for (int i = 0; i < text.length(); i++) {
                AffineTransform old = g.getTransform();
                int x = 12 + i * 26;
                int y = 29 + random.nextInt(5) - 2;
                g.rotate(Math.toRadians(random.nextInt(31) - 15), x, y);
                g.setColor(randomColor(20, 110));
                g.drawString(String.valueOf(text.charAt(i)), x, y);
                g.setTransform(old);
            }
            for (int i = 0; i < 40; i++) {
                g.setColor(randomColor(100, 200));
                g.fillRect(random.nextInt(W), random.nextInt(H), 1, 1);
            }
        } finally {
            g.dispose();
        }
        try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            ImageIO.write(img, "png", out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private Color randomColor(int min, int max) {
        int span = max - min;
        return new Color(min + random.nextInt(span), min + random.nextInt(span), min + random.nextInt(span));
    }
}
