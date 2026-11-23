# PRD · Ops Hub 1.6 · Dự án & Task (S1)

| | |
|---|---|
| Phiên bản | 1.6.2 · đang chạy trên Pilot (bổ sung ở mục 15, 16) |
| Ngày | 22/11/2026 |
| Người quyết định | Nguyễn Hoàng Long (Migi) |
| Phạm vi | Giải pháp S1 (task trễ) trên Ops Hub + Lark. Phần Báo giá (S2) chỉ đổi vị trí trên menu |
| Trạng thái | Long đã duyệt 22/11; đã code và chạy trên Pilot. Bổ sung 1.6.1 (mục 15) và 1.6.2 (mục 16) ngày 23/11 |

**Nhãn bằng chứng** (theo quy ước BC26):
- **V** · đã kiểm chứng (có trong code hoặc dữ liệu)
- **P** · đối tác (Go Media / CEO) nói
- **A** · giả định, chỉnh được sau pilot
- **U** · chưa biết, cần kiểm hoặc hỏi

---

## 1. Bối cảnh và mục tiêu

### 1.1 Vấn đề
- **Task thương mại điện tử trễ hạn: baseline 55,2%** (V, tính từ 29 task lịch sử của Go Media). Mục tiêu dưới 20%.
- Bản 1.5 đã có: tạo task mẹ / task con qua bot Lark, nhắc D-3 / D-2 / D-1 / quá hạn, KPI M1, Go Star (V). Khi Long rà lại thì phát hiện các vấn đề sau:
  1. Nhân viên và người quản lý **dùng chung một trang**, chỉ khác một nút. Nhân viên không có chỗ để biết hôm nay mình phải làm gì.
  2. "Task mẹ" thực chất là **dự án** nhưng không có tiến độ, không có trạng thái, không bao giờ đóng.
  3. **Không có bước kiểm tra đầu ra.** Task được tính xong ngay khi nhân viên tick Completed. Người quản lý không có chỗ xem bằng chứng hay góp ý.
  4. **Nhắc giống hệt nhau cho mọi task.** Task 3 ngày bị nhắc ngay hôm nhận việc. Task 14 ngày tới D-3 mới được cảnh báo, lúc đó thường đã muộn.
  5. Nhân viên phải **tự gõ mã** dạng `DA056-04-S44`, dễ sai. Không ai biết đoạn "04" nghĩa là gì.
  6. Tin nhắc đi vào **một group chung**, trong khi Go Media đã có **group Lark riêng cho từng dự án** (P).
  7. Dự án chưa có danh sách thành viên. Chưa có lịch (Calendar). Tên "Nhắc task Lark", "Group Lark", "Chạy kiểm tra ngay" khó hiểu.

### 1.2 Mục tiêu của bản 1.6
- **G1:** Mỗi vai trò có một không gian làm việc riêng: **PM quản lý**, **nhân sự thực hiện**.
- **G2:** Task chỉ được tính hoàn thành khi **PM đã kiểm tra bằng chứng và duyệt**.
- **G3:** Phát hiện sớm task có nguy cơ trễ, **có tính đến độ dài của từng task**, và dựa vào tín hiệu từ chính người làm.
- **G4:** Không ai phải gõ mã task. Mọi tin nhắn của dự án đi vào đúng group của dự án đó.

### 1.3 Chỉ số thành công
- **M1 · Tỷ lệ task trễ < 20%.** Định nghĩa mới ở mục 9.
- Chỉ số phụ (đo, không đặt mục tiêu trong pilot):
  - Tỷ lệ task phải sửa
  - Thời gian PM duyệt trung bình
  - Tỷ lệ trả lời câu hỏi tiến độ
  - Số lần gia hạn, chia theo lý do

---

## 2. Thuật ngữ

| Thuật ngữ | Nghĩa | Thay cho (bản 1.5) |
|---|---|---|
| **Dự án** | Một đầu việc lớn có PM, deadline, group Lark và thành viên | Task mẹ |
| **Task** | Một việc giao cho **một** người, có deadline và kết quả cần nộp | Task con |
| **PM** | Người quản lý dự án. Duy nhất vai trò được tạo dự án, giao task, duyệt | Người phụ trách |
| **Nhân sự** | Mọi người dùng không phải PM hoặc CEO: Account, E-com Exec, Staff | Người thực hiện |
| **Kết quả cần nộp** | Mô tả đầu ra để PM đối chiếu khi duyệt | (chưa có) |
| **Bằng chứng** | Link hoặc file nhân sự nộp kèm khi bấm Hoàn thành | (chưa có) |
| **Hỏi tiến độ** | Card bot hỏi nhân sự giữa chừng: Đúng tiến độ / Chậm / Bị chặn | Checkpoint (module cũ) |
| **Lịch sử nhắc việc** | Nhật ký các tin bot đã gửi | Tab "Group Lark" |

---

## 3. Vai trò và quyền

Quy tắc của Long: **chỉ PM quản lý dự án và công việc. Ngoài PM và CEO, tất cả là nhân sự.** (quyết định của Long, 22/11)

| Vai trò hệ thống | Không gian Công việc | Ghi chú |
|---|---|---|
| `pm` | **Quản lý** (toàn quyền) | Cũng duyệt báo giá như hiện tại |
| `ceo` | **Quản lý, chỉ xem** | Xem mọi dự án, không tạo, giao hay duyệt task. Giữ quyền duyệt báo giá và chốt Go Star |
| `account`, `ecom_exec`, `staff` | **Nhân sự** | Account vẫn thấy nhóm Báo giá |
| `admin` | Không có không gian Công việc | Chỉ quản trị: người dùng, cài đặt, kết nối Lark, chẩn đoán |

**Ma trận quyền**

| Hành động | PM | CEO | Nhân sự | Admin |
|---|---|---|---|---|
| Tạo / sửa / huỷ dự án | ✔ | – | – | – |
| Gắn group Lark cho dự án | ✔ | – | – | – |
| Tạo task, giao người, đổi deadline | ✔ | – | – | – |
| Xem mọi dự án | ✔ (dự án mình phụ trách + xem các dự án khác) | ✔ | Chỉ dự án mình là thành viên | – |
| Xem task của người khác trong cùng dự án | ✔ | ✔ | ✔ chỉ xem | – |
| Nộp kết quả (Hoàn thành) | – | – | ✔ chỉ task của mình | – |
| Trả lời hỏi tiến độ, báo Bị chặn / Đã gỡ | – | – | ✔ chỉ task của mình | – |
| Duyệt / Yêu cầu sửa / Gia hạn | ✔ | – | – | – |
| Hoàn thành thay nhân sự | **Không ai được** | | | |
| Chạy nhắc việc thủ công (kiểm thử) | – | – | – | ✔ |

Một nhân sự có thể là thành viên của nhiều dự án.

> **A:** Nếu Go Media có nhiều PM, mỗi PM duyệt task trong dự án mình phụ trách. PM khác chỉ xem.

---

## 4. Điều hướng: hai không gian làm việc

Đăng nhập xong, PM vào **Tóm tắt hôm nay**, nhân sự vào **Inbox**. CEO vào Dashboard như hiện tại. Admin vào Người dùng.

### 4.1 Sidebar trang Nhân sự

| Mục | Đường dẫn | Nội dung |
|---|---|---|
| **Inbox** · có số đếm (quá hạn + hôm nay + cần sửa) | `/inbox` | Task của tôi, chia nhóm: Quá hạn · Hôm nay · Cần sửa · Sắp tới (7 ngày) · Đã xong (30 ngày) |
| **Dự án của tôi** | `/du-an` | Dự án tôi là thành viên. Bấm vào xem tiến độ, thành viên và toàn bộ task (chỉ xem task của người khác) |
| **Calendar** | `/lich` | Lịch deadline của tôi (mục 8) |
| **Go Star** | `/gostar` | Bảng xếp hạng tháng, chỉ xem |
| **Hồ sơ** | `/profile` | Thông tin cá nhân, liên kết Lark |
| *Báo giá (chỉ Account)* | như hiện tại | Báo giá, Kho tham chiếu |

### 4.2 Sidebar trang Quản lý (PM; CEO chỉ xem)

| Mục | Đường dẫn | Nội dung |
|---|---|---|
| **Tóm tắt hôm nay** | `/tom-tat` | Bản tóm tắt cập nhật liên tục, theo từng dự án (mục 7.6) |
| **Chờ duyệt** · có số đếm | `/cho-duyet` | Hàng đợi duyệt: kết quả cần nộp đặt cạnh bằng chứng |
| **Dự án** | `/du-an` | Danh sách dự án có thanh tiến độ. Tạo dự án, vào chi tiết, tạo task |
| **Calendar** | `/lich` | Lịch góc nhìn PM (mục 8) |
| **Nhân sự** | `/nhan-su` | Mỗi người đang giữ bao nhiêu task mở, bao nhiêu trễ, chờ duyệt, bị chặn |
| **Báo cáo** | `/dashboard` | Dashboard KPI hiện có (S1 + S2) + lịch sử các bản tóm tắt |
| **Go Star** | `/gostar` | Chấm điểm |
| *Báo giá* | như hiện tại | Duyệt báo giá, Kho tham chiếu, Thư viện giá |

### 4.3 Thay đổi menu so với bản 1.5
- Xoá nhóm "S1 · Task Lark & ghi nhận". Mục "Nhắc task Lark" tách ra thành các trang ở trên.
- Tab "Group Lark" đổi thành **"Lịch sử nhắc việc"**, nằm trong chi tiết dự án (chỉ những tin của dự án đó) và trong Admin (tất cả các tin).
- Nút **"Chạy kiểm tra ngay"** chuyển vào Admin → Kết nối Lark, đổi tên thành **"Chạy nhắc việc ngay (kiểm thử)"**.
- Module "Task checkpoint (bản cũ)" chỉ Admin còn thấy. Chưa xoá code.

---

## 5. Dự án

### 5.1 Thông tin của một dự án

| Trường | Bắt buộc | Quy tắc |
|---|---|---|
| Mã dự án | ✔ | **PM tự nhập.** 2–4 chữ in hoa + 1–4 chữ số (ví dụ `MT35`, `DA056`). Không trùng. Tự viết hoa, bỏ khoảng trắng. **Không đổi được sau khi dự án đã có task** |
| Tên dự án | ✔ | |
| Khách hàng | | Chữ tự do (bản 1.6 chưa nối với Báo giá, xem mục 12) |
| PM phụ trách | ✔ | Mặc định là người tạo |
| Ngày bắt đầu | ✔ | Mặc định hôm nay |
| Deadline dự án | ✔ | Sau ngày bắt đầu |
| Group Lark | | Xem 5.2. Dự án vẫn tạo được khi chưa có group |
| Màu | | Tự gán từ bảng màu, dùng cho Calendar. PM đổi được |
| Mô tả | | |

### 5.2 Gắn group Lark và kiểm tra bot

Go Media đã có group Lark riêng cho từng dự án (P). Bot **không tự tạo group** và **không tự thêm người**.

Giới hạn kỹ thuật: bot chỉ thấy những group mà nó đã ở trong đó (U, cần kiểm trên Lark thật). Vì vậy bot không tự phát hiện được "có group trùng tên mà mình chưa ở trong".

1. Khi tạo dự án, PM chọn group từ danh sách **các group mà bot đang ở**. Group nào có tên chứa mã dự án thì được **chọn sẵn**.
   - **Quy ước đề xuất:** tên group bắt đầu bằng mã dự án, ví dụ "MT35 · Ra mắt BST Tết". Không khớp theo tên đầy đủ, vì dấu tiếng Việt và cách viết dễ lệch.
2. Không có group phù hợp thì dự án ở trạng thái gắn group **"Chưa gắn group"**:
   - Trang dự án hiện banner: *"Bot chưa có trong group của MT35. Thêm bot Go Media vào group của dự án rồi bấm Kiểm tra lại."*
   - Bot nhắn riêng cho PM **một lần** khi dự án được tạo.
   - Trong lúc chưa có group, mọi tin của dự án **gửi riêng cho PM** để không mất.
3. **Gắn bằng lệnh:** PM gõ `/taomoi duan …` ngay trong group của dự án thì dự án tự gắn vào group đó.
4. Nếu gửi tin vào group bị lỗi vì bot bị xoá khỏi group, dự án quay về "Chưa gắn group" và hệ thống báo PM như bước 2.

### 5.3 Thành viên dự án
- **Thành viên dự án = thành viên group Lark của dự án.** Hệ thống đồng bộ cùng lượt với task (15 phút/lần). (U: cần quyền đọc thành viên group)
- Người được giao task trong dự án tự động là thành viên, dù chưa ở trong group.
- Người có trong group mà **chưa có tài khoản Ops Hub**: trang dự án liệt kê "Chưa có tài khoản" để Admin tạo.
- **Chế độ mô phỏng** (chưa có Lark App): PM chọn thành viên bằng tay từ danh sách người dùng.
- Ô "Người thực hiện" khi tạo task chỉ hiện thành viên dự án.

### 5.4 Trạng thái dự án (hệ thống tự tính)

Xét theo thứ tự, gặp điều kiện nào trước thì lấy trạng thái đó:

| # | Trạng thái | Điều kiện |
|---|---|---|
| 1 | **Đã huỷ** | PM huỷ (bắt buộc ghi lý do) |
| 2 | **Hoàn thành** | Có ít nhất 1 task, và mọi task (trừ task đã huỷ) đã được **duyệt**. Dự án **tự đóng** và bot báo vào group |
| 3 | **Trễ** | Đã qua deadline dự án mà chưa Hoàn thành |
| 4 | **Cần can thiệp** | Có ít nhất 1 task màu đỏ (mục 6.6) |
| 5 | **Có nguy cơ** | Có task màu vàng, **hoặc** % thời gian dự án đã trôi lớn hơn % task đã duyệt **quá 25 điểm** (A). Ví dụ đã đi 70% thời gian mà mới xong 40% task |
| 6 | **Đúng tiến độ** | Các trường hợp còn lại |

Dự án đã tự đóng mà PM thêm task mới thì dự án tự mở lại.

### 5.5 Thanh tiến độ dự án

Thanh **chia đoạn theo màu**, không dùng một thanh phần trăm trơn:

```
MT35 · Ra mắt BST Tết    ████████░░░▒▒▒▒▒▓▓▓  8/20 xong · 40%
                         xong   chờ duyệt  ổn   nguy cơ  can thiệp
```

- Thứ tự các đoạn: Xong · Chờ duyệt · Ổn · Có nguy cơ · Cần can thiệp. Task đã huỷ không tính.
- Phần trăm = **số task đã duyệt / tổng số task**. Tính theo số task cho dễ hiểu. Cách tính theo thời lượng task để dành cho sau.
- Dòng phụ: `8 xong · 3 chờ duyệt · 5 ổn · 2 nguy cơ · 2 cần can thiệp`.
- Rê chuột lên một đoạn thì thấy danh sách task trong đoạn đó.

---

## 6. Task

### 6.1 Thông tin của một task

| Trường | Bắt buộc | Quy tắc |
|---|---|---|
| Mã task | tự sinh | `<mã dự án>-<số thứ tự>`, ví dụ `MT35-01`, `MT35-02`. Quá 99 thì sang 3 chữ số (`MT35-100`). **Số đã dùng không cấp lại**, kể cả khi task bị huỷ. Không ai phải gõ mã |
| Tên task | ✔ | |
| Kết quả cần nộp | ✔ | Mô tả đầu ra để PM đối chiếu, ví dụ "50 video KOC đã đăng + file tổng hợp link" |
| Người thực hiện | ✔ | **Một** người, là thành viên dự án |
| Ngày bắt đầu | ✔ | Mặc định ngày tạo |
| Deadline | ✔ | Sau ngày bắt đầu, **không sau deadline dự án**. Muốn vượt thì PM phải gia hạn dự án trước |
| Mô tả | | |
| Mức nhắc | tự tính | Theo thời lượng task (mục 7.1). PM đổi được cho từng task |

Trên Lark, tiêu đề vẫn theo mẫu của CEO: dự án `[MT35] Tên dự án`, task `Tên task (MT35-07)` (P).

### 6.2 Bỏ quy tắc "mã sai thì không tính hoàn thành"
- Ở bản 1.5, hệ thống đọc mã từ tiêu đề task trên Lark. Nếu ai đó sửa tiêu đề làm sai mã thì task không được tính hoàn thành (V). Quy tắc này có là vì trước đây nhân viên tự gõ mã.
- Từ 1.6, mã do hệ thống sinh nên luôn đúng. Hệ thống **nhận diện task bằng ID của Lark** (`lark_guid`), không đọc mã từ tiêu đề nữa. Ai sửa tiêu đề trên Lark thì lượt đồng bộ sau hệ thống tự ghi lại tiêu đề chuẩn.
- **Cần báo CEO thay đổi này**, vì brief A2.3 có yêu cầu kiểm mã. (P → cần CEO xác nhận)
- Bỏ đoạn giữa kiểu "04" trong mã. Quyết định của Long ngày 22/11.

### 6.3 Vòng đời task

```
            nộp kết quả                 duyệt
 Đang làm ───────────────► Chờ duyệt ───────────► Hoàn thành
    ▲                          │
    │       nộp lại            │ yêu cầu sửa (bắt buộc góp ý, có thể gia hạn)
    └──────── Cần sửa ◄────────┘

 PM huỷ được từ mọi trạng thái trừ Hoàn thành → Đã huỷ (bắt buộc ghi lý do)
```

| Chuyển trạng thái | Ai làm | Điều kiện | Tin bot (mục 7.5) |
|---|---|---|---|
| (tạo) → Đang làm | PM | | Card "Task mới" vào group, @tag nhân sự |
| Đang làm / Cần sửa → Chờ duyệt | Nhân sự được giao | Có **ít nhất 1 bằng chứng** (link hoặc file) | Card "Đã nộp" vào group, @tag PM |
| Chờ duyệt → Hoàn thành | PM | | Card "✅ Hoàn thành" vào group, @tag nhân sự |
| Chờ duyệt → Cần sửa | PM | **Bắt buộc góp ý.** Tuỳ chọn gia hạn kèm lý do | Card ngắn vào group + góp ý chi tiết nhắn riêng cho nhân sự |
| bất kỳ → Đã huỷ | PM | Bắt buộc lý do | Card vào group |
| Hoàn thành → Đang làm | PM ("Mở lại") | Bắt buộc lý do. Hiếm dùng | Card vào group |

**Tick Completed trên Lark (khi chạy Lark thật):**
- Nhân sự tick Completed trên Lark được hệ thống hiểu là **nộp kết quả**. Task chuyển sang Chờ duyệt, nhưng bằng chứng còn trống. Bot nhắn riêng cho nhân sự: *"Bạn đã đánh dấu hoàn thành MT35-07 trên Lark. Thêm bằng chứng tại [link] để PM duyệt."* Trong lúc thiếu bằng chứng, PM thấy cờ **"Chưa có bằng chứng"**.
- PM bấm Yêu cầu sửa thì hệ thống **bỏ tick Completed trên Lark** và đổi deadline trên Lark nếu có gia hạn. (U: bot là người tạo task nên về lý thuyết có quyền, nhưng chưa kiểm trên Lark thật)

### 6.4 Nộp kết quả và duyệt
- **Form nộp** (nhân sự):
  - Bằng chứng gồm **link** (nhiều link) và/hoặc **file**. Mỗi file tối đa 20 MB (A). Định dạng: ảnh, PDF, Office, video ngắn.
  - Ghi chú cho PM.
  - Bắt buộc có ít nhất 1 link hoặc 1 file.
- **Màn hình duyệt** (PM), chia 2 cột:
  - Trái: Kết quả cần nộp, mô tả, deadline, lịch sử các lần nộp và các góp ý trước.
  - Phải: Bằng chứng của lần nộp này, ghi chú của nhân sự.
  - Hai nút: **Duyệt** · **Yêu cầu sửa**.
- **Yêu cầu sửa:**
  - Ô góp ý (bắt buộc): cần cải thiện gì, sửa gì.
  - Gia hạn: *Không gia hạn* / *Gia hạn đến ngày …*. Nếu gia hạn thì chọn lý do:
    - **Do yêu cầu thay đổi** (khách đổi brief, phạm vi tăng): deadline tính KPI **dời theo** deadline mới.
    - **Do kết quả chưa đạt**: deadline tính KPI **giữ nguyên deadline gốc**. Gia hạn chỉ để có thời gian sửa, không xoá việc trễ.
- **Lịch sử:** mọi lần nộp (thời điểm, bằng chứng, ghi chú) và mọi lần duyệt hoặc trả lại (người, thời điểm, góp ý, gia hạn) đều được giữ, không ghi đè.
- **Bằng chứng chỉ thành viên dự án, PM, CEO xem được.** File lưu ở Supabase Storage, bucket riêng có RLS.
- PM cũng gia hạn được khi task **đang làm**, không cần chờ nhân sự nộp. Áp dụng cùng 2 loại lý do.

### 6.5 Ba lớp trạng thái của task

Ba lớp độc lập với nhau:

| Lớp | Giá trị | Ai quyết định |
|---|---|---|
| **1 · Vòng đời** | Đang làm · Chờ duyệt · Cần sửa · Hoàn thành · Đã huỷ | Thao tác của người dùng (6.3) |
| **2 · Tiến độ tự báo** | Đúng tiến độ (`on_plan`) · Chậm (`behind`) · Bị chặn (`blocked`) · Chưa cập nhật · *(trống)* | Nhân sự trả lời câu hỏi tiến độ (7.2). Chỉ có nghĩa khi task đang ở Đang làm hoặc Cần sửa |
| **3 · Thời hạn** | Còn hạn · Sắp đến hạn · Quá hạn | Hệ thống tính theo deadline làm việc |

- "Sắp đến hạn" = task đang trong khoảng nhắc hạn của mức nhắc (7.1).
- **Bị chặn** bắt buộc ghi lý do. Trạng thái giữ nguyên cho tới khi nhân sự bấm **"Đã gỡ"**, hoặc PM bấm "Đã xử lý". Nhân sự cũng có thể tự báo Bị chặn bất cứ lúc nào, không cần chờ bot hỏi.

### 6.6 Màu sức khoẻ của task

Gộp 3 lớp thành **một màu**, lấy mức nặng nhất:

| Màu | Điều kiện |
|---|---|
| 🔴 **Cần can thiệp** | Quá hạn (chưa nộp) **hoặc** Bị chặn |
| 🟡 **Có nguy cơ** | Chậm · Chưa cập nhật · Cần sửa và còn ≤ 1 ngày tới deadline làm việc · Chờ duyệt nhưng chưa có bằng chứng |
| 🟢 **Ổn** | Đúng tiến độ, hoặc chưa tới mốc hỏi tiến độ |
| 🔵 **Chờ PM** | Chờ duyệt (đã có bằng chứng) |
| ✔ **Xong** | Hoàn thành |
| ⚪ **Huỷ** | Đã huỷ |

- Mỗi dòng task hiện **1 nhãn vòng đời + 1 chấm màu**. Rê chuột vào chấm màu thì thấy lý do, ví dụ "Bị chặn: chờ khách gửi logo".
- Màu lấy theo token trong DESIGN.md: `bad`, `warn`, `ok`, `brand`. Giữ quy tắc "màu trạng thái chỉ mang nghĩa".

---

## 7. Early warning, nhắc việc và tóm tắt

### 7.1 Mức nhắc theo thời lượng task

Thời lượng = deadline − ngày bắt đầu, tính theo ngày lịch. Ngưỡng 3 và 7 ngày là giả định (A), chỉnh sau pilot.

| Mức | Thời lượng | Hỏi tiến độ | Nhắc hạn | Quá hạn |
|---|---|---|---|---|
| **Ngắn** | ≤ 3 ngày | Không hỏi | D0 (sáng ngày deadline) | Mỗi ngày từ D+1 |
| **Vừa** | 4–7 ngày | Ở mốc 50% thời lượng | D-1, D0 | Mỗi ngày từ D+1 |
| **Dài** | ≥ 8 ngày | Ở mốc 50% và 75% | D-2, D-1, D0 | Mỗi ngày từ D+1 |

- Mốc hỏi tiến độ = ngày bắt đầu + làm tròn (thời lượng × 50%), tương tự cho 75%. Mốc rơi vào ngày không làm việc thì dời sang ngày làm việc kế tiếp (theo lịch làm việc trong Cài đặt).
- Thay cho mốc cố định D-3 / D-2 / D-1 của bản 1.5.
- PM đổi mức nhắc cho từng task được (ví dụ task 3 ngày nhưng rất quan trọng thì chọn mức Vừa).
- **Task ở trạng thái Cần sửa** chỉ nhắc D-1, D0 và quá hạn, tính theo deadline làm việc mới.
- **Trong lúc Chờ duyệt, bot ngừng nhắc nhân sự**, vì việc đang nằm ở PM.
- Giữ nguyên các nguyên tắc chống gửi trùng của bản 1.5 (V): mỗi task tối đa 1 tin nhắc mỗi ngày, gửi lỗi thì thử lại tối đa 5 lần.
- Nhắc hạn và quá hạn vẫn gửi cả cuối tuần như bản 1.5 (A). Hỏi tiến độ và tóm tắt chỉ gửi ngày làm việc.

### 7.2 Hỏi tiến độ
- Tới mốc hỏi, bot **nhắn riêng cho nhân sự** một card có 3 nút: **Đúng tiến độ · Chậm · Bị chặn**.
  - Chọn Bị chặn thì phải ghi lý do.
  - Card cũng có link "Nộp kết quả" nếu nhân sự đã xong sớm.
  - Gửi riêng, không gửi vào group, để group không bị nhiễu (A).
- **Chậm:** task chuyển vàng, hiện ở Tóm tắt hôm nay. Không nhắn PM ngay.
- **Bị chặn:** task chuyển đỏ, **nhắn riêng cho PM ngay** kèm lý do.
- **Không trả lời** trước 09:00 ngày làm việc kế tiếp: gắn cờ **Chưa cập nhật** (vàng). Không hỏi lại. Card cũ vẫn bấm được, bấm thì cờ mất.
- Nhân sự trả lời được cả trên web (Inbox), không bắt buộc qua Lark.
- Dùng lại logic `on_plan / behind / blocked` của module checkpoint cũ (V), chuyển từ Telegram sang card Lark.

### 7.3 Nhắc PM duyệt
- Task ở Chờ duyệt quá **1 ngày làm việc** (A): bot nhắn riêng cho PM **1 tin mỗi ngày**, liệt kê các task đang chờ.
- Thời gian chờ duyệt cũng hiện trên trang Chờ duyệt, task chờ lâu nhất xếp đầu.

### 7.4 Những gì thay thế nút "Chạy kiểm tra ngay"
- Nút này **không tạo report**. Nó chỉ chạy ngay lượt nhắc việc tự động thay vì chờ tới giờ hẹn (V).
- Bản 1.6:
  - Người dùng **không cần bấm gì**: trang Tóm tắt hôm nay luôn hiện số mới nhất.
  - Nút chỉ còn trong Admin để kiểm thử và demo.

### 7.5 Bảng tin bot

Kênh:
- **Group** = group Lark của dự án, @tag đúng người.
- **Riêng** = tin nhắn riêng của bot.
- Dự án chưa gắn group: mọi tin "Group" chuyển thành tin riêng cho PM (mục 5.2).

| Sự kiện | Kênh | Gửi cho | Nội dung chính | Thời điểm |
|---|---|---|---|---|
| Dự án mới được gắn group | Group | cả group | Mã, tên, PM, deadline | Ngay |
| Bot chưa có trong group của dự án | Riêng | PM | Hướng dẫn thêm bot, link dự án | Ngay, 1 lần |
| Task mới | Group | @nhân sự | Mã, tên, kết quả cần nộp, deadline | Ngay |
| Hỏi tiến độ | Riêng | nhân sự | 3 nút trả lời + link nộp | Mốc 50% / 75%, giờ nhắc |
| Báo Bị chặn | Riêng | PM | Task, lý do, link | Ngay |
| Nhắc hạn (D-2 / D-1 / D0 theo mức) | Group | @nhân sự | Mẫu card của CEO, đổi chữ "Task mẹ / Task con" thành "Dự án / Task" | Giờ nhắc (mặc định 09:00) |
| Quá hạn | Group | @nhân sự | Số ngày trễ | Giờ nhắc, mỗi ngày tới khi nộp |
| Nhân sự đã nộp | Group | @PM | "MT35-07 đã nộp, chờ duyệt" + link | Ngay |
| Tick Completed trên Lark nhưng thiếu bằng chứng | Riêng | nhân sự | Link thêm bằng chứng | Ngay |
| PM duyệt | Group | @nhân sự | "✅ MT35-07 hoàn thành" | Ngay |
| PM yêu cầu sửa | Group (ngắn) + Riêng (chi tiết) | @nhân sự | Group: "MT35-07 cần chỉnh sửa, hạn mới …". Riêng: toàn bộ góp ý | Ngay |
| Gia hạn khi task đang làm | Group | @nhân sự | Deadline cũ → mới | Ngay |
| Task chờ duyệt quá 1 ngày làm việc | Riêng | PM | Danh sách task đang chờ | 1 lần/ngày, giờ nhắc |
| Dự án hoàn thành | Group | cả group | Tổng số task, số đúng hạn | Ngay |
| Tóm tắt sáng | Riêng | PM | Mục 7.6 | 08:30 ngày làm việc |
| Tổng kết cuối ngày | Riêng | PM | Mục 7.6 | 17:30 ngày làm việc |

> **A:** Góp ý chi tiết khi yêu cầu sửa gửi **riêng** cho nhân sự, group chỉ nhận thông báo ngắn. Lý do: tránh góp ý công khai trước cả nhóm. Long có thể đổi sang gửi toàn bộ vào group.

### 7.6 Tóm tắt hôm nay và tổng kết cuối ngày

**Trang web "Tóm tắt hôm nay"** (PM, CEO chỉ xem):
- **Luôn là số mới nhất**, không có khái niệm reset. Một task vừa được nộp sẽ rời mục Quá hạn / Hôm nay và chuyển sang Chờ duyệt ngay khi tải lại trang.
- Mỗi dự án một khối. Dự án có vấn đề nặng nhất xếp đầu. Mỗi khối gồm:
  - Quá hạn
  - Đến hạn hôm nay
  - Chờ duyệt (kèm thời gian chờ lâu nhất)
  - Bị chặn (kèm lý do)
  - Chậm
  - Chưa cập nhật
  - Dự án đang ở trạng thái Có nguy cơ / Trễ
- Mỗi dòng bấm được để mở task.

**Tin Lark lúc 08:30 cho PM** (ngày làm việc):
- Là **ảnh chụp số liệu lúc gửi**, gửi 1 lần. Trong ngày có thay đổi thì **không gửi lại** bản tóm tắt.
- Nội dung rút gọn từ trang web, mỗi dự án một dòng, kèm link sang trang.
- Ngoài bản tóm tắt, chỉ những sự kiện PM phải làm gì đó mới có tin ngay (đã nộp, bị chặn).

**Tin Lark tổng kết cuối ngày lúc 17:30 cho PM** (Long đã duyệt, Admin tắt được):
- Hôm nay xong gì: số task được duyệt, số task được nộp.
- Còn bao nhiêu task chờ duyệt.
- **Ngày mai** task nào đến hạn.
- Task nào sẽ thành quá hạn nếu hôm nay chưa nộp.

**Lưu lịch sử:** mỗi bản tóm tắt đã gửi được lưu lại, xem ở trang Báo cáo.

Giờ gửi (08:30 / 17:30) chỉnh trong Admin → Kết nối Lark.

---

## 8. Calendar

### 8.1 Tham chiếu thiết kế
Lấy UI/UX từ file Figma **AgendalV1 Prototype (Copy)**, trang "07 Prototype":
- Web · 05 Calendar: Week `830:14076`, Day `830:14243`, Month `830:14418`, các trạng thái kéo thả `831:14602`…
- Mobile · 05 Calendar: 3 ngày, Tuần, Ngày, Tháng `832:15271`–`832:15470`

**Lấy từ Agendal:**
- Tiêu đề tháng cỡ lớn.
- Cụm điều khiển ‹ › **Hôm nay** và bộ chuyển chế độ xem dạng segmented.
- Lưới tháng 7 cột, mỗi ô có chip.
- **Chip đặc** cho mốc lớn, **chip viền** cho task (giống quy ước Event filled / Task outlined của Agendal).
- Chấm màu theo dự án, giống danh sách Projects ở sidebar Agendal.
- Panel bên phải chứa thông tin phụ ("Unscheduled" / "This week").
- Kéo chip sang ngày khác để đổi ngày.
- Chú thích ở chân lịch.

**Không lấy:**
- **Lưới giờ (08:00–19:00)**: task của Go Media chỉ có deadline theo ngày, không có khung giờ.
- Gợi ý AI ("Suggested", "Find time").
- Thẻ "14 h planned".
- Font serif của Agendal: Ops Hub giữ font Archivo và màu navy theo DESIGN.md.

### 8.2 Calendar của nhân sự
- **Chế độ xem:** Tuần (mặc định) · Tháng.
  - **Tuần:** 7 cột ngày, không có lưới giờ. Task nằm ở cột ngày deadline, xếp chồng theo màu sức khoẻ.
  - **Tháng:** lưới như Agendal Month.
- **Hiện gì:**
  - Task của tôi, dạng chip viền, có chấm màu dự án và viền trái theo màu sức khoẻ.
  - Deadline các dự án tôi tham gia, dạng chip đặc.
  - Mốc hỏi tiến độ, dạng dấu nhỏ.
- **Panel phải "Tuần này":**
  - Số task đến hạn, số task quá hạn.
  - Các mốc hỏi tiến độ sắp tới.
  - Chú thích màu dự án.
- **Thao tác:**
  - Bấm chip mở chi tiết task (nộp kết quả, trả lời tiến độ).
  - **Nhân sự không kéo thả được**, vì không có quyền đổi deadline.
- Bộ lọc: theo dự án.

### 8.3 Calendar của PM
- **Chế độ xem:** Tháng (mặc định) · Tuần theo người.
  - **Tháng:** mọi task của các dự án PM phụ trách (chip viền) và deadline dự án (chip đặc). Ô ngày có quá nhiều task thì gom thành "+5 task", bấm để xem hết.
  - **Tuần theo người:** mỗi hàng là một nhân sự, mỗi cột là một ngày. Ô hiện các task đến hạn. **Ô nào nhiều task được tô đậm hơn**, để thấy ai đang bị dồn việc trước khi giao thêm.
- **Bộ lọc:** dự án · nhân sự · màu sức khoẻ · ẩn task đã xong.
- **Panel phải:**
  - Chờ duyệt (số lượng + link).
  - Task đỏ trong tuần.
  - Deadline dự án trong 14 ngày tới.
- **Thao tác:**
  - Bấm chip mở chi tiết.
  - **Kéo task sang ngày khác = gia hạn.** Thả xuống thì mở hộp thoại gia hạn, bắt buộc chọn lý do (mục 6.4). Không có lý do thì không đổi.
  - Kéo sang ngày sau deadline dự án thì bị chặn, kèm thông báo.
  - Kéo deadline dự án: đổi deadline dự án, bắt buộc lý do.
- CEO xem như PM nhưng không kéo thả được.

### 8.4 Trên điện thoại
- Theo Agendal Mobile: Tháng thu gọn thành **danh sách theo ngày** (agenda), Tuần thành 3 ngày.
- Không kéo thả trên điện thoại. Gia hạn làm trong chi tiết task.

---

## 9. KPI và Go Star

### 9.1 M1 (định nghĩa mới)
- **Deadline tính KPI** = deadline gốc. Chỉ thay đổi khi PM gia hạn với lý do **"Do yêu cầu thay đổi"**.
- **Đúng hạn:** task được duyệt, và lần nộp được duyệt có **thời điểm nộp ≤ ngày deadline tính KPI** (theo ngày, múi giờ công ty).
  - Tính theo **lúc nhân sự nộp**, không theo lúc PM duyệt. PM duyệt chậm thì nhân sự không bị tính trễ.
- **Trễ:** task được duyệt nhưng lần nộp được duyệt sau deadline tính KPI. **Hoặc** đã qua deadline tính KPI mà chưa có lần nộp nào được duyệt.
- **M1** = số task trễ / số task có deadline tính KPI nằm trong kỳ (không tính task đã huỷ và task chưa tới hạn).
- **Thay đổi so với 1.5:** bản 1.5 tính "hoàn thành" theo lúc tick Completed với mã hợp lệ (V). Số liệu showcase phải tạo lại theo định nghĩa mới.

### 9.2 Chỉ số phụ (hiện trên Báo cáo)
- Tỷ lệ task phải sửa ít nhất 1 lần.
- Thời gian duyệt trung bình (giờ làm việc).
- Tỷ lệ trả lời câu hỏi tiến độ.
- Số task bị chặn và thời gian bị chặn trung bình.
- Số lần gia hạn, chia theo lý do.

### 9.3 Go Star
- **Sao Task Completion:** mọi task đến hạn trong tháng đã được **duyệt**. Thay cho điều kiện "Completed với mã hợp lệ".
- **Sao Deadline:** tỷ lệ trễ của người đó dưới 20%, theo định nghĩa M1 mới.
- **Sao Work Quality:** PM vẫn chấm 1–5 như cũ. Màn hình chấm hiện thêm **số task phải sửa** của người đó trong tháng để làm căn cứ.
- Các tiêu chí khác giữ nguyên bản 1.4.

---

## 10. Tích hợp Lark

### 10.1 Lệnh bot (chỉ PM dùng được; người khác gõ thì bot từ chối kèm giải thích)
```
/taomoi duan <mã> | <tên dự án> | <deadline>
  → gõ trong group của dự án thì tự gắn group đó
/taomoi task <mã dự án> | <tên task> | @người thực hiện | <deadline> | <kết quả cần nộp>
  → mã task do bot tự sinh, hiện trong bản xem trước
```
- Bot vẫn hiện bản xem trước với nút "Xác nhận tạo" như bản 1.5 (V).
- Lệnh cũ `/taomoi me`, `/taomoi con` vẫn được nhận nhưng bot nhắc dùng lệnh mới.
- **A:** Nhân sự nộp kết quả trên web, hoặc tick Completed trên Lark rồi thêm bằng chứng trên web. Không có lệnh nộp qua chat.

### 10.2 Đồng bộ
- Tần suất giữ 15 phút như bản 1.5 (V). Mỗi lượt đồng bộ:
  - Task: deadline, người thực hiện, trạng thái Completed.
  - Thành viên group dự án.
- Nhận diện task bằng `lark_guid`, không đọc mã từ tiêu đề nữa.
- Thay đổi trên Lark xung đột với quy tắc của Ops Hub thì **Ops Hub là nguồn đúng**:
  - Ai đổi deadline trên Lark vượt deadline dự án: lượt đồng bộ ghi lại deadline cũ và báo PM.
  - Ai đổi người thực hiện trên Lark: được chấp nhận nếu người đó là thành viên dự án. Nếu không thì báo PM.

### 10.3 Quyền Lark cần thêm (U: kiểm khi có Lark App thật)
- Liệt kê các group mà bot đang ở.
- Đọc thành viên group.
- Gửi tin nhắn riêng cho người dùng.
- Bỏ tick Completed và đổi deadline của task do bot tạo.
- Card có nút bấm cho phần hỏi tiến độ (bản 1.5 đã dùng callback của card, V).

### 10.4 Chế độ mô phỏng
Mọi luồng trong tài liệu này phải chạy được ở chế độ mô phỏng (chưa có Lark App):
- Group, thành viên, tin nhắn riêng đều mô phỏng.
- Tin riêng hiện trong "Lịch sử nhắc việc", có nhãn "Riêng".
- PM chọn group giả và thành viên bằng tay.

---

## 11. Tiêu chí chấp nhận

**Điều hướng và quyền**
1. Người dùng vai trò `staff`, `account` hoặc `ecom_exec` đăng nhập thì vào `/inbox`, sidebar đúng mục 4.1. Không thấy Tóm tắt hôm nay, Chờ duyệt, Nhân sự.
2. PM đăng nhập thì vào `/tom-tat`, sidebar đúng mục 4.2.
3. CEO mở trang dự án thì không có nút tạo, giao, duyệt, kéo thả.
4. Nhân sự không phải thành viên dự án MT35 thì không thấy MT35. Gọi API thẳng cũng bị RLS chặn.
5. Không vai trò nào (kể cả Admin) chuyển task sang Hoàn thành mà không qua bước PM duyệt.

**Dự án và mã**
6. PM nhập mã `mt 35` thì hệ thống lưu `MT35`. Nhập trùng mã đã có thì bị từ chối kèm thông báo.
7. Dự án MT35 đã có 7 task. Task mới tự nhận mã `MT35-08`. Huỷ `MT35-08` rồi tạo task mới thì task mới nhận `MT35-09`.
8. Không có group nào mà bot đang ở có tên chứa "MT35": dự án tạo được, hiện banner "Bot chưa có trong group", PM nhận đúng 1 tin riêng.
9. Thêm bot vào group "MT35 · …" rồi bấm Kiểm tra lại: dự án gắn được group, banner biến mất.
10. Mọi task đã được duyệt: dự án tự chuyển sang Hoàn thành và bot báo vào group.

**Vòng đời task**
11. Nhân sự bấm Hoàn thành mà không có link hay file: bị chặn.
12. Có bằng chứng: task sang Chờ duyệt, group nhận card "đã nộp" @tag PM, bot **ngừng** nhắc nhân sự.
13. PM bấm Yêu cầu sửa mà không có góp ý: bị chặn.
14. Yêu cầu sửa, gia hạn với lý do "Do kết quả chưa đạt": deadline làm việc đổi, deadline tính KPI giữ nguyên. Lần nộp được duyệt sau deadline gốc thì task tính **trễ**.
15. Gia hạn với lý do "Do yêu cầu thay đổi": task nộp trước deadline mới thì tính **đúng hạn**.
16. Nộp trước deadline, PM duyệt sau deadline 2 ngày: tính **đúng hạn**.
17. Lịch sử task hiện đủ mọi lần nộp và mọi góp ý theo thứ tự thời gian.

**Early warning và tin nhắn**
18. Task bắt đầu 01/12, deadline 03/12 (mức Ngắn): không có tin hỏi tiến độ, nhắc đúng 1 lần ngày 03/12, quá hạn thì nhắc từ 04/12.
19. Task 01/12 → 15/12 (14 ngày, mức Dài): hỏi tiến độ ngày 08/12 (mốc 50%). Mốc 75% rơi vào 12/12 (thứ Bảy) nên dời sang 14/12 (thứ Hai). Nhắc hạn ngày 13, 14, 15/12.
20. Nhân sự chọn Bị chặn: task chuyển đỏ, PM nhận tin riêng ngay, kèm lý do.
21. Không trả lời câu hỏi tiến độ tới 09:00 ngày làm việc kế tiếp: task gắn cờ Chưa cập nhật (vàng).
22. Task chờ duyệt quá 1 ngày làm việc: PM nhận 1 tin nhắc mỗi ngày, không nhiều hơn.
23. Tin 08:30 không bị gửi lại khi trong ngày có task được nộp. Trang Tóm tắt hôm nay phản ánh thay đổi ngay khi tải lại.
24. Tin tổng kết 17:30 liệt kê đúng các task đến hạn ngày mai. Admin tắt thì không gửi.

**Calendar**
25. Nhân sự kéo chip task: không có tác dụng.
26. PM kéo task sang ngày khác: mở hộp thoại gia hạn. Huỷ hộp thoại thì task về chỗ cũ. Kéo quá deadline dự án thì bị chặn.
27. Tuần theo người: ô có nhiều task được tô đậm hơn ô ít task.

**Mô phỏng**
28. Tiêu chí 1–27 chạy được ở chế độ mô phỏng. Tin "riêng" hiện trong Lịch sử nhắc việc với nhãn "Riêng".

---

## 12. Ngoài phạm vi bản 1.6 (backlog)

| Mục | Ghi chú |
|---|---|
| **Nối Báo giá → Dự án → Task** | Trạng thái "Khách đã chốt", tạo dự án từ báo giá, một dự án nhiều báo giá, tạo task từ dòng báo giá. Chỉ Account/PM/CEO thấy số tiền. Plan đã bàn ngày 21/11 |
| Người theo dõi task (follower) | |
| Tiến độ tính theo thời lượng task | Hiện tính theo số task |
| Báo cáo tuần cho CEO | Sáng thứ Hai, kèm xu hướng M1 |
| Đồng bộ file đính kèm lên Lark | U: chưa kiểm API attachment của Lark Task |
| Nhắc PM theo deadline dự án riêng | Hiện đã có qua trạng thái dự án và tóm tắt |
| Xoá hẳn module checkpoint cũ | Bản 1.6 chỉ ẩn |

---

## 13. Giả định và câu hỏi mở

| # | Nội dung | Nhãn | Ai trả lời |
|---|---|---|---|
| 1 | Ngưỡng mức nhắc 3 / 7 ngày, mốc 50% / 75% | A | Chỉnh sau pilot |
| 2 | Ngưỡng 25 điểm % cho dự án "Có nguy cơ" | A | Chỉnh sau pilot |
| 3 | PM có 1 ngày làm việc để duyệt trước khi bị nhắc | A | Long / CEO |
| 4 | Góp ý chi tiết gửi riêng, group chỉ nhận thông báo ngắn | A | Long |
| 5 | Hỏi tiến độ gửi riêng cho nhân sự, không vào group | A | Long |
| 6 | Nhắc hạn vẫn gửi cuối tuần như bản 1.5 | A | CEO |
| 7 | Bỏ quy tắc kiểm mã khi hoàn thành (brief A2.3 có yêu cầu) | P → cần CEO xác nhận | CEO |
| 8 | Bot liệt kê được group, đọc được thành viên, nhắn riêng, bỏ tick Completed | U | Kiểm khi có Lark App |
| 9 | File bằng chứng tối đa 20 MB | A | Long |
| 10 | Nhiều PM: mỗi PM chỉ duyệt dự án mình phụ trách | A | Long |

---

## 14. Thứ tự triển khai

Mỗi phần làm xong đều có test và deploy lên Pilot trước khi sang phần tiếp theo.

1. **Nền tảng:** hai không gian làm việc, sidebar, chuyển hướng theo vai trò, đổi thuật ngữ, ẩn module cũ, chuyển nút kiểm thử vào Admin.
2. **Dự án:** tạo dự án, quy tắc mã, gắn group và kiểm tra bot, thành viên, trạng thái và thanh tiến độ.
3. **Task:** mã tự sinh, kết quả cần nộp, nộp kèm bằng chứng (link + file), duyệt / yêu cầu sửa / gia hạn, lịch sử, tin bot liên quan.
4. **Inbox, Chờ duyệt, Tóm tắt hôm nay.**
5. **Early warning:** mức nhắc theo thời lượng, hỏi tiến độ, màu sức khoẻ, nhắc PM duyệt, tin 08:30 và 17:30.
6. **Calendar** cho hai góc nhìn.
7. **KPI và Go Star** theo định nghĩa mới. Trang Nhân sự.
8. **Dọn dẹp:** tạo lại dữ liệu showcase theo format mới (ghi vào `seed_registry`), unit test, RLS test, e2e đi trọn luồng: tạo dự án → giao task → hỏi tiến độ → nộp → yêu cầu sửa → nộp lại → duyệt → dự án tự đóng.

Database thiết kế dần theo từng phần, chỉ thêm, không xoá (quyết định của Long ngày 22/11).

---

## 15. Bổ sung 1.6.1 (23/11/2026, Long)

### 15.1 Lời mời tham gia dự án
- PM **mời** nhân sự vào dự án (khi tạo dự án, hoặc ở tab Thành viên). Bot nhắn riêng cho người được mời; lời mời hiện ở đầu **Inbox** và được tính vào số đếm trên sidebar.
- Người được mời chọn **Tham gia** hoặc **Từ chối**. Từ chối **bắt buộc ghi lý do**.
- Cả hai câu trả lời đều được bot nhắn riêng cho PM. Lời mời bị từ chối (kèm lý do) và lời mời chưa trả lời hiện ở **Tóm tắt hôm nay** và tab **Thành viên**; PM có thể **Mời lại**.
- **Chỉ giao task được cho người đã tham gia.** Người đang được mời chỉ thấy tên, khách hàng, thời gian và PM của dự án; chưa thấy task.
- Người có trong group Lark của dự án (khi chạy Lark thật) và người được giao task qua lệnh bot tự là thành viên đã tham gia.

### 15.2 Ngày của task
- Ngày bắt đầu task **không được trước ngày bắt đầu dự án**. Deadline vẫn không được sau deadline dự án (mục 6.1).
- Mặc định ngày bắt đầu task = ngày bắt đầu dự án hoặc hôm nay, lấy ngày muộn hơn.

### 15.3 Tiêu chí chấp nhận bổ sung
29. Nhân sự được mời vào KV20 thấy lời mời trong Inbox nhưng không mở được dự án KV20 cho tới khi bấm Tham gia.
30. Bấm Từ chối mà không có lý do: bị chặn. Có lý do: PM nhận tin riêng kèm lý do, tab Thành viên hiện "Từ chối · Lý do: …".
31. Ô Người thực hiện khi tạo task chỉ liệt kê thành viên đã tham gia.
32. Dự án bắt đầu 01/12: chọn ngày bắt đầu task 30/11 thì bị chặn với thông báo nêu ngày 01/12/2026.

## 16. Bổ sung 1.6.2 (23/11/2026, Long)

### 16.1 Calendar
- Thanh điều hướng: **‹ [kỳ đang xem] ›**. Ở giữa hai mũi tên là tháng/năm (xem Tháng) hoặc khoảng ngày (xem Tuần, VD "23 – 29/11/2026"). Nút **Hôm nay** chuyển sang cạnh nút chọn chế độ xem; nút mờ khi đang xem kỳ có hôm nay.
- Kéo thả (chỉ PM của dự án): khi kéo qua một ô ngày, ô đó được tô viền và hiện **bản xem trước** của task (hoặc deadline dự án) ở đúng vị trí nó sẽ nằm. Các task sẵn có trong ô bị **đẩy xuống** có hiệu ứng trượt; task bị đẩy quá số dòng hiển thị chuyển vào "+N mục". Task gốc mờ đi trong lúc kéo.
- Ô không thả được hiện đỏ kèm lý do ngay trong bản xem trước: ngày đã qua; sau deadline dự án (với task); trước ngày bắt đầu dự án, hoặc còn task có deadline sau ngày đó (với deadline dự án). Thả vào ô này không mở hộp gia hạn.
- Xem "Tuần theo người": chỉ thả được trong hàng của người đang làm task (kéo chỉ đổi ngày, không đổi người).

### 16.2 Lý do gia hạn (thay mục 6.4 về cách hiển thị, giữ nguyên quy tắc)
Hai lựa chọn hiện dạng thẻ, mỗi thẻ ghi rõ hệ quả lên **deadline tính KPI**:

| Lựa chọn | Khi nào chọn | Deadline tính KPI |
|---|---|---|
| **Yêu cầu thay đổi** | Khách/PM đổi brief, thêm việc, chờ khách gửi tài liệu hoặc duyệt. Lỗi không nằm ở người làm. | Dời theo deadline mới. Không tính trễ. |
| **Người làm cần thêm thời gian** | Người làm chưa kịp, hoặc kết quả chưa đạt phải làm lại. | Giữ ngày cũ. Nộp sau ngày này vẫn tính trễ trong Go Star. |

- Task đã quá hạn khi gia hạn: hiện cảnh báo "Gia hạn chỉ dời ngày làm việc; nếu chọn Người làm cần thêm thời gian, task vẫn bị tính trễ".
- Đổi deadline dự án dùng cùng hai lựa chọn; deadline từng task không tự đổi theo.

### 16.3 Trang Dự án (PM)
- Thêm bộ lọc **Của tôi / PM khác / Tất cả** (kèm số lượng), độc lập với bộ lọc trạng thái (Đang chạy, Trễ/có nguy cơ, Đã xong, Mọi trạng thái).
- "Tất cả" chia hai phần: **Dự án của tôi** (thao tác được) và **Dự án của PM khác** (nhãn "Chỉ xem"), phần sau nhóm theo từng PM.
- CEO/Admin xem mọi dự án, nhóm theo PM.

### 16.4 Go Star: số liệu khi chấm điểm
Hộp chấm điểm một nhân sự hiện số liệu tháng đó (tính theo deadline tính KPI, giống bảng xếp hạng): số task trong tháng; đúng hạn/đã chấm; % trễ (nộp trễ + quá hạn chưa nộp); duyệt ngay lần đầu và số lần bị trả về sửa; số lần gia hạn theo từng lý do; số lần trả lời hỏi tiến độ và số lần báo chậm/bị chặn. Có danh sách task (mã, deadline KPI, kết quả, số lần nộp, số lần gia hạn), bấm mở task ở tab mới. Ô Work Quality ghi sẵn "x/y task duyệt ngay lần đầu, z lần trả về sửa" để tham khảo.

### 16.5 Sửa lỗi
- Hộp từ chối lời mời (và mọi hộp thoại): gõ một ký tự làm con trỏ nhảy lên nút X. Nguyên nhân: hộp thoại đặt lại tiêu điểm mỗi lần màn hình vẽ lại. Đã sửa: chỉ đặt tiêu điểm một lần khi mở, vào ô nhập đầu tiên.

### 16.6 Tiêu chí chấp nhận bổ sung
33. Kéo MT35-03 qua ô 25/11 đang có 3 task: ô 25/11 tô viền xanh, bản xem trước MT35-03 nằm đầu nhóm task, các task kia trượt xuống, task thứ ba vào "+1 mục".
34. Kéo task qua ngày đã qua hoặc sau deadline dự án: ô đỏ, bản xem trước ghi lý do; thả ra không mở hộp gia hạn.
35. Trong hộp gia hạn, chọn "Người làm cần thêm thời gian" hiện "Deadline tính KPI giữ: <ngày cũ>"; chọn "Yêu cầu thay đổi" hiện "dời theo: <ngày mới>".
36. Hộp từ chối lời mời: gõ liên tục một câu, toàn bộ chữ vào ô Lý do.
37. PM vào Dự án → Tất cả: thấy hai phần tách biệt; dự án của PM khác có nhãn "Chỉ xem" và nhóm theo tên PM.
38. Go Star → Chấm điểm một nhân sự: thấy 6 ô số liệu và danh sách task của tháng trước khi nhập điểm.
