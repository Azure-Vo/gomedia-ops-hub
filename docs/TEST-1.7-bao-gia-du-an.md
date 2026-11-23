# Kịch bản test · Ops Hub 1.7.0 · Báo giá → Dự án

| | |
|---|---|
| Môi trường | Pilot: https://azure-vo.github.io/gomedia-ops-hub/ (Lark mô phỏng) |
| Ngày | 23/11/2026 |
| Người test | Long |
| Thời lượng | ~25 phút |

## 0. Chuẩn bị

| Vai trò | Email đăng nhập (mã gửi về hộp thư VNUK) |
|---|---|
| Account | `long.nguyen230608@vnuk.edu.vn` |
| CEO | `long.nguyen230608+ceo@vnuk.edu.vn` |
| PM | `long.nguyen230608+pm@vnuk.edu.vn` |
| Nhân sự (không được thấy báo giá) | `long.nguyen230608+nv1@vnuk.edu.vn` |

Mẹo: mở mỗi vai trò ở một cửa sổ ẩn danh khác nhau để khỏi đăng xuất qua lại.
Thông báo Telegram chỉ gửi trong giờ làm (8:00–12:00, 13:30–17:30); ngoài giờ thì gửi bù khi vào giờ. Không có Telegram vẫn test được toàn bộ trên web.

Ghi kết quả: ✅ đúng · ❌ sai (chụp màn hình, ghi bước) · ⚠️ đúng nhưng khó hiểu.

---

## A. Báo giá dự án (luồng chính)

| # | Vai trò | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|---|
| A1 | Account | Báo giá → **Tạo báo giá**. Bấm **Báo giá dự án** | Nút chuyển sang Dự án, góc trên ghi "Đã lưu" (không còn "Lỗi lưu") | |
| A2 | Account | Nhập Kính gửi, Dự án, Địa điểm; thêm 2 hạng mục từ Thư viện giá | Tổng tiền tính đúng, lưu tự động | |
| A3 | Account | Ở **Hình thức thanh toán · chọn 1**: bấm 60/40 rồi bấm 50/30/20 | Chỉ 1 ô được chọn; chọn ô mới thì ô cũ tự bỏ | |
| A4 | Account | Xem khối trạng thái cuối báo giá | Thấy "Báo giá dự án · PM, CEO góp ý rồi CEO ký" và nút **Gửi PM & CEO góp ý** (không có nút gửi khách) | |
| A5 | Account | Bấm **Gửi PM & CEO góp ý** | Trạng thái **Chờ duyệt**, banner "Đang chờ PM, CEO góp ý · CEO duyệt" | |
| A6 | PM | Duyệt báo giá | Có mục **Báo giá dự án cần góp ý** chứa báo giá A1. Mở ra: góp ý được trên từng dòng, **không** có nút Duyệt | |
| A7 | PM | Góp ý 1 dòng (VD "Giảm SL") | Góp ý hiện trên báo giá | |
| A8 | CEO | Duyệt báo giá → mở báo giá A1 | Nút **Duyệt** bị khoá khi còn góp ý mở | |
| A9 | Account | Trả lời góp ý, bấm **Đã xử lý** | Góp ý đóng | |
| A10 | CEO | Bấm **Duyệt** | Trạng thái **Chờ CEO ký**; banner có **Tải PDF để ký**, **Yêu cầu sửa**, **Đã ký** | |
| A11 | Account | Mở báo giá | Banner "Chờ CEO ký"; **không** có nút gửi khách | |
| A12 | CEO | Duyệt báo giá | Mục **Chờ bạn ký** có báo giá A1 | |
| A13 | CEO | Bấm **Tải PDF để ký** | Tải file PDF | |
| A14 | CEO | Bấm **Đã ký** | Trạng thái **Đã ký, sẵn sàng gửi**; banner ghi giờ ký | |
| A15 | Account | Bấm **Xuất PDF & gửi** | Trạng thái **Đã gửi**; xuất PDF; khối **Khách trả lời** xuất hiện | |

### A'. CEO trả về ở bước ký
| # | Vai trò | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|---|
| A16 | CEO | Với một báo giá khác đang **Chờ CEO ký**: bấm **Yêu cầu sửa**, ghi lý do | Trạng thái **Yêu cầu sửa**; Account thấy lý do | |
| A17 | Account | Sửa rồi gửi lại | Quay lại **Chờ duyệt**, phải duyệt và ký lại | |

## B. Khách trả lời

| # | Vai trò | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|---|
| B1 | Account | Báo giá A1 → **Ghi kết quả** → **Không chốt**, chưa chọn lý do | Nút Lưu bị khoá | |
| B2 | Account | Chọn lý do **Giá cao**, ghi chú → Lưu | Hiện "Không chốt · Giá cao · …" | |
| B3 | Account | **Sửa** → **Khách đã chốt**, chưa chọn PM | Nút Lưu bị khoá | |
| B4 | Account | Chọn **PM Thử nghiệm** → Lưu | Hiện "Khách đã chốt · PM nhận: PM Thử nghiệm · Chờ PM tạo dự án" | |
| B5 | Account | Báo giá → bộ lọc **Khách đã chốt** | Thấy A1, có nhãn "Dự án" và "Khách đã chốt" | |

## C. Tạo dự án từ báo giá

| # | Vai trò | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|---|
| C1 | PM | **Tóm tắt hôm nay** | Khối xanh **Báo giá đã chốt, chưa có dự án** có A1 | |
| C2 | PM | Bấm **Tạo dự án** | Form Dự án mới, ô **Từ báo giá đã chốt** chọn sẵn A1; Tên dự án, Khách hàng, Mô tả điền sẵn | |
| C3 | PM | Nhập mã (VD `BX01`), deadline → **Tạo dự án** | Vào trang dự án BX01; dòng **Báo giá: A1 (Dự án)** | |
| C4 | PM | Quay lại Tóm tắt hôm nay | A1 không còn trong khối xanh | |
| C5 | Account | Mở báo giá A1 | "→ Dự án BX01"; nút Sửa kết quả biến mất (đã khoá) | |
| C6 | Account | Bấm "→ Dự án BX01" | Xem được trang dự án (chỉ xem), ghi "Bạn xem dự án này vì báo giá là của bạn"; **không có số tiền** | |
| C7 | Nhân sự | Mở `/du-an/BX01` | "Không thấy dự án" (chưa được mời) | |

## D. Báo giá nhanh

| # | Vai trò | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|---|
| D1 | Account | Tạo báo giá, để **Báo giá nhanh**, hạng mục giá thư viện, chiết khấu 0 | Banner xanh "Trong khung giá · Account gửi được ngay" | |
| D2 | Account | Bấm **Xuất PDF & gửi** | **Đã gửi** ngay, không qua bước ký (chữ ký in sẵn) | |
| D3 | Account | Ghi **Khách đã chốt**, chọn PM Thử nghiệm | Lưu được | |
| D4 | PM | Trang dự án BX01 → **Gắn báo giá** → chọn D1 | Dòng Báo giá có thêm D1 | |
| D5 | Account | Tạo báo giá nhanh, chiết khấu 40% | Banner cam "Ngoài khung giá"; nút **Gửi PM duyệt** hoặc **Gửi CEO duyệt** | |
| D6 | PM/CEO | Duyệt D5 | Trạng thái **Chờ CEO ký** (cả khi PM duyệt) | |
| D7 | CEO | **Đã ký** | Account gửi được | |

## E. Điều khoản loại trừ nhau

| # | Vai trò | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|---|
| E1 | PM/CEO | **Thư viện giá** → Điều khoản mẫu | 3 điều khoản "Thanh toán…" có nhóm **Hình thức thanh toán**; chỉ 60/40 là Mặc định | |
| E2 | PM/CEO | Tick **Mặc định** cho 50/30/20 | 60/40 tự bỏ Mặc định | |
| E3 | PM/CEO | Thêm điều khoản mới, ghi nhóm "Hình thức thanh toán" | Điều khoản vào đúng nhóm "chọn 1" trên báo giá | |
| E4 | Account | Báo giá cũ (tạo trước 23/11) có tick cả 2 cách thanh toán → bấm gửi | Bị chặn: "Điều khoản Hình thức thanh toán chỉ chọn 1" | |

## F. Quyền (thử phá)

| # | Vai trò | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|---|
| F1 | PM khác (Võ Quỳnh Anh, nếu đăng nhập được) | Tạo dự án từ A1 | Không thấy A1 trong danh sách | |
| F2 | Nhân sự | Mở `/quotes` | Không thấy báo giá nào | |
| F3 | Account khác | Mở báo giá A1 đã gửi | Xem được (Kho tham chiếu) nhưng **không** ghi được kết quả | |

---

## Đã tự kiểm trước khi giao (Claude, 23/11)

- 161 unit test; typecheck web + Edge Function; build.
- Database tạm (Postgres 16): nâng cấp 2 lần, cài mới 2 lần; Account sửa được loại báo giá, **không** sửa trực tiếp được kết quả; RLS dự án cho Account/nhân sự.
- Trên Pilot (vai trò thật, quyền như trình duyệt): Account đổi loại báo giá được, tạo báo giá được, ghi kết quả trực tiếp bị chặn (đã hoàn tác).
- Trên Pilot, chạy toàn bộ luồng server với Account/PM/CEO thật (`tools/selftest/quote-selftest.ts`; báo giá ZZ-TEST-*, dự án ZZ8, đã xoá sau khi chạy): **34/34 bước đạt**. Lần chạy đầu 31/33: lộ lỗi yêu cầu ký gửi lúc nghỉ trưa thì mất (đã sửa: xếp hàng gửi lại vào giờ làm).

Chưa kiểm: giao diện bằng tài khoản thật trên Pilot (phần A–F ở trên), tin Telegram thật.
