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

## 0'. Chữ ký mẫu (làm 1 lần)

| # | Vai trò | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|---|
| S1 | CEO | Mở báo giá đang Chờ duyệt khi **chưa** có chữ ký mẫu | Nút **Duyệt & ký** bị khoá, có link "Tải hoặc vẽ chữ ký ở trang Hồ sơ" | |
| S2 | CEO | **Hồ sơ** → Chữ ký mẫu → **Vẽ chữ ký** (chuột/cảm ứng) → Dùng chữ ký này → **Lưu** | Ảnh chữ ký hiện trong khung | |
| S3 | CEO | **Tải ảnh** chữ ký chụp trên giấy trắng → Lưu | Nền giấy trắng thành trong suốt, chữ ký được cắt sát | |
| S4 | Account | Mở trang Hồ sơ | **Không** có mục Chữ ký mẫu | |

## A. Báo giá dự án (luồng chính)

| # | Vai trò | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|---|
| A1 | Account | Báo giá → **Tạo báo giá**. Bấm **Báo giá dự án** | Nút chuyển sang Dự án, góc trên ghi "Đã lưu" (không còn "Lỗi lưu") | |
| A2 | Account | Nhập Kính gửi, Dự án, Địa điểm; thêm 2 hạng mục từ Thư viện giá | Tổng tiền tính đúng, lưu tự động | |
| A3 | Account | Ở **Hình thức thanh toán (chọn 1)**: bấm 60/40 rồi bấm 50/30/20 | Chỉ 1 ô được chọn; chọn ô mới thì ô cũ tự bỏ | |
| A4 | Account | Xem khối trạng thái cuối báo giá | Thấy "Báo giá dự án: PM, CEO góp ý rồi CEO ký" và nút **Gửi PM & CEO góp ý** (không có nút gửi khách) | |
| A5 | Account | Bấm **Gửi PM & CEO góp ý** | Trạng thái **Chờ duyệt**, banner "Đang chờ PM, CEO góp ý và CEO duyệt" | |
| A6 | PM | Duyệt báo giá | Có mục **Báo giá dự án cần góp ý** chứa báo giá A1. Mở ra: góp ý được trên từng dòng, **không** có nút Duyệt | |
| A7 | PM | Góp ý 1 dòng (VD "Giảm SL") | Góp ý hiện trên báo giá | |
| A8 | CEO | Duyệt báo giá → mở báo giá A1 | Nút **Duyệt** bị khoá khi còn góp ý mở | |
| A9 | Account | Trả lời góp ý, bấm **Đã xử lý** | Góp ý đóng | |
| A10 | CEO | Bấm **Xem trước PDF** | PDF có logo, chữ ký mẫu kèm dấu "XEM TRƯỚC" | |
| A11 | CEO | Bấm **Duyệt & ký** | Trạng thái **Đã ký, sẵn sàng gửi**; banner "CEO đã ký lúc <giờ ký>, sẵn sàng gửi" (không qua bước Chờ CEO ký) | |
| A15 | Account | Bấm **Xuất PDF & gửi** | Trạng thái **Đã gửi**; PDF tải về **có chữ ký CEO** và dòng "Đã ký trên Go Media Ops Hub"; khối **Khách trả lời** xuất hiện | |
| A15b | Account | Mở PDF | Logo Go Media, tiêu đề bảng đọc rõ (chữ trắng trên nền xanh), không dính chữ | |

### A'. CEO trả về ở bước ký
| # | Vai trò | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|---|
| A16 | CEO | Với một báo giá đang **Chờ duyệt** hoặc **Chờ CEO ký**: bấm **Yêu cầu sửa**, ghi lý do | Trạng thái **Yêu cầu sửa**; Account thấy lý do | |
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
| D1 | Account | Tạo báo giá, để **Báo giá nhanh**, hạng mục giá thư viện, chiết khấu 0 | Banner xanh "Trong khung giá: Account gửi được ngay" | |
| D2 | Account | Bấm **Xuất PDF & gửi** | **Đã gửi** ngay, không qua bước ký; PDF **có chữ ký mẫu** của CEO | |
| D3 | Account | Ghi **Khách đã chốt**, chọn PM Thử nghiệm | Lưu được | |
| D4 | PM | Trang dự án BX01 → **Gắn báo giá** → chọn D1 | Dòng Báo giá có thêm D1 | |
| D5 | Account | Tạo báo giá nhanh, chiết khấu 40% | Banner cam "Ngoài khung giá"; nút **Gửi PM duyệt** hoặc **Gửi CEO duyệt** | |
| D6 | PM | Duyệt D5 (nếu cần PM duyệt) | Trạng thái **Chờ CEO ký**; CEO thấy D5 ở mục **Chờ bạn ký** | |
| D7 | CEO | Mở D5 → Xem trước PDF → **Ký** | Đã ký; Account gửi được, PDF có chữ ký. (Nếu D5 cần CEO duyệt: CEO bấm **Duyệt & ký** một lần) | |
| D8 | Account | Ô **SL** đang 0: bấm vào rồi gõ 10 | Hiện **10**, không phải 010; gõ "2,5" được 2,5 | |

## E. Điều khoản loại trừ nhau

| # | Vai trò | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|---|
| E1 | PM/CEO | **Thư viện giá** → Điều khoản mẫu | 3 điều khoản "Thanh toán…" có nhóm **Hình thức thanh toán**; chỉ 60/40 là Mặc định | |
| E2 | PM/CEO | Tick **Mặc định** cho 50/30/20 | 60/40 tự bỏ Mặc định | |
| E3 | PM/CEO | Thêm điều khoản mới, ghi nhóm "Hình thức thanh toán" | Điều khoản vào đúng nhóm "chọn 1" trên báo giá | |
| E4 | Account | Báo giá cũ (tạo trước 23/11) có tick cả 2 cách thanh toán → bấm gửi | Bị chặn: "Điều khoản Hình thức thanh toán chỉ chọn 1" | |

## G. Group Lark (mô phỏng)

| # | Vai trò | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|---|
| G1 | PM | Dự án mới: nhập mã `LL02`, tên "Thử group" | Nút **Tạo group "LL02 - Thử group"** (không phải gõ tên) | |
| G2 | PM | Nhập mã `MT35` (của dự án khác) | Báo mã đã có dự án; tạo group bị từ chối | |
| G3 | PM | Mở danh sách group | Group đang gắn dự án khác hiện "(đang gắn …)" và không chọn được; "MT35 LOLO" hiện "(mã MT35 của dự án khác)" | |
| G4 | PM | Ở dòng **Group chưa dùng**, bấm × cạnh "MT35 LOLO" | Group bị xoá khỏi danh sách | |
| G5 | PM | Tìm group đang gắn dự án (VD "MT35 - Ra mắt…") trong dòng Group chưa dùng | Không có ở đó (không xoá được group đang dùng) | |

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
