# Plan · Ops Hub 1.7 · Nối Báo giá → Dự án → Task

| | |
|---|---|
| Trạng thái | **Plan chờ Long duyệt.** Chưa code |
| Ngày | 23/11/2026 |
| Nguồn | PRD 1.6 mục 12 (backlog, bàn ngày 21/11) |
| Nhãn bằng chứng | V đã kiểm trong code · P lời người dùng/CEO · A giả định của nhóm · U chưa biết |

## 1. Vấn đề

Hiện Báo giá (S2) và Dự án/Task (S1) là hai đảo riêng:

- Báo giá dừng ở "Đã gửi". App không biết khách có chốt hay không (V: `quotes.status` chỉ có draft → sent).
- PM tạo dự án bằng cách gõ lại tên khách, phạm vi. Ô "Khách hàng" của dự án là chữ tự do (V: PRD 1.6 mục 5).
- Task không gắn với hạng mục đã bán. Không ai thấy task nào **ngoài phạm vi báo giá** — đúng loại việc làm trễ deadline mà không ai tính là "yêu cầu thay đổi".

Hệ quả cho capstone: không đo được tỷ lệ chốt báo giá, và lý do gia hạn "Yêu cầu thay đổi" (1.6.2) chưa có căn cứ đối chiếu.

## 2. Mục tiêu

1. Biết báo giá nào **khách đã chốt**, nào **không chốt** và vì sao.
2. Từ báo giá đã chốt, PM **tạo dự án trong 1 bước**, không gõ lại.
3. Từ các dòng báo giá, PM **tạo task hàng loạt**; task nào không thuộc dòng nào được đánh dấu **ngoài báo giá**.
4. Nhân sự **không thấy tiền**. Chỉ Account, PM, CEO, Admin thấy giá trị.

Ngoài phạm vi 1.7: hợp đồng, xuất hoá đơn, công nợ; doanh thu theo dự án (để sau khi có số thật).

## 3. Luồng

```
Account gửi báo giá ──► Khách trả lời
                         ├─ Không chốt: Account chọn lý do ──► kết thúc (vào số liệu tỷ lệ chốt)
                         └─ Khách đã chốt: Account chọn PM nhận việc
                                   │
                                   ▼
                     PM thấy "Báo giá đã chốt, chưa có dự án" (Tóm tắt hôm nay + Inbox)
                                   │
                    ┌──────────────┴───────────────┐
              Tạo dự án mới                   Gắn vào dự án có sẵn
         (điền sẵn khách, tên, phạm vi)     (phụ lục, bán thêm)
                                   │
                                   ▼
                 Tab "Phạm vi" của dự án: các dòng báo giá + mức độ đã giao task
                                   │
                  PM chọn dòng ──► Tạo task hàng loạt (người làm, ngày, kết quả cần nộp)
                                   │
                                   ▼
                 Task chạy như 1.6. Task tạo tay không gắn dòng nào = "Ngoài báo giá"
```

## 4. Thay đổi theo màn hình

### 4.1 Báo giá (Account)
- Báo giá "Đã gửi" có thêm khối **Kết quả**: `Khách đã chốt` / `Không chốt`.
  - Đã chốt: chọn PM nhận việc (bắt buộc). Bot nhắn riêng PM đó.
  - Không chốt: chọn lý do (Giá cao · Chọn bên khác · Khách hoãn · Khác) + ghi chú.
  - Hoàn tác được khi chưa có dự án.
- Danh sách báo giá thêm bộ lọc: Chờ phản hồi · Đã chốt · Không chốt.
- Báo giá đã chốt hiện link sang dự án (khi có).

### 4.2 Tóm tắt hôm nay + Inbox (PM)
- Khối mới **"Báo giá đã chốt, chưa có dự án (n)"**, mỗi dòng: mã báo giá, khách, giá trị, Account, số ngày chờ. Nút **Tạo dự án**.

### 4.3 Tạo dự án
- Form Dự án mới có ô **"Từ báo giá"** (chỉ liệt kê báo giá đã chốt giao cho mình, chưa có dự án). Chọn xong thì điền sẵn: Khách hàng, Tên dự án (ô "Dự án" của báo giá), mô tả (Địa điểm, Người liên hệ). PM vẫn nhập mã dự án và deadline như 1.6.
- Trên trang dự án: nút **Gắn thêm báo giá** (phụ lục, bán thêm).

### 4.4 Tab "Phạm vi" trong dự án (PM, CEO, Account của báo giá)
- Liệt kê các báo giá của dự án (mã, tổng tiền, ngày chốt) và các dòng theo phần I, II…
- Mỗi dòng: tên hạng mục, số lượng, đơn vị, **đã giao bao nhiêu task**, trạng thái: Chưa giao · Đang làm · Xong.
- Chọn nhiều dòng → **Tạo task**: bảng sửa nhanh từng task (tên, người làm, ngày bắt đầu, deadline, kết quả cần nộp). Mặc định 1 task/dòng; dòng có đơn vị đếm được (video, bài, buổi) cho phép **tách theo số lượng**, tối đa 20 task/dòng.
- Dòng "Chi hộ" (ngân sách quảng cáo) không tạo task mặc định.
- Thanh tổng: "Phạm vi đã giao 7/9 dòng · 2 task ngoài báo giá".

### 4.5 Danh sách task, drawer task
- PM/CEO thấy nhãn **Ngoài báo giá** trên task không gắn dòng nào.
- Khi gia hạn task ngoài báo giá, gợi ý sẵn lý do "Yêu cầu thay đổi" (PM vẫn tự chọn).
- Nhân sự chỉ thấy tên và "kết quả cần nộp" (chữ chép từ dòng báo giá), **không thấy giá**.

### 4.6 Dashboard
- **Tỷ lệ chốt báo giá** = đã chốt / (đã chốt + không chốt), theo tháng, kèm phân bố lý do không chốt.
- **Thời gian chốt → tạo dự án** (giờ làm việc).
- **% task ngoài báo giá** theo dự án.

## 5. Dữ liệu (chỉ thêm, không xoá cột cũ)

| Thay đổi | Ghi chú |
|---|---|
| `quotes` + `outcome` (`won`/`lost`/null), `outcome_at`, `outcome_by`, `lost_reason`, `lost_note`, `handover_pm` | Giữ nguyên `status = 'sent'` để không phá ràng buộc và KPI thời gian báo giá hiện có |
| Bảng `project_quotes (project_id, quote_id unique, linked_by, linked_at)` | Một dự án nhiều báo giá; một báo giá chỉ thuộc một dự án |
| `lark_tasks` + `quote_line_id` (null = ngoài báo giá) | `on delete set null` |
| RLS | Nhân sự không đọc được `quotes`, `quote_lines`, `project_quotes` (giữ như hiện tại: V). Account đọc `project_quotes` của báo giá mình |
| Hành động mới trên Edge Function | `quote.set_outcome`, `work.project_from_quote`, `work.link_quote`, `work.tasks_from_lines` (dùng lại kiểm tra ngày, thành viên đã tham gia của 1.6) |

Luật nghiệp vụ mới đặt trong `src/domain/` (dùng chung web và function), có unit test: tính độ phủ dòng, tách số lượng, ai được đánh dấu kết quả, điều kiện hoàn tác.

## 6. Chia đợt

| Đợt | Nội dung | Kiểm chứng |
|---|---|---|
| **1.7.0** | Kết quả báo giá (4.1), khối chờ tạo dự án (4.2), tạo/gắn dự án từ báo giá (4.3) | Unit + RLS + selftest trên Pilot; seed 3 báo giá đã chốt, 1 không chốt |
| **1.7.1** | Tab Phạm vi, tạo task hàng loạt, nhãn Ngoài báo giá (4.4, 4.5) | Như trên + kiểm giao diện bằng trình duyệt |
| **1.7.2** | Chỉ số Dashboard (4.6), tin Lark cho Account khi dự án tạo/xong | So số liệu Dashboard với tính tay trên seed |

Mỗi đợt: PRD bổ sung → Long duyệt → code → Pilot, như quy trình 1.6.

## 7. Rủi ro

- **Account quên đánh dấu kết quả** → tỷ lệ chốt thiếu dữ liệu. Giảm: báo giá "Đã gửi" quá 7 ngày chưa có kết quả hiện ở trang Báo giá và bot nhắc Account (A: ngưỡng 7 ngày).
- **Phạm vi bán ra không khớp cách chia việc** (VD 1 dòng "Gói social 1 tháng" = 30 task). Giảm: cho tách thủ công; task tạo tay vẫn gắn được vào một dòng.
- **Báo giá lịch sử (nhập CSV)** không có dòng chuẩn → không tạo dự án từ báo giá nhập (V: `source = 'import'`).
- **Mẫu nhỏ**: khoảng 6 báo giá/tháng (A, theo giả định trên Dashboard) nên tỷ lệ chốt dao động mạnh, chỉ dùng làm chỉ báo.

## 8. Cần Long quyết

1. Ai đánh dấu "Khách đã chốt"? Đề xuất: **Account chủ báo giá**; PM/CEO sửa được.
2. Một báo giá chỉ thuộc **một** dự án, một dự án **nhiều** báo giá: đồng ý?
3. Account có xem được tiến độ dự án từ báo giá của mình (chỉ xem) để báo khách không? Đề xuất: **có**.
4. PM có cần thấy **tổng tiền** báo giá trên trang dự án không? Đề xuất: có (PM, CEO, Account); nhân sự không.
5. Danh sách lý do không chốt ở 4.1 đã đủ chưa, hay cần hỏi CEO?
6. Làm đợt 1.7.0 trước khi merge PR #2, hay merge 1.6 xong mới làm?
