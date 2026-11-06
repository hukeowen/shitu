package com.shitu.app.notify;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.shitu.common.enums.ActorRole;
import com.shitu.common.enums.MemberStatus;
import com.shitu.common.enums.ReleaseReason;
import com.shitu.common.util.Masks;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.lifecycle.mapper.SeekerUserMapper;
import com.shitu.lifecycle.seeker.SeekerUser;
import com.shitu.notify.NotificationService;
import com.shitu.notify.NotificationService.Recipient;
import com.shitu.notify.outbox.OutboxHandler;
import com.shitu.tenant.mapper.MemberMapper;
import com.shitu.tenant.mapper.MemberProjectMapper;
import com.shitu.tenant.member.Member;
import com.shitu.tenant.member.MemberProject;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.EnumSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 事件 → 通知（模板见 V1_0_7 种子数据）。收件人规则：
 * <ul>
 *   <li>新报名：该项目的驻场和项目经理（项目还没分配人时发给全公司驻场）；</li>
 *   <li>面试信息：求职者（站内信 + 短信）；</li>
 *   <li>释放：求职者（站内信 + 短信），原归属公司的老板和驻场；</li>
 *   <li>新流转工单：公司全部经纪人。</li>
 * </ul>
 */
@Component
public class NotificationRoutes implements OutboxHandler {

    private static final Set<String> EVENTS = Set.of("APPLICATION_CREATED", "INTERVIEW_INFO_PUSHED", "USER_RELEASED",
            "BROKER_CASE_CREATED");
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("M月d日 HH:mm");

    private final NotificationService notifications;
    private final SeekerUserMapper users;
    private final MemberMapper members;
    private final MemberProjectMapper memberProjects;
    private final FieldCipher cipher;

    public NotificationRoutes(NotificationService notifications, SeekerUserMapper users, MemberMapper members,
                              MemberProjectMapper memberProjects, FieldCipher cipher) {
        this.notifications = notifications;
        this.users = users;
        this.members = members;
        this.memberProjects = memberProjects;
        this.cipher = cipher;
    }

    @Override
    public boolean supports(String eventType) {
        return EVENTS.contains(eventType);
    }

    @Override
    public void handle(long outboxId, String eventType, String aggregateId, JsonNode p) {
        TenantContext.runAsSystem(() -> {
            switch (eventType) {
                case "APPLICATION_CREATED" -> notifications.send(outboxId, "APPLICATION_CREATED_SITE",
                        projectStaff(text(p, "companyId"), text(p, "projectId")),
                        Map.of("seekerName", seekerName(text(p, "userId")), "jobTitle", text(p, "jobTitle")),
                        "/applications/" + aggregateId);
                case "INTERVIEW_INFO_PUSHED" -> notifications.send(outboxId, "INTERVIEW_INFO_PUSHED",
                        List.of(Recipient.seeker(text(p, "userId"))),
                        Map.of("jobTitle", text(p, "jobTitle"), "interviewAt", formatTime(text(p, "interviewAt")),
                                "address", text(p, "address"), "documents", orDefault(text(p, "documents"), "身份证")),
                        "/reports");
                case "USER_RELEASED" -> {
                    String userId = text(p, "userId");
                    notifications.send(outboxId, "USER_RELEASED", List.of(Recipient.seeker(userId)), Map.of(), "/");
                    String company = text(p, "boundBefore");
                    if (!company.isEmpty()) {
                        String reason = p.hasNonNull("releaseReason")
                                ? ReleaseReason.valueOf(p.get("releaseReason").asText()).label() : "";
                        notifications.send(outboxId, "USER_RELEASED_COMPANY",
                                companyMembers(company, EnumSet.of(ActorRole.OWNER, ActorRole.SITE)),
                                Map.of("seekerName", seekerName(userId), "reason", reason), null);
                    }
                }
                case "BROKER_CASE_CREATED" -> notifications.send(outboxId, "BROKER_CASE_CREATED",
                        companyMembers(text(p, "companyId"), EnumSet.of(ActorRole.BROKER)),
                        Map.of("seekerName", seekerName(text(p, "userId"))), "/broker/pool");
                default -> {
                }
            }
            return null;
        });
    }

    private List<Recipient> projectStaff(String companyId, String projectId) {
        Set<String> assigned = memberProjects.selectList(new LambdaQueryWrapper<MemberProject>()
                        .eq(MemberProject::getProjectId, projectId)).stream()
                .map(MemberProject::getMemberId).collect(Collectors.toSet());
        List<Member> staff = members.selectList(new LambdaQueryWrapper<Member>()
                .eq(Member::getCompanyId, companyId).eq(Member::getStatus, MemberStatus.NORMAL));
        List<Recipient> onProject = staff.stream()
                .filter(m -> assigned.contains(m.getMemberId()))
                .filter(m -> m.roleSet().contains(ActorRole.SITE) || m.roleSet().contains(ActorRole.PM))
                .map(m -> Recipient.member(m.getMemberId())).toList();
        if (!onProject.isEmpty()) {
            return onProject;
        }
        return staff.stream().filter(m -> m.roleSet().contains(ActorRole.SITE)).map(m -> Recipient.member(m.getMemberId())).toList();
    }

    private List<Recipient> companyMembers(String companyId, Set<ActorRole> roles) {
        Set<Recipient> out = new LinkedHashSet<>();
        members.selectList(new LambdaQueryWrapper<Member>()
                        .eq(Member::getCompanyId, companyId).eq(Member::getStatus, MemberStatus.NORMAL))
                .stream().filter(m -> m.roleSet().stream().anyMatch(roles::contains))
                .forEach(m -> out.add(Recipient.member(m.getMemberId())));
        return List.copyOf(out);
    }

    /** 通知里的求职者称呼：实名后为脱敏姓名，未实名为手机尾号。 */
    private String seekerName(String userId) {
        SeekerUser u = users.selectById(userId);
        if (u == null) {
            return "求职者";
        }
        if (u.getRealNameEnc() != null) {
            return Masks.name(cipher.decrypt(u.getRealNameEnc()));
        }
        String phone = cipher.decrypt(u.getPhoneEnc());
        return "尾号 " + phone.substring(phone.length() - 4) + " 的用户";
    }

    private static String text(JsonNode p, String f) {
        return p.hasNonNull(f) ? p.get(f).asText() : "";
    }

    private static String orDefault(String v, String d) {
        return v == null || v.isBlank() ? d : v;
    }

    private static String formatTime(String iso) {
        try {
            return LocalDateTime.parse(iso).format(TIME);
        } catch (RuntimeException e) {
            return iso;
        }
    }
}
