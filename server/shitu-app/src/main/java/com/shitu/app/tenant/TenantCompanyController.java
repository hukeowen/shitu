package com.shitu.app.tenant;

import com.shitu.app.support.FileFacade;
import com.shitu.common.api.ApiResponse;
import com.shitu.framework.security.CurrentUser;
import com.shitu.tenant.company.CompanyService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** 当前账号、公司资料与入驻进度、文件上传 / 查看（这些接口在公司审核通过前也可用）。 */
@Tag(name = "公司后台 · 账号与公司")
@RestController
@RequestMapping("/api/v1/tenant")
public class TenantCompanyController {

    private final TenantAuthFacade auth;
    private final CompanyService companies;
    private final FileFacade files;

    public TenantCompanyController(TenantAuthFacade auth, CompanyService companies, FileFacade files) {
        this.auth = auth;
        this.companies = companies;
        this.files = files;
    }

    @Operation(summary = "当前成员：角色、权限点、公司状态（前端据此决定菜单与入驻进度页）")
    @GetMapping("/me")
    public ApiResponse<TenantAuthFacade.TenantMe> me() {
        return ApiResponse.ok(auth.me(CurrentUser.get()));
    }

    @Operation(summary = "公司资料")
    @GetMapping("/company")
    public ApiResponse<CompanyService.CompanyView> company() {
        return ApiResponse.ok(companies.get(CurrentUser.companyId(), CurrentUser.get().hasRole("OWNER")));
    }

    @Operation(summary = "修改入驻资料并重新提交审核（审核中 / 被驳回时，老板）")
    @PreAuthorize("hasRole('OWNER')")
    @PutMapping("/company/application")
    public ApiResponse<CompanyService.CompanyView> resubmit(@Valid @RequestBody TenantAuthController.ApplyRequest req) {
        String companyId = CurrentUser.companyId();
        files.checkOwned(req.licenseFiles(), companyId, companyId);
        return ApiResponse.ok(companies.resubmit(companyId, req.toCommand()));
    }

    @Operation(summary = "上传文件（category：license 营业执照 / 许可证，contract 合作合同）")
    @PostMapping("/files")
    public ApiResponse<FileFacade.Uploaded> upload(@RequestParam("file") MultipartFile file,
                                                   @RequestParam(defaultValue = "contract") String category) {
        return ApiResponse.ok(files.upload(file, category, CurrentUser.companyId()));
    }

    @Operation(summary = "查看本公司文件")
    @GetMapping("/files")
    public ResponseEntity<InputStreamResource> view(@RequestParam String key) {
        return files.viewForTenant(key, CurrentUser.companyId());
    }
}
