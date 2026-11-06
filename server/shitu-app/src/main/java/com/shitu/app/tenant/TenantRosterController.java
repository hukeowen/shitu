package com.shitu.app.tenant;

import com.shitu.app.support.FileFacade;
import com.shitu.common.api.ApiResponse;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.framework.security.CurrentUser;
import com.shitu.lifecycle.employment.RosterImportService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/** 花名册导入（T-503，项目经理）：模板下载、导入、批次记录、失败行下载。 */
@Tag(name = "公司后台 · 花名册导入")
@RestController
@RequestMapping("/api/v1/tenant/roster")
@PreAuthorize("hasRole('PM')")
public class TenantRosterController {

    private static final MediaType XLSX = MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    private final RosterImportService roster;

    public TenantRosterController(RosterImportService roster, FileFacade files) {
        this.roster = roster;
    }

    @Operation(summary = "下载导入模板")
    @GetMapping("/template")
    public ResponseEntity<byte[]> template() {
        return xlsx(RosterExcel.template(), "花名册导入模板.xlsx");
    }

    @Operation(summary = "导入（.xlsx，单次最多 2000 行；逐行处理，失败行可下载修改后重传）")
    @PostMapping("/import")
    public ApiResponse<RosterImportService.BatchResult> importRoster(@RequestParam("file") MultipartFile file) throws IOException {
        BizException.check(file != null && !file.isEmpty() && file.getSize() <= 5L * 1024 * 1024, ErrorCode.TEN_FILE_INVALID,
                "请上传 5MB 以内的 .xlsx 文件");
        AuthPrincipal p = CurrentUser.get();
        List<RosterImportService.Row> rows = RosterExcel.parse(file.getInputStream());
        return ApiResponse.ok(roster.importRows(p, file.getOriginalFilename(), rows));
    }

    @Operation(summary = "导入批次记录")
    @GetMapping("/batches")
    public ApiResponse<List<Map<String, Object>>> batches() {
        return ApiResponse.ok(roster.batches(CurrentUser.companyId()));
    }

    @Operation(summary = "下载某批次的失败行（含失败原因）")
    @GetMapping("/batches/{batchId}/failed")
    public ResponseEntity<byte[]> failed(@PathVariable String batchId) {
        return xlsx(RosterExcel.failed(roster.failedRows(CurrentUser.companyId(), batchId)), "导入失败行-" + batchId + ".xlsx");
    }

    private static ResponseEntity<byte[]> xlsx(byte[] body, String filename) {
        return ResponseEntity.ok().contentType(XLSX)
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(filename, StandardCharsets.UTF_8)
                        .build().toString())
                .body(body);
    }
}
