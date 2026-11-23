# Plan · Ops Hub 1.7 · Nối Báo giá → Dự án → Task

| | |
|---|---|
| Trạng thái | Đã chốt 23/11 (mục 0.5, 8). **1.7.0 đã code** (nhánh `feat/1.7-bao-gia-du-an`). 1.7.1, 1.7.2 chưa làm |
| Ngày | 23/11/2026 |
| Nguồn | PRD 1.6 mục 12 (backlog, bàn ngày 21/11) |
| Nhãn bằng chứng | V đã kiểm trong code · P lời người dùng/CEO · A giả định của nhóm · U chưa biết |

## 0. Luồng báo giá trước 1.7 (Long mô tả 23/11, P)

### 0.1 Luồng thực tế (AS-IS)
1. Khách gửi brief → Account nhận, tách thành bản nháp báo giá.
2. Bản nháp gửi **toàn bộ PM và CEO**; hai bên comment.
3. Account sửa theo comment, chốt bản cuối → **CEO ký**.
4. Account gửi khách → khách trả lời đồng ý hay không.

Công ty có **2 loại báo giá** (P):
- **Báo giá nhanh:** giá trị thấp, các đầu mục thường dưới 10 triệu.
- **Báo giá dự án dài:** giá trị cao; PM, CEO và team họp để chốt đầu mục và công việc; **báo giá theo giai đoạn** (CEO nói, nhóm chưa kiểm sâu: U).

### 0.2 So với app hiện tại (V: đã đối chiếu code)

| Bước AS-IS | App (bản 1.5) | Khớp? |
|---|---|---|
| Account tách brief thành nháp | Tạo báo giá từ Thư viện giá; ô "Khách gửi yêu cầu lúc" là mốc bắt đầu tính giờ | Khớp |
| Nháp gửi **mọi** PM + CEO để comment | Chỉ báo giá **ngoài khung giá** vào hàng chờ, và chỉ đúng **một cấp** (PM hoặc CEO). Báo giá trong khung: "Gửi ngay". PM/CEO vẫn mở và comment được mọi báo giá | **Lệch có chủ đích**: khung giá là cách giải pháp S2 cắt thời gian chờ duyệt |
| Comment trên báo giá | Comment theo dòng qua link (1.3) | Khớp |
| **CEO ký** bản cuối | **Không có bước này.** PDF in sẵn tên người ký trong Cài đặt | **Thiếu** |
| Gửi khách | "Đã gửi" (mốc kết thúc thời gian báo giá) | Khớp |
| Khách trả lời | Không có | Thiếu → mục 4.1 của plan này |
| Phân loại nhanh / dự án | Không phân loại | **Thiếu** |
| Họp chốt báo giá dự án | Không có (ngoài app) | Để ngoài app; chỉ ghi kết quả |

### 0.3 Hệ quả và đề xuất
- **Bước CEO ký nằm trong thời gian báo giá** (từ lúc khách yêu cầu tới lúc gửi) nhưng app không đo riêng. Nếu CEO ký mọi báo giá, làn "Gửi ngay" của khung giá vẫn bị chặn ở bước ký, và mục tiêu giảm thời gian báo giá khó đạt. Đề xuất thêm trạng thái **Chờ CEO ký** và mốc `signed_at` để đo đoạn chờ này.
- Thêm **Loại báo giá**: *Nhanh* (giữ luồng khung giá) và *Dự án* (luôn qua PM + CEO, có nhãn giai đoạn "GĐ1, GĐ2…", gắn vào cùng một dự án). Điều này khớp với quyết định "một dự án nhiều báo giá".
- Báo giá dự án được họp chốt nên **không** cần comment theo dòng như báo giá nhanh; app chỉ cần ghi lại bản chốt.

### 0.4 Cần hỏi CEO trước khi viết PRD 1.7.0
1. CEO có ký **mọi** báo giá không, kể cả báo giá nhanh? Ký tay trên PDF hay chỉ duyệt?
2. Có thể cho báo giá nhanh **trong khung giá** dùng chữ ký in sẵn (không chờ ký) không?
3. Phân loại nhanh/dự án theo **từng đầu mục dưới 10 triệu** hay theo **tổng giá trị**? Ai quyết loại?
4. Dự án dài: mỗi giai đoạn một báo giá riêng? Báo giá giai đoạn sau gửi khi nào (trước hay sau khi giai đoạn trước xong)?

### 0.5 Trả lời của CEO (qua Long, 23/11) và điều chỉnh plan
1. CEO **ký mọi báo giá** bằng **chữ ký số trên PDF**.
2. Báo giá nhanh **trong khung giá** dùng **chữ ký in sẵn**, không chờ ký.
3. Loại báo giá theo **gói dịch vụ khách chọn** (gói phủ thời gian ngắn hay dài), không theo tiền. Account chọn loại khi lập báo giá.
4. Báo giá dự án vẫn là **một báo giá gồm toàn bộ đầu mục**; khác ở chỗ **khách trả tiền theo giai đoạn** theo hợp đồng.
   → **Bỏ** ý "mỗi giai đoạn một báo giá, nhãn GĐ1/GĐ2". Giai đoạn là mốc thanh toán trong hợp đồng; để sau, cùng phần hợp đồng/thanh toán (ngoài phạm vi 1.7). Một dự án nhiều báo giá vẫn giữ cho phụ lục, bán thêm.

**Luồng 1.7.0 đã code:**
- Nhanh, trong khung: Nháp → **Gửi** (chữ ký in sẵn).
- Nhanh ngoài khung: Nháp → Chờ PM/CEO duyệt → **Chờ CEO ký** → Đã ký → Gửi.
- Dự án: Nháp → Chờ PM, CEO góp ý (CEO duyệt) → **Chờ CEO ký** → Đã ký → Gửi.
- CEO ở bước ký: tải PDF, ký số ngoài app, bấm **Đã ký** (ghi `signed_at`); hoặc **Yêu cầu sửa**. App **không** tự áp chữ ký số (cần thiết bị/nhà cung cấp CA: U).

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
4. Trên trang dự án, chỉ Account của báo giá và CEO thấy tiền; PM và nhân sự không thấy.

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
- Khối mới **"Báo giá đã chốt, chưa có dự án (n)"**, mỗi dòng: mã báo giá, loại, khách, Account, số ngày chờ. Nút **Tạo dự án**.

### 4.3 Tạo dự án
- Form Dự án mới có ô **"Từ báo giá"** (chỉ liệt kê báo giá đã chốt giao cho mình, chưa có dự án). Chọn xong thì điền sẵn: Khách hàng, Tên dự án (ô "Dự án" của báo giá), mô tả (Địa điểm, Người liên hệ). PM vẫn nhập mã dự án và deadline như 1.6.
- Trên trang dự án: nút **Gắn thêm báo giá** (phụ lục, bán thêm).

### 4.4 Tab "Phạm vi" trong dự án (PM, CEO, Account của báo giá)
- Liệt kê các báo giá của dự án (mã, loại, giai đoạn, ngày chốt; tổng tiền chỉ Account của báo giá và CEO thấy) và các dòng theo phần I, II…
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
| **1.7.0** ✔ | Loại báo giá, bước Chờ CEO ký, kết quả khách (4.1), khối chờ tạo dự án (4.2), tạo/gắn dự án từ báo giá (4.3), Account xem dự án | Unit + RLS + selftest trên Pilot; seed 3 báo giá đã chốt, 1 không chốt |
| **1.7.1** | Tab Phạm vi, tạo task hàng loạt, nhãn Ngoài báo giá (4.4, 4.5) | Như trên + kiểm giao diện bằng trình duyệt |
| **1.7.2** | Chỉ số Dashboard (4.6), tin Lark cho Account khi dự án tạo/xong | So số liệu Dashboard với tính tay trên seed |

Mỗi đợt: PRD bổ sung → Long duyệt → code → Pilot, như quy trình 1.6.

## 7. Rủi ro

- **Account quên đánh dấu kết quả** → tỷ lệ chốt thiếu dữ liệu. Giảm: báo giá "Đã gửi" quá 7 ngày chưa có kết quả hiện ở trang Báo giá và bot nhắc Account (A: ngưỡng 7 ngày).
- **Phạm vi bán ra không khớp cách chia việc** (VD 1 dòng "Gói social 1 tháng" = 30 task). Giảm: cho tách thủ công; task tạo tay vẫn gắn được vào một dòng.
- **Báo giá lịch sử (nhập CSV)** không có dòng chuẩn → không tạo dự án từ báo giá nhập (V: `source = 'import'`).
- **Mẫu nhỏ**: khoảng 6 báo giá/tháng (A, theo giả định trên Dashboard) nên tỷ lệ chốt dao động mạnh, chỉ dùng làm chỉ báo.

## 8. Quyết định của Long (23/11)

1. **Account chủ báo giá** đánh dấu "Khách đã chốt"; PM/CEO sửa được. ✔
2. Một báo giá thuộc một dự án; một dự án nhiều báo giá. ✔ cho dự án dài (báo giá theo giai đoạn). Báo giá nhanh thường 1 báo giá/dự án. Chi tiết chờ CEO (mục 0.4).
3. Account **xem được** tiến độ dự án từ báo giá của mình (chỉ xem). ✔
4. PM **không cần** thấy tổng tiền trên trang dự án → tab Phạm vi chỉ hiện tên dòng, số lượng, đơn vị; số tiền chỉ Account (của báo giá đó) và CEO thấy.
5. Lý do không chốt: Giá cao · Chọn bên khác · Khách hoãn · Khác. ✔
6. **Merge 1.6 (PR #2) xong mới làm 1.7.**
