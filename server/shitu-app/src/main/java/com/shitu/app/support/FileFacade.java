package com.shitu.app.support;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.kv.KvStore;
import com.shitu.integration.storage.FileStorage;
import com.shitu.integration.storage.UploadPolicy;
import com.shitu.tenant.client.ClientContract;
import com.shitu.tenant.company.Company;
import com.shitu.tenant.mapper.ClientContractMapper;
import com.shitu.tenant.mapper.CompanyMapper;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.Duration;
import java.util.Collection;
import java.util.Set;

/**
 * 上传与查看私有文件。上传时记录「这个 key 是谁传的」（24h），之后只有引用了该 key 的公司、或平台运营才能查看，
 * 防止拿到别人的 key 直接下载营业执照 / 合同。
 */
@Component
public class FileFacade {

    public static final Set<String> CATEGORIES = Set.of("license", "contract");
    private static final Duration OWNER_TTL = Duration.ofHours(24);

    public record Uploaded(String key, String name, long size) {
    }

    private final FileStorage storage;
    private final KvStore kv;
    private final CompanyMapper companies;
    private final ClientContractMapper contracts;

    public FileFacade(FileStorage storage, KvStore kv, CompanyMapper companies, ClientContractMapper contracts) {
        this.storage = storage;
        this.kv = kv;
        this.companies = companies;
        this.contracts = contracts;
    }

    /** @param owner 上传者标识：公司 ID，或入驻申请的 "onb:{phoneHash}" */
    public Uploaded upload(MultipartFile file, String category, String owner) {
        BizException.check(CATEGORIES.contains(category), ErrorCode.SYS_BAD_REQUEST, "文件分类不正确");
        BizException.check(file != null && !file.isEmpty() && file.getSize() <= UploadPolicy.MAX_BYTES,
                ErrorCode.TEN_FILE_INVALID, "请上传 10MB 以内的 JPG / PNG / PDF 文件");
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        String ext = UploadPolicy.detect(bytes).orElseThrow(() ->
                new BizException(ErrorCode.TEN_FILE_INVALID, "只支持 JPG / PNG / PDF 文件"));
        String contentType = switch (ext) {
            case "pdf" -> MediaType.APPLICATION_PDF_VALUE;
            case "png" -> MediaType.IMAGE_PNG_VALUE;
            default -> MediaType.IMAGE_JPEG_VALUE;
        };
        String key = storage.put(category, ext, new ByteArrayInputStream(bytes), bytes.length, contentType);
        kv.set("file:owner:" + key, owner, OWNER_TTL);
        String name = file.getOriginalFilename() == null ? key : file.getOriginalFilename();
        return new Uploaded(key, name.length() > 100 ? name.substring(0, 100) : name, bytes.length);
    }

    /** 求职者上传的投诉凭证图片（C-402）：只收 JPG / PNG，5MB 以内。owner 为 "u:{userId}"。 */
    public Uploaded uploadComplaintImage(MultipartFile file, String owner) {
        BizException.check(file != null && !file.isEmpty() && file.getSize() <= 5L * 1024 * 1024,
                ErrorCode.TEN_FILE_INVALID, "请上传 5MB 以内的 JPG / PNG 图片");
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        String ext = UploadPolicy.detect(bytes).filter(x -> !"pdf".equals(x)).orElseThrow(() ->
                new BizException(ErrorCode.TEN_FILE_INVALID, "只支持 JPG / PNG 图片"));
        String key = storage.put("complaint", ext, new ByteArrayInputStream(bytes), bytes.length,
                "png".equals(ext) ? MediaType.IMAGE_PNG_VALUE : MediaType.IMAGE_JPEG_VALUE);
        kv.set("file:owner:" + key, owner, OWNER_TTL);
        return new Uploaded(key, key, bytes.length);
    }

    /** 校验一组 key 都是该上传者刚传的（或已被该公司引用）。 */
    public void checkOwned(Collection<String> keys, String owner, String companyId) {
        if (keys == null) {
            return;
        }
        for (String key : keys) {
            boolean ok = kv.get("file:owner:" + key).map(owner::equals).orElse(false)
                    || (companyId != null && referencedBy(companyId, key));
            BizException.check(ok, ErrorCode.TEN_FILE_INVALID, "文件不存在或已过期，请重新上传");
        }
    }

    /** 租户查看：必须是本公司上传或引用的文件（TENANT 模式下 Mapper 自动限定本公司）。 */
    public ResponseEntity<InputStreamResource> viewForTenant(String key, String companyId) {
        boolean ok = kv.get("file:owner:" + key).map(companyId::equals).orElse(false) || referencedBy(companyId, key);
        BizException.check(ok, ErrorCode.SYS_NOT_FOUND);
        return stream(key);
    }

    public ResponseEntity<InputStreamResource> viewForOps(String key) {
        return stream(key);
    }

    private boolean referencedBy(String companyId, String key) {
        Company c = companies.selectById(companyId);
        if (c != null && c.getLicenseFiles() != null && c.getLicenseFiles().contains(key)) {
            return true;
        }
        return contracts.selectCount(new LambdaQueryWrapper<ClientContract>()
                .eq(ClientContract::getCompanyId, companyId).eq(ClientContract::getFileKey, key)) > 0;
    }

    private ResponseEntity<InputStreamResource> stream(String key) {
        FileStorage.StoredFile f = storage.get(key).orElseThrow(() -> new BizException(ErrorCode.SYS_NOT_FOUND));
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(f.contentType()))
                .contentLength(f.size())
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.inline().build().toString())
                .header("X-Content-Type-Options", "nosniff")
                .body(new InputStreamResource(f.content()));
    }
}
