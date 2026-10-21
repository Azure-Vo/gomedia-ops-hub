# Bước 0 · Chuẩn bị dữ liệu

Mọi thao tác dưới đây chạy **trên máy của bạn**. File có tên khách thật chỉ nằm trong thư mục `private/` (đã có trong `.gitignore`), không đưa lên GitHub, Google Drive chung hay bất kỳ công cụ AI nào.

## File mẫu (`step0/templates/`)

| File | Dùng để | Nhập vào app ở đâu |
|---|---|---|
| `1_bao_gia_tho_MAU.csv` | Báo giá đã duyệt, mỗi dòng một hạng mục, **còn tên khách thật**. Là đầu vào của script. | Không nhập trực tiếp |
| `2_thu_vien_gia_MAU.csv` | Thư viện giá: `item_name, unit, group, unit_price` (+ `band_low, band_high, code` nếu cần) | Thư viện giá → Nhập CSV |
| `3_bao_gia_lich_su_MAU.csv` | Báo giá lịch sử đã ẩn tên | Thư viện giá → Nhập báo giá lịch sử |
| `4_task_MAU.csv` | Task e-commerce **đang mở** (còn hạn) | Task → Nhập CSV |
| `5_owners_MAU.csv` | Họ tên → email đăng nhập của người phụ trách | Không nhập; script dùng |

Ngày giờ nên ghi `2026-07-06 09:00` (năm-tháng-ngày, giờ Việt Nam). Dạng `06/07/2026 09:00` được hiểu là ngày/tháng. Excel bản tiếng Anh hay lưu `7/6/2026 9:00 AM` (tháng/ngày): script tự nhận ra nếu trong file có ít nhất một ngày lớn hơn 12, và báo cảnh báo nếu không phân biệt được.

## Chạy script (Python 3.9+, không cần cài thêm gì)

```bash
# 1) Báo giá: ẩn tên khách + tính giá thư viện = trung vị đơn giá đã duyệt 12 tháng gần nhất
python scripts/prepare_data.py quotes private/bao_gia_tho.csv --out step0/out --months 12

# 2) Task đang mở: đổi tên người phụ trách sang email, bỏ task đã xong / đã quá hạn
python scripts/prepare_data.py tasks private/sheet_task.csv --owners private/owners.csv --out step0/out
```

Kết quả trong `step0/out/`:

- `bao_gia_lich_su.csv`: lịch sử đã ẩn tên (`Khách 001`, `Khách 002`…), nhập vào app.
- `thu_vien_gia.csv`: thư viện giá đề xuất, nhập vào app **sau khi** PM duyệt bản chi tiết.
- `thu_vien_gia_chi_tiet.csv`: số báo giá, giá thấp/cao nhất, cột `flags` (ít dữ liệu, giá phân tán, lâu chưa báo). PM ghi quyết định vào cột `pm_decision`, sửa giá trong `thu_vien_gia.csv` nếu cần.
- `task_nhap_app.csv`: task còn hạn, nhập vào app.
- `bao_cao_quotes.txt`, `bao_cao_tasks.txt`: tóm tắt, **không chứa tên khách**, có thể gửi cho nhóm.

Bảng tên thật ↔ alias nằm ở `private/client_alias_map.csv`. Chạy lại script thì alias giữ nguyên. Nếu trong tên hạng mục còn sót tên viết tắt hay nhãn hiệu của khách, ghi các biến thể vào cột `other_names` (cách nhau bằng `|`) rồi chạy lại. Script chỉ thay được những tên nó biết, nên **mở `bao_gia_lich_su.csv` rà cột `item_name` và `quote_code` trước khi nhập**. Nếu mã báo giá cũ chứa tên khách, chạy thêm `--recode`.

Script không tính giờ làm việc. Sau khi nhập 19 báo giá baseline vào bản **Demo**, mở **Diagnostics**: app tính lại bằng đúng hàm của app và so với 19 báo giá / 8,66 giờ / 52,6%. Chỉ những báo giá có ngày khách yêu cầu từ 01/07 đến 30/09/2026 được tính vào phép so này.

Kiểm tra script: `python -m unittest scripts/test_prepare_data.py`
