package com.shitu.app.tenant;

import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.lifecycle.employment.RosterImportService;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.DateUtil;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** 花名册 Excel：模板生成、解析、失败行导出（T-503）。 */
final class RosterExcel {

    static final String[] HEADERS = {"姓名", "手机号", "身份证号", "项目（编号或名称）", "岗位编号（选填）", "入职日期（yyyy-MM-dd）", "工号（选填）"};
    private static final DataFormatter FMT = new DataFormatter();

    private RosterExcel() {
    }

    static byte[] template() {
        List<String[]> sample = new ArrayList<>();
        sample.add(new String[]{"张三", "13800000000", "身份证号码", "项目编号或名称", "", LocalDate.now().toString(), "KS-0001"});
        return write(sample, false);
    }

    static byte[] failed(List<Map<String, String>> rows) {
        List<String[]> data = new ArrayList<>();
        for (Map<String, String> r : rows) {
            data.add(new String[]{r.get("name"), r.get("phone"), r.get("idCard"), r.get("project"), r.get("jobId"),
                    r.get("startDate"), r.get("employeeNo"), r.get("error")});
        }
        return write(data, true);
    }

    static List<RosterImportService.Row> parse(InputStream in) {
        try (Workbook wb = WorkbookFactory.create(in)) {
            Sheet sh = wb.getSheetAt(0);
            List<RosterImportService.Row> rows = new ArrayList<>();
            for (int i = 1; i <= sh.getLastRowNum(); i++) {
                Row r = sh.getRow(i);
                if (r == null || isBlank(r)) {
                    continue;
                }
                rows.add(new RosterImportService.Row(i + 1, text(r, 0), digits(text(r, 1)), text(r, 2), text(r, 3), text(r, 4),
                        date(r.getCell(5)), text(r, 6)));
            }
            return rows;
        } catch (IOException | RuntimeException e) {
            throw new BizException(ErrorCode.SYS_BAD_REQUEST, "无法读取表格，请使用下载的模板（.xlsx）");
        }
    }

    private static boolean isBlank(Row r) {
        for (int c = 0; c < HEADERS.length; c++) {
            if (!text(r, c).isEmpty()) {
                return false;
            }
        }
        return true;
    }

    private static String text(Row r, int c) {
        Cell cell = r.getCell(c);
        return cell == null ? "" : FMT.formatCellValue(cell).trim();
    }

    /** 手机号被 Excel 存成数字时可能带 .0 或科学计数法。 */
    private static String digits(String s) {
        return s.replaceAll("\\.0$", "").replaceAll("\\s", "");
    }

    private static LocalDate date(Cell c) {
        if (c == null) {
            return null;
        }
        if (c.getCellType() == CellType.NUMERIC && DateUtil.isCellDateFormatted(c)) {
            return c.getDateCellValue().toInstant().atZone(ZoneId.of("Asia/Shanghai")).toLocalDate();
        }
        String s = FMT.formatCellValue(c).trim().replace('/', '-').replace('.', '-');
        if (s.isEmpty()) {
            return null;
        }
        try {
            String[] p = s.split("-");
            return LocalDate.of(Integer.parseInt(p[0]), Integer.parseInt(p[1]), Integer.parseInt(p[2]));
        } catch (RuntimeException e) {
            try {
                return LocalDate.parse(s);
            } catch (DateTimeParseException ex) {
                return null;
            }
        }
    }

    private static byte[] write(List<String[]> data, boolean withError) {
        try (XSSFWorkbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet sh = wb.createSheet("花名册");
            Row h = sh.createRow(0);
            for (int i = 0; i < HEADERS.length; i++) {
                h.createCell(i).setCellValue(HEADERS[i]);
                sh.setColumnWidth(i, 20 * 256);
            }
            if (withError) {
                h.createCell(HEADERS.length).setCellValue("失败原因");
                sh.setColumnWidth(HEADERS.length, 40 * 256);
            }
            var textStyle = wb.createCellStyle();
            textStyle.setDataFormat(wb.createDataFormat().getFormat("@"));
            for (int i = 0; i < HEADERS.length; i++) {
                sh.setDefaultColumnStyle(i, textStyle);
            }
            int rn = 1;
            for (String[] d : data) {
                Row r = sh.createRow(rn++);
                for (int i = 0; i < d.length; i++) {
                    Cell c = r.createCell(i);
                    c.setCellStyle(textStyle);
                    c.setCellValue(d[i] == null ? "" : d[i]);
                }
            }
            wb.write(out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
