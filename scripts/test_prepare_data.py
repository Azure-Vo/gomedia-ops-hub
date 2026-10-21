"""Tests for prepare_data.py.  Run:  python -m unittest scripts/test_prepare_data.py"""
import csv
import datetime as dt
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import prepare_data as pdx  # noqa: E402


def read_out(path: Path):
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


class Parsing(unittest.TestCase):
    def test_numbers_follow_the_app_rules(self):
        self.assertEqual(pdx.parse_vnd("1.500.000"), 1_500_000)
        self.assertEqual(pdx.parse_vnd("1,500,000 đ"), 1_500_000)
        self.assertEqual(pdx.parse_vnd("1525000.5"), 1_525_001)
        self.assertIsNone(pdx.parse_vnd("abc"))
        self.assertEqual(pdx.parse_number("7,5%"), 7.5)
        self.assertEqual(pdx.parse_number("1.000"), 1000)

    def test_date_order_is_detected_from_telling_dates(self):
        self.assertEqual(pdx.detect_date_order(["25/07/2026 09:00", "03/07/2026 10:00"])[0], "dmy")
        self.assertEqual(pdx.detect_date_order(["7/25/2026 9:00 AM", "7/3/2026 10:00 AM"])[0], "mdy")
        self.assertEqual(pdx.detect_date_order(["03/07/2026 09:00"])[0], "ambiguous")
        self.assertEqual(pdx.detect_date_order(["25/07/2026", "07/25/2026"])[0], "mixed")
        self.assertEqual(pdx.detect_date_order(["2026-07-03 09:00"])[0], "iso")

    def test_dates_in_every_export_style(self):
        self.assertEqual(pdx.parse_dt("2026-07-03 09:00", "dmy"), (dt.datetime(2026, 7, 3, 9, 0), True))
        self.assertEqual(pdx.parse_dt("03/07/2026 09:00", "dmy"), (dt.datetime(2026, 7, 3, 9, 0), True))
        self.assertEqual(pdx.parse_dt("7/3/2026 2:30 PM", "mdy"), (dt.datetime(2026, 7, 3, 14, 30), True))
        self.assertEqual(pdx.parse_dt("03/07/2026 02:30 CH", "dmy"), (dt.datetime(2026, 7, 3, 14, 30), True))
        self.assertEqual(pdx.parse_dt("46206.375", "dmy"), (dt.datetime(2026, 7, 3, 9, 0), True))
        self.assertEqual(pdx.parse_dt("03/07/2026", "dmy"), (dt.datetime(2026, 7, 3, 0, 0), False))
        self.assertEqual(pdx.parse_dt("31/02/2026 09:00", "dmy"), (None, False))

    def test_header_slugs_ignore_tone_marks(self):
        self.assertEqual(pdx.slug("Khách hàng"), "khach_hang")
        self.assertEqual(pdx.slug(" Đơn giá (đ) "), "don_gia_d")


RAW_QUOTES = """Mã báo giá;Khách hàng;Nhóm dịch vụ;Khách yêu cầu lúc;Gửi lúc;Hạng mục;Đơn vị;Số lượng;Đơn giá;Chiết khấu
BG-01;Công ty Sao Mai;Social Media;06/07/2026 09:00;06/07/2026 15:00;Video TikTok cho Sao Mai;video;12;1.500.000;5
BG-01;Công ty Sao Mai;Social Media;06/07/2026 09:00;06/07/2026 15:00;Bài Facebook;bài;8;600.000;5
BG-02;Cửa hàng Hoa Lan;Social Media;14/08/2026 14:00;17/08/2026 10:00;Video TikTok cho Sao Mai;video;6;1.600.000;0
BG-03;công ty  sao mai;Social Media;21/09/2026 08:30;21/09/2026 16:00;Bài Facebook;bài;4;650.000;0
BG-04;Cửa hàng Hoa Lan;E-commerce;25/09/2026 08:30;24/09/2026 16:00;Banner;bộ;2;1.200.000;0
BG-05;Khách lẻ;Social Media;02/10/2026 09:00;02/10/2026 11:00;Bài Facebook;bài;2;0;0
"""


class QuotesEndToEnd(unittest.TestCase):
    def run_quotes(self, tmp: Path, *extra):
        raw = tmp / "raw.csv"
        raw.write_bytes(RAW_QUOTES.encode("utf-8"))
        return pdx.main(["quotes", str(raw), "--out", str(tmp / "out"), "--alias-map", str(tmp / "private" / "map.csv"), "--as-of", "2026-10-21", *extra])

    def test_outputs_are_import_ready_and_never_contain_client_names(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            self.assertEqual(self.run_quotes(tmp), 0)
            hist = read_out(tmp / "out" / "bao_gia_lich_su.csv")
            self.assertEqual(list(hist[0].keys()), pdx.HISTORY_COLUMNS)
            # BG-04 is refused (sent before requested); the rest stay, ordered by request time
            self.assertEqual([r["quote_code"] for r in hist], ["BG-01", "BG-01", "BG-02", "BG-03", "BG-05"])
            self.assertEqual(hist[0]["requested_at"], "2026-07-06 09:00")
            # same client typed differently -> same alias; names inside item names replaced
            self.assertEqual(hist[0]["client_alias"], hist[3]["client_alias"])
            self.assertNotEqual(hist[0]["client_alias"], hist[2]["client_alias"])
            self.assertEqual(hist[0]["item_name"], f"Video TikTok cho {hist[0]['client_alias']}")
            for name in ["out/bao_gia_lich_su.csv", "out/thu_vien_gia.csv", "out/thu_vien_gia_chi_tiet.csv", "out/bao_cao_quotes.txt"]:
                text = (tmp / name).read_text(encoding="utf-8-sig").casefold()
                for real in ["sao mai", "hoa lan"]:
                    self.assertNotIn(real, text, f"{real} leaked into {name}")
            self.assertIn("Sao Mai", (tmp / "private" / "map.csv").read_text(encoding="utf-8-sig"))

    def test_library_uses_rounded_medians_and_skips_free_lines(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            self.run_quotes(tmp)
            lib = {r["item_name"]: r for r in read_out(tmp / "out" / "thu_vien_gia_chi_tiet.csv")}
            fb = lib["Bài Facebook"]
            self.assertEqual(fb["unit_price_median"], "625000")  # median of 600.000 and 650.000; the 0 đ line is not a price
            self.assertEqual(fb["free_lines"], "1")
            self.assertIn("ít dữ liệu", fb["flags"])
            importable = read_out(tmp / "out" / "thu_vien_gia.csv")
            self.assertEqual(list(importable[0].keys()), ["item_name", "unit", "group", "unit_price"])

    def test_aliases_are_stable_across_runs(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            self.run_quotes(tmp)
            first = read_out(tmp / "out" / "bao_gia_lich_su.csv")
            self.run_quotes(tmp)
            second = read_out(tmp / "out" / "bao_gia_lich_su.csv")
            self.assertEqual([r["client_alias"] for r in first], [r["client_alias"] for r in second])

    def test_report_counts_the_baseline_period(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            self.run_quotes(tmp)
            report = (tmp / "out" / "bao_cao_quotes.txt").read_text(encoding="utf-8-sig")
            self.assertIn("Kỳ baseline 01/07–30/09/2026 (theo ngày khách yêu cầu): 3 báo giá", report)
            self.assertIn("Dòng 5: sent_at phải sau requested_at", report)

    def test_recode_keeps_the_code_mapping_private(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            self.run_quotes(tmp, "--recode")
            hist = read_out(tmp / "out" / "bao_gia_lich_su.csv")
            self.assertEqual(hist[0]["quote_code"], "H-2026-001")
            self.assertTrue((tmp / "private" / "quote_code_map.csv").exists())


class Scrubbing(unittest.TestCase):
    def book(self, tmp: Path, rows: str) -> "pdx.AliasBook":
        f = tmp / "map.csv"
        f.write_text(rows, encoding="utf-8")
        return pdx.AliasBook.load(f)

    def test_short_client_names_do_not_damage_ordinary_words(self):
        with tempfile.TemporaryDirectory() as d:
            b = self.book(Path(d), "client_alias,client_name,other_names\nKhách 001,Cty Mai,\n")
            self.assertEqual(b.scrub("Lịch đăng ngày mai")[0], "Lịch đăng ngày mai")
            self.assertEqual(b.scrub("Video cho Mai")[0], "Video cho Khách 001")

    def test_team_added_variants_are_scrubbed(self):
        with tempfile.TemporaryDirectory() as d:
            b = self.book(Path(d), "client_alias,client_name,other_names\nKhách 002,Công ty TNHH Mỹ phẩm Hoa Lan,HLC | Hoa Lan Cosmetics\n")
            self.assertEqual(b.scrub("Livestream HOA LAN COSMETICS + banner HLC")[0], "Livestream Khách 002 + banner Khách 002")
            self.assertEqual(pdx.short_name("Công ty TNHH Mỹ phẩm Hoa Lan"), "Mỹ phẩm Hoa Lan")
            self.assertEqual(pdx.short_name("Cửa hàng Hoa Lan"), "Hoa Lan")


RAW_TASKS = """Tên task,Người phụ trách,Loại task,Bắt đầu,Deadline,Trạng thái,Ưu tiên
Banner Shopee 11.11,Thực tập Minh,Banner chiến dịch,09/11/2026 08:00,13/11/2026,Đang làm,Xin ảnh từ khách
Video unbox,an@gomedia.vn,Video sản phẩm,02/11/2026 08:00,06/11/2026 17:30,,
Task cũ đã xong,Thực tập Minh,Banner chiến dịch,01/10/2026 08:00,02/10/2026 17:30,Hoàn thành,
Task quá hạn,Thực tập Minh,Banner chiến dịch,01/10/2026 08:00,02/10/2026 17:30,Đang làm,
Không loại,Thực tập Minh,,09/11/2026 08:00,13/11/2026 17:30,,
"""


class TasksEndToEnd(unittest.TestCase):
    def test_only_open_tasks_with_emails_and_iso_dates(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            (tmp / "sheet.csv").write_text(RAW_TASKS, encoding="utf-8")
            (tmp / "owners.csv").write_text("name,email\nThực tập Minh,minh@gomedia.vn\n", encoding="utf-8")
            code = pdx.main(["tasks", str(tmp / "sheet.csv"), "--owners", str(tmp / "owners.csv"), "--out", str(tmp / "out"), "--now", "2026-10-21 10:00"])
            self.assertEqual(code, 0)
            rows = read_out(tmp / "out" / "task_nhap_app.csv")
            self.assertEqual([r["task_name"] for r in rows], ["Banner Shopee 11.11", "Video unbox"])
            self.assertEqual(rows[0]["owner_email"], "minh@gomedia.vn")
            self.assertEqual(rows[0]["due_at"], "2026-11-13 17:30")  # date-only deadline -> end of day
            report = (tmp / "out" / "bao_cao_tasks.txt").read_text(encoding="utf-8-sig")
            self.assertIn("Bỏ qua vì đã xong/huỷ: 1", report)
            self.assertIn("đã qua deadline (tính tại 21/10/2026 10:00): 1", report)
            self.assertIn("Dòng 5: cần task_type hoặc đủ 4 mốc", report)


if __name__ == "__main__":
    unittest.main()
