// Prototype showcase data for the Pilot project (BC26 presentation).
// Builds people, a fuller price library, 19 history quotes, the quotes of the pilot weeks and S1 Lark
// tasks with their reminder history, using the app's own domain rules (band check, totals, working
// hours, Lark reminder decisions), and prints one SQL script. Every row it creates is listed in
// public.seed_registry so supabase/setup/clear_sample_data.sql can remove it before the real pilot.
// All names of people and clients are invented.
//
//   npx tsx tools/showcase/generate.ts > /tmp/showcase.sql
import { randomUUID } from 'node:crypto';
import {
  addWorkingHours,
  bandCheck,
  completionCheck,
  completionMessage,
  decideLarkAction,
  DEFAULT_BAND_RULES,
  DEFAULT_LARK_SCHEDULE,
  larkTitle,
  publicBand,
  quoteTotals,
  reminderMessage,
  workingHoursBetween,
  type BandLevel,
  type LarkTracked,
  type WorkCalendar,
} from '../../src/domain';

const TZ = 'Asia/Ho_Chi_Minh';
const CAL: WorkCalendar = { timeZone: TZ, workDays: [1, 2, 3, 4, 5], blocks: [{ start: '08:00', end: '12:00' }, { start: '13:30', end: '17:30' }], holidays: ['2026-09-02', '2027-01-01'] };
const NOW = Date.parse(process.env.SHOWCASE_NOW ?? '2026-11-09T09:50:00+07:00');
const vn = (d: string, hm: string) => Date.parse(`${d}T${hm}:00+07:00`);
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;

const registry: [string, string][] = [];
const reg = (table: string, id: string) => registry.push([table, id]);

// ------------------------------------------------------------------------------------ people -----
const ADMIN = 'dfca4735-e960-4163-af03-8d34940bff63'; // Long's admin account (signs as Giám đốc)
interface Person { id: string; email: string; name: string; role: string; isNew: boolean }
const P: Record<string, Person> = {
  khang: { id: '9dbd2fd5-ecbf-4b22-b5bb-ae821e395927', email: 'khang.tm@gomedia.local', name: 'Trần Minh Khang', role: 'account', isNew: false },
  ha: { id: 'ee709351-9cbb-4db5-91cc-edfb59229f05', email: 'ha.lt@gomedia.local', name: 'Lê Thu Hà', role: 'account', isNew: false },
  ngoc: { id: '838129ab-7698-4c9a-bc43-cd945485e53a', email: 'ngoc.nb@gomedia.local', name: 'Nguyễn Bảo Ngọc', role: 'staff', isNew: false },
  phuoc: { id: '78c9d5f1-7fe6-4c73-a43f-5663d68fab2d', email: 'phuoc.dh@gomedia.local', name: 'Đặng Hữu Phước', role: 'staff', isNew: false },
  kiet: { id: 'ed88b8ac-515a-489a-a324-bef8ba63757f', email: 'kiet.lt@gomedia.local', name: 'Lương Tuấn Kiệt', role: 'staff', isNew: false },
  duyen: { id: 'ac9c6aca-9862-457a-8033-85a8871a695f', email: 'duyen.pm@gomedia.local', name: 'Phan Mỹ Duyên', role: 'staff', isNew: false },
  qanh: { id: '5a1f0c3e-7b2d-4e61-9a8c-2f4b6d8e1a01', email: 'anh.vq@gomedia.local', name: 'Võ Quỳnh Anh', role: 'pm', isNew: true },
  thinh: { id: '5a1f0c3e-7b2d-4e61-9a8c-2f4b6d8e1a02', email: 'thinh.hd@gomedia.local', name: 'Hồ Đức Thịnh', role: 'ecom_exec', isNew: true },
  huy: { id: '5a1f0c3e-7b2d-4e61-9a8c-2f4b6d8e1a03', email: 'huy.tg@gomedia.local', name: 'Trịnh Gia Huy', role: 'staff', isNew: true },
  truc: { id: '5a1f0c3e-7b2d-4e61-9a8c-2f4b6d8e1a04', email: 'truc.mt@gomedia.local', name: 'Mai Thanh Trúc', role: 'staff', isNew: true },
};

// ----------------------------------------------------------------------------------- library -----
type Kind = 'service' | 'pass_through';
interface Lib { id: string; code: string; name: string; unit: string; group: string; price: number; kind: Kind; description: string | null; isNew: boolean }
const G_EVENT = 'Sự kiện & sản xuất', G_WEB = 'Website & SEO', G_ADS = 'Quảng cáo', G_CONTENT = 'Kênh nội dung & social';
const G_KOC = 'KOL/KOC & Influencer', G_ECOM = 'Thương mại điện tử', G_DESIGN = 'Thiết kế & thương hiệu';
// The CEO's 23 items already on Pilot (codes kept); descriptions are added where they had none.
const EXISTING: [string, string, string, string, number, Kind, string][] = [
  ['SK-01', 'Gói chụp hình sự kiện', 'gói', G_EVENT, 10_500_000, 'service', 'Chụp toàn bộ chương trình, bàn giao ảnh đã chỉnh màu'],
  ['SK-02', 'Gói quay sự kiện', 'gói', G_EVENT, 10_000_000, 'service', 'Quay đa góc, dựng clip tổng hợp'],
  ['SK-03', 'Gói flycam', 'gói', G_EVENT, 5_000_000, 'service', 'Quay toàn cảnh từ trên cao'],
  ['SK-04', 'Thuê camera', 'cam/ngày', G_EVENT, 2_700_000, 'service', 'Máy quay 4K kèm chân máy và thẻ nhớ'],
  ['SK-05', 'Thuê mic không dây', 'mic/ngày', G_EVENT, 450_000, 'service', 'Mic cài áo hoặc mic cầm tay, kèm pin dự phòng'],
  ['SK-06', 'Camera operator', 'người/ngày', G_EVENT, 700_000, 'service', 'Người quay theo ca 8 giờ'],
  ['SK-07', 'AI concept photography', 'concept', G_EVENT, 3_000_000, 'service', 'Ảnh concept dựng bằng AI theo nhận diện thương hiệu'],
  ['WS-01', 'Thiết kế website WordPress (Professional)', 'trọn gói', G_WEB, 28_000_000, 'service', 'Tối đa 10 trang, responsive, bàn giao quản trị'],
  ['WS-02', 'Landing page', 'trang', G_WEB, 5_000_000, 'service', 'Một trang chiến dịch, tích hợp form và Zalo'],
  ['WS-03', 'Chăm sóc website và SEO (Growth)', 'tháng', G_WEB, 8_500_000, 'service', 'Cập nhật nội dung, sao lưu, tối ưu tốc độ và từ khoá'],
  ['WS-04', 'SEO Google Maps', 'tháng', G_WEB, 9_500_000, 'service', 'Tối ưu Google Business Profile và đánh giá'],
  ['WS-05', 'SEO website tổng thể (khoảng 170 bài)', 'tháng', G_WEB, 10_500_000, 'service', 'Nghiên cứu từ khoá, onpage và bài viết chuẩn SEO'],
  ['QC-01', 'Phí quản lý Meta Ads', 'tháng', G_ADS, 4_000_000, 'service', 'Lên chiến dịch, tối ưu hằng ngày, báo cáo tuần'],
  ['QC-02', 'Phí quản lý Yandex Ads', 'tháng', G_ADS, 4_500_000, 'service', 'Quảng cáo tiếp cận khách Nga'],
  ['QC-03', 'Phí quản lý Google Ads', 'tháng', G_ADS, 4_500_000, 'service', 'Search, Display và Performance Max'],
  ['QC-04', 'Ngân sách Meta Ads (chi hộ)', 'tháng', G_ADS, 16_000_000, 'pass_through', 'Nạp trực tiếp vào tài khoản quảng cáo của khách'],
  ['QC-05', 'Ngân sách Yandex Ads (chi hộ)', 'tháng', G_ADS, 25_000_000, 'pass_through', 'Nạp trực tiếp vào tài khoản quảng cáo của khách'],
  ['QC-06', 'Ngân sách Google Ads (chi hộ)', 'tháng', G_ADS, 15_000_000, 'pass_through', 'Nạp trực tiếp vào tài khoản quảng cáo của khách'],
  ['KN-01', 'Quản trị fanpage và nội dung social', 'tháng', G_CONTENT, 10_000_000, 'service', '20 bài mỗi tháng, trả lời bình luận và tin nhắn'],
  ['KN-02', 'Sản xuất video TikTok', 'video', G_CONTENT, 3_000_000, 'service', 'Kịch bản, quay và dựng video 30–60 giây'],
  ['KN-03', 'Setup kênh YouTube', 'gói', G_CONTENT, 7_000_000, 'service', 'Nhận diện kênh, playlist và tối ưu mô tả'],
  ['KN-04', 'Vận hành kênh YouTube', 'tháng', G_CONTENT, 9_000_000, 'service', '4 video dài và 8 Shorts mỗi tháng'],
  ['KN-05', 'Bài content Telegram', 'bài', G_CONTENT, 250_000, 'service', 'Bài ngắn kèm ảnh cho kênh Telegram'],
];
const ADDED: [string, string, string, string, number, Kind, string][] = [
  ['SK-08', 'Quay TVC ngắn 30 giây', 'video', G_EVENT, 25_000_000, 'service', 'Kịch bản, ekip 6 người, 1 ngày quay, dựng và chỉnh màu'],
  ['SK-09', 'Dựng video highlight sự kiện (2–3 phút)', 'video', G_EVENT, 3_500_000, 'service', 'Dựng từ tư liệu quay, nhạc bản quyền, 2 lần chỉnh sửa'],
  ['SK-10', 'Livestream sự kiện đa camera', 'buổi', G_EVENT, 12_000_000, 'service', '3 camera, bàn trộn hình, phát lên Facebook và YouTube'],
  ['SK-11', 'MC sự kiện', 'người/buổi', G_EVENT, 3_000_000, 'service', 'MC song ngữ Việt – Anh'],
  ['SK-12', 'Thuê đèn studio', 'bộ/ngày', G_EVENT, 1_200_000, 'service', 'Bộ 3 đèn LED kèm softbox'],
  ['WS-06', 'Website bán hàng WooCommerce', 'trọn gói', G_WEB, 38_000_000, 'service', 'Giỏ hàng, thanh toán online, đồng bộ tồn kho cơ bản'],
  ['WS-07', 'Viết bài chuẩn SEO', 'bài', G_WEB, 350_000, 'service', '1.200–1.500 chữ, có ảnh và liên kết nội bộ'],
  ['WS-08', 'Hosting và tên miền (chi hộ)', 'năm', G_WEB, 2_500_000, 'pass_through', 'Đăng ký đứng tên khách hàng'],
  ['WS-09', 'Audit SEO kỹ thuật website', 'báo cáo', G_WEB, 4_000_000, 'service', 'Kiểm tra tốc độ, index, lỗi kỹ thuật và đề xuất sửa'],
  ['QC-07', 'Phí quản lý TikTok Ads', 'tháng', G_ADS, 4_500_000, 'service', 'Chiến dịch chuyển đổi và tăng tương tác video'],
  ['QC-08', 'Ngân sách TikTok Ads (chi hộ)', 'tháng', G_ADS, 15_000_000, 'pass_through', 'Nạp trực tiếp vào tài khoản quảng cáo của khách'],
  ['QC-09', 'Phí quản lý Zalo Ads', 'tháng', G_ADS, 3_500_000, 'service', 'Quảng cáo Zalo OA và tin nhắn'],
  ['QC-10', 'Ngân sách Zalo Ads (chi hộ)', 'tháng', G_ADS, 8_000_000, 'pass_through', 'Nạp trực tiếp vào tài khoản quảng cáo của khách'],
  ['QC-11', 'Setup tài khoản quảng cáo và tracking', 'gói', G_ADS, 2_500_000, 'service', 'Business Manager, Pixel, Conversion API, Google Tag'],
  ['QC-12', 'Thiết kế creative quảng cáo', 'bộ 5 mẫu', G_ADS, 3_500_000, 'service', 'Ảnh tĩnh và video ngắn theo từng tệp khách'],
  ['KN-06', 'Viết bài content fanpage', 'bài', G_CONTENT, 300_000, 'service', 'Bài kèm ảnh thiết kế theo khung có sẵn'],
  ['KN-07', 'Quay dựng video Reels/Shorts (≤ 60 giây)', 'video', G_CONTENT, 2_500_000, 'service', 'Quay tại địa điểm khách, dựng và phụ đề'],
  ['KN-08', 'Quản trị kênh TikTok (12 video/tháng)', 'tháng', G_CONTENT, 15_000_000, 'service', 'Kịch bản, quay dựng, đăng và báo cáo tháng'],
  ['KN-09', 'Kịch bản video ngắn', 'kịch bản', G_CONTENT, 500_000, 'service', 'Hook, lời thoại và gợi ý cảnh quay'],
  ['KN-10', 'Chụp ảnh sản phẩm studio', '10 ảnh', G_CONTENT, 2_000_000, 'service', 'Nền trơn hoặc setup theo concept, đã retouch'],
  ['KO-01', 'Lên danh sách và đề xuất KOC/KOL', 'gói', G_KOC, 3_000_000, 'service', 'Lọc theo ngành, tệp follower và tỷ lệ tương tác'],
  ['KO-02', 'Quản lý chiến dịch KOC (đến 20 KOC)', 'chiến dịch', G_KOC, 8_000_000, 'service', 'Brief, gửi sản phẩm, duyệt nội dung, nhắc lịch đăng'],
  ['KO-03', 'Chi phí booking KOC micro (chi hộ)', 'video', G_KOC, 1_800_000, 'pass_through', 'KOC 10.000–50.000 follower, thanh toán theo hợp đồng KOC'],
  ['KO-04', 'Chi phí booking KOL tầm trung (chi hộ)', 'bài', G_KOC, 12_000_000, 'pass_through', 'KOL 100.000–500.000 follower'],
  ['KO-05', 'Seeding thảo luận trên cộng đồng', 'gói 50 bình luận', G_KOC, 1_500_000, 'service', 'Bình luận và review tự nhiên trên group, fanpage'],
  ['KO-06', 'Báo cáo hiệu quả chiến dịch KOC', 'báo cáo', G_KOC, 2_000_000, 'service', 'Lượt xem, tương tác, chi phí trên mỗi video'],
  ['TM-01', 'Setup gian hàng Shopee / TikTok Shop', 'gian hàng', G_ECOM, 6_000_000, 'service', 'Đăng ký, trang trí shop, đăng tối đa 30 sản phẩm'],
  ['TM-02', 'Vận hành gian hàng sàn TMĐT', 'tháng', G_ECOM, 12_000_000, 'service', 'Đăng sản phẩm, chương trình khuyến mãi, chăm sóc đánh giá'],
  ['TM-03', 'Thiết kế banner và ảnh sản phẩm cho sàn', 'bộ 10 ảnh', G_ECOM, 3_500_000, 'service', 'Banner shop, khung ảnh và ảnh bìa sản phẩm'],
  ['TM-04', 'Tối ưu listing sản phẩm trên sàn', '10 SKU', G_ECOM, 1_500_000, 'service', 'Tiêu đề, từ khoá, mô tả và thuộc tính'],
  ['TM-05', 'Livestream bán hàng TikTok', 'phiên 2 giờ', G_ECOM, 4_500_000, 'service', 'Host, kỹ thuật và kịch bản phiên live'],
  ['TM-06', 'Phí quản lý Shopee Ads / TikTok Shop Ads', 'tháng', G_ECOM, 4_000_000, 'service', 'Quảng cáo tìm kiếm và quảng cáo khám phá trên sàn'],
  ['TM-07', 'Ngân sách quảng cáo sàn (chi hộ)', 'tháng', G_ECOM, 10_000_000, 'pass_through', 'Nạp vào ví quảng cáo của gian hàng'],
  ['TM-08', 'Chiến dịch Mega Sale (11.11, 12.12)', 'chiến dịch', G_ECOM, 7_500_000, 'service', 'Kế hoạch voucher, flash sale và đăng ký chương trình sàn'],
  ['TK-01', 'Thiết kế logo và bộ nhận diện cơ bản', 'gói', G_DESIGN, 15_000_000, 'service', 'Logo, bảng màu, font, danh thiếp, bì thư'],
  ['TK-02', 'Brand guideline', 'bộ', G_DESIGN, 12_000_000, 'service', 'Quy chuẩn dùng logo, màu, chữ và ứng dụng'],
  ['TK-03', 'Thiết kế ấn phẩm in (standee, backdrop, tờ rơi)', 'ấn phẩm', G_DESIGN, 1_200_000, 'service', 'Bàn giao file in và file nguồn'],
  ['TK-04', 'Thiết kế bao bì sản phẩm', 'mẫu', G_DESIGN, 6_500_000, 'service', 'Hộp, túi hoặc nhãn; 2 phương án, 3 lần chỉnh sửa'],
  ['TK-05', 'Bộ template bài đăng social', 'bộ 10 mẫu', G_DESIGN, 3_000_000, 'service', 'File Canva hoặc Photoshop để khách tự dùng'],
  ['TK-06', 'Thiết kế menu nhà hàng, quán cà phê', 'bộ', G_DESIGN, 4_000_000, 'service', 'Menu bàn, menu treo và bản cho ứng dụng giao hàng'],
];
const LIB = new Map<string, Lib>();
for (const [code, name, unit, group, price, kind, description] of EXISTING) LIB.set(code, { id: '', code, name, unit, group, price, kind, description, isNew: false });
for (const [code, name, unit, group, price, kind, description] of ADDED) LIB.set(code, { id: randomUUID(), code, name, unit, group, price, kind, description, isNew: true });
const lib = (code: string) => {
  const l = LIB.get(code);
  if (!l) throw new Error(`unknown library code ${code}`);
  return l;
};

// ------------------------------------------------------------------------------------- quotes ----
const TERMS_DEFAULT = [
  'Đơn giá chưa gồm thuế GTGT; thuế GTGT được tách riêng ở phần tổng cộng.',
  'Thanh toán 60% tạm ứng trước ngày thực hiện, 40% khi bàn giao sản phẩm.',
  'Báo giá có hiệu lực trong 15 ngày kể từ ngày phát hành.',
  'Khách được sử dụng không giới hạn sản phẩm sau khi thanh toán đủ.',
];
const T_ADS = ['Thanh toán theo tháng; đối soát chi tiêu quảng cáo trong 5 ngày đầu tháng sau.', 'Ngân sách quảng cáo chi theo thực tế; tài khoản quảng cáo thuộc quyền sở hữu của khách.'];
const T_REVISE = 'Từ vòng chỉnh sửa thứ 3 tính phí 1.500.000 đ/vòng.';
const T_SITE = 'Khách hàng cung cấp mặt bằng, nhân sự tham gia và bộ nhận diện thương hiệu.';
const T_SHOOT = 'Thanh toán 50% khi ký hợp đồng, 30% sau buổi quay cuối, 20% sau nghiệm thu.';
const T_KOL = 'Chưa bao gồm chi phí booking KOL/KOC và diễn viên nổi tiếng.';

type L = [code: string, qty: number, factor?: number, reason?: string, note?: string];
interface Sec { title: string; lines: L[] }
interface QSpec {
  key: string;
  by: 'khang' | 'ha';
  client: string;
  contact: string;
  project: string;
  venue?: string;
  day: string;
  at: string;
  hours?: number; // working hours to send; absent = not sent
  status?: 'sent' | 'pending' | 'draft' | 'changes_requested';
  disc: number;
  sections: Sec[];
  terms?: string[];
  approvals?: { decision: 'approve' | 'changes'; comment: string; minutesBeforeSend?: number; at?: string }[];
  copiedFrom?: string;
}

const Q: QSpec[] = [
  { key: 'q01', by: 'khang', client: 'Công ty TNHH Mỹ phẩm Hạ Lan', contact: 'Chị Ngô Thị Lan – Trưởng phòng Marketing', project: 'Chiến dịch KOC ra mắt serum Hạ Lan', day: '2026-10-26', at: '08:40', hours: 3.5, disc: 5,
    sections: [
      { title: 'KOL/KOC & Influencer', lines: [['KO-01', 1], ['KO-02', 2, 1, undefined, '2 đợt, mỗi đợt tối đa 20 KOC'], ['KO-03', 30], ['KO-06', 1]] },
      { title: 'Nội dung hỗ trợ', lines: [['KN-09', 10], ['KN-07', 4]] },
    ], terms: [T_REVISE] },
  { key: 'q02', by: 'ha', client: 'Nhà hàng Hải sản Bờ Đông', contact: 'Anh Trương Văn Phúc – Chủ nhà hàng', project: 'Quảng cáo mùa du lịch cuối năm', day: '2026-10-26', at: '10:15', hours: 2, disc: 0,
    sections: [
      { title: 'Quảng cáo Meta (3 tháng)', lines: [['QC-11', 1], ['QC-01', 3], ['QC-04', 3], ['QC-12', 1]] },
      { title: 'Nội dung fanpage', lines: [['KN-06', 12]] },
    ], terms: T_ADS },
  { key: 'q03', by: 'khang', client: 'Chuỗi cà phê Mộc Trà', contact: 'Chị Hồ Ngọc Hân – Quản lý thương hiệu', project: 'Gian hàng Shopee & TikTok Shop mùa sale 11.11', day: '2026-10-27', at: '09:00', hours: 4.5, disc: 8,
    sections: [
      { title: 'Thiết lập gian hàng', lines: [['TM-01', 2, 1, undefined, 'Shopee và TikTok Shop'], ['TM-03', 2], ['TM-04', 3]] },
      { title: 'Vận hành & quảng cáo sàn', lines: [['TM-08', 1], ['TM-05', 2], ['TM-06', 1], ['TM-07', 1]] },
    ], terms: T_ADS },
  { key: 'q04', by: 'ha', client: 'Resort Cát Vàng Hội An', contact: 'Chị Lê Minh Thư – Giám đốc Sales & Marketing', project: 'Quay chụp Gala Dinner cuối năm', venue: 'Resort Cát Vàng, Hội An', day: '2026-10-27', at: '14:00', hours: 9, disc: 5,
    sections: [
      { title: 'Chụp & quay', lines: [['SK-01', 1], ['SK-02', 1], ['SK-03', 1], ['SK-09', 1]] },
      { title: 'Livestream & âm thanh', lines: [['SK-10', 1, 1.25, 'Gala ngoài trời: thêm 2 camera và đường truyền 4G dự phòng'], ['SK-05', 4], ['SK-11', 1]] },
    ], terms: [T_SHOOT, T_SITE],
    approvals: [{ decision: 'approve', comment: 'Đồng ý giá livestream vì sự kiện ngoài trời cần thêm thiết bị. Gửi khách trong sáng nay.', minutesBeforeSend: 25 }] },
  { key: 'q05', by: 'khang', client: 'Nha khoa Nụ Cười Việt', contact: 'Bác sĩ Đỗ Quang Vinh – Giám đốc phòng khám', project: 'Vận hành fanpage & TikTok 3 tháng', day: '2026-10-28', at: '08:30', hours: 5, disc: 12,
    sections: [
      { title: 'Kênh nội dung (3 tháng)', lines: [['KN-01', 3], ['KN-08', 3], ['KN-10', 1]] },
      { title: 'Quảng cáo Meta (3 tháng)', lines: [['QC-01', 3], ['QC-04', 3]] },
    ], terms: [...T_ADS, T_REVISE],
    approvals: [{ decision: 'approve', comment: 'Khách ký 3 tháng nên chiết khấu 12% chấp nhận được. Ghi rõ ưu đãi chỉ áp dụng khi thanh toán theo quý.', minutesBeforeSend: 40 }] },
  { key: 'q06', by: 'ha', client: 'Spa Thanh Mộc', contact: 'Chị Phạm Thu Trang – Chủ spa', project: 'Website & SEO Google Maps', day: '2026-10-28', at: '13:45', hours: 6, disc: 5,
    sections: [
      { title: 'Website', lines: [['WS-01', 1], ['WS-08', 1], ['TK-05', 1]] },
      { title: 'SEO (3 tháng)', lines: [['WS-04', 3], ['WS-07', 10]] },
    ], terms: [T_REVISE] },
  { key: 'q07', by: 'khang', client: 'Trung tâm Anh ngữ Bright Path', contact: 'Anh Nguyễn Đức Tâm – Trưởng phòng Tuyển sinh', project: 'Tuyển sinh khoá hè 2027', day: '2026-10-29', at: '09:20', hours: 2.5, disc: 0,
    sections: [
      { title: 'Landing page tuyển sinh', lines: [['WS-02', 2]] },
      { title: 'Quảng cáo (2 tháng)', lines: [['QC-03', 2], ['QC-06', 2], ['QC-07', 2], ['QC-08', 2], ['QC-12', 2]] },
    ], terms: T_ADS },
  { key: 'q08', by: 'ha', client: 'Thời trang Lụa Hiên', contact: 'Chị Võ Bảo Châu – Founder', project: 'Bộ nhận diện thương hiệu & ảnh lookbook', day: '2026-10-29', at: '15:00', hours: 8.5, disc: 10,
    sections: [
      { title: 'Thương hiệu', lines: [['TK-01', 1], ['TK-02', 1], ['TK-05', 1]] },
      { title: 'Hình ảnh', lines: [['KN-10', 3], ['SK-07', 2]] },
    ], terms: [T_REVISE] },
  { key: 'q09', by: 'khang', client: 'Đặc sản Mẹ Gánh', contact: 'Anh Lê Văn Hoà – Giám đốc', project: 'Bao bì quà Tết & gian hàng TikTok Shop', day: '2026-10-30', at: '08:15', hours: 3, disc: 5,
    sections: [
      { title: 'Thiết kế', lines: [['TK-04', 3, 1, undefined, 'Hộp quà 3 cỡ'], ['TK-03', 2]] },
      { title: 'Gian hàng TikTok Shop', lines: [['TM-01', 1], ['TM-03', 1]] },
    ], terms: [T_REVISE] },
  { key: 'q10', by: 'ha', client: 'Fitlab Gym Đà Nẵng', contact: 'Anh Trần Quốc Bảo – Quản lý', project: 'Quảng cáo khai trương chi nhánh Ngũ Hành Sơn', day: '2026-10-30', at: '10:40', hours: 4, disc: 15,
    sections: [
      { title: 'Quảng cáo (2 tháng)', lines: [['QC-01', 2], ['QC-04', 2], ['QC-09', 2], ['QC-10', 2]] },
      { title: 'Nội dung khai trương', lines: [['KN-07', 4], ['SK-01', 1]] },
    ], terms: T_ADS,
    approvals: [{ decision: 'approve', comment: 'Duyệt 15% vì gói khai trương. Ghi chú ưu đãi chỉ áp dụng 2 tháng đầu.', minutesBeforeSend: 30 }] },
  { key: 'q11', by: 'khang', client: 'Khách sạn Lam Hà Riverside', contact: 'Chị Đặng Thuỳ Linh – Trưởng phòng Kinh doanh', project: 'SEO website & Google Maps 6 tháng', day: '2026-11-02', at: '08:50', hours: 5.5, disc: 8,
    sections: [
      { title: 'Khảo sát', lines: [['WS-09', 1]] },
      { title: 'SEO (6 tháng)', lines: [['WS-05', 6], ['WS-04', 6], ['WS-07', 12]] },
    ] },
  { key: 'q12', by: 'ha', client: 'Mật ong Rừng Trà My', contact: 'Anh Hồ Văn Sang – Chủ cơ sở', project: 'Ra mắt gian hàng Shopee', day: '2026-11-02', at: '14:10', hours: 1.5, disc: 0,
    sections: [{ title: 'Gian hàng Shopee', lines: [['TM-01', 1], ['TM-03', 1], ['TM-04', 2], ['TM-06', 1], ['TM-07', 1]] }], terms: T_ADS },
  { key: 'q13', by: 'khang', client: 'Biển Xanh Travel', contact: 'Chị Nguyễn Thị Mai Anh – Marketing Lead', project: 'Video quảng bá tour mùa đông', day: '2026-11-03', at: '09:00', hours: 10.5, disc: 5,
    sections: [
      { title: 'Sản xuất video', lines: [['SK-08', 1, 1.25, 'Quay 3 địa điểm (Bà Nà, Hội An, Cù Lao Chàm) trong 2 ngày'], ['SK-03', 2], ['KN-07', 6]] },
      { title: 'Quảng cáo TikTok (2 tháng)', lines: [['QC-07', 2], ['QC-08', 2]] },
    ], terms: [T_SHOOT, ...T_ADS],
    approvals: [
      { decision: 'changes', comment: 'Ghi rõ số ngày quay và 3 địa điểm vào mô tả dòng TVC để khách hiểu vì sao giá cao hơn thư viện.', at: '2026-11-03T16:10:00+07:00' },
      { decision: 'approve', comment: 'Phạm vi đã rõ. Duyệt.', minutesBeforeSend: 20 },
    ] },
  { key: 'q14', by: 'ha', client: 'Trường mầm non Hoa Sen Xanh', contact: 'Cô Lý Thanh Hương – Hiệu trưởng', project: 'Fanpage tuyển sinh năm học 2027–2028', day: '2026-11-03', at: '13:30', hours: 3, disc: 5,
    sections: [
      { title: 'Fanpage (2 tháng)', lines: [['KN-01', 2], ['KN-06', 8], ['KN-10', 1]] },
      { title: 'Quảng cáo Meta (2 tháng)', lines: [['QC-01', 2], ['QC-04', 2]] },
    ], terms: T_ADS },
  { key: 'q15', by: 'khang', client: 'Nội thất Gỗ Mộc An', contact: 'Anh Phan Thanh Tùng – Giám đốc kinh doanh', project: 'Website bán hàng & quảng cáo Google', day: '2026-11-04', at: '08:45', hours: 8.5, disc: 0,
    sections: [
      { title: 'Website bán hàng', lines: [['WS-06', 1, 1.15, 'Thêm module chọn kích thước và báo giá theo kích thước'], ['WS-07', 8], ['WS-08', 1]] },
      { title: 'Google Ads (3 tháng)', lines: [['QC-03', 3], ['QC-06', 3]] },
    ], terms: T_ADS,
    approvals: [{ decision: 'approve', comment: 'Phí module kích thước hợp lý so với khối lượng. Duyệt.', minutesBeforeSend: 35 }] },
  { key: 'q16', by: 'ha', client: 'Phòng khám thú y PetHome', contact: 'Bác sĩ Vương Ngọc Diệp – Chủ phòng khám', project: 'Video TikTok & quảng cáo tháng 11', day: '2026-11-04', at: '14:20', hours: 2, disc: 5,
    sections: [{ title: 'TikTok', lines: [['KN-09', 8], ['KN-02', 8], ['QC-07', 1], ['QC-08', 1]] }], terms: T_ADS },
  { key: 'q17', by: 'khang', client: 'Công ty TNHH Mỹ phẩm Hạ Lan', contact: 'Chị Ngô Thị Lan – Trưởng phòng Marketing', project: 'Booking KOL tầm trung đợt 2', day: '2026-11-05', at: '09:10', hours: 4, disc: 10, copiedFrom: 'q01',
    sections: [
      { title: 'KOL/KOC & Influencer', lines: [['KO-01', 1], ['KO-02', 1], ['KO-04', 5], ['KO-05', 4], ['KO-06', 1]] },
    ], terms: [T_REVISE] },
  { key: 'q18', by: 'ha', client: 'Bánh mì Phố Cổ', contact: 'Anh Đinh Công Danh – Chủ chuỗi', project: 'Nhận diện & menu cho 3 cửa hàng', day: '2026-11-05', at: '15:30', hours: 5, disc: 8,
    sections: [
      { title: 'Nhận diện', lines: [['TK-01', 1], ['TK-05', 1]] },
      { title: 'Ấn phẩm cửa hàng', lines: [['TK-06', 3], ['TK-03', 6]] },
    ], terms: [T_REVISE] },
  { key: 'q19', by: 'khang', client: 'Chuỗi cà phê Mộc Trà', contact: 'Chị Hồ Ngọc Hân – Quản lý thương hiệu', project: 'Livestream & quảng cáo TikTok Shop 12.12', day: '2026-11-06', at: '08:30', hours: 3.5, disc: 5, copiedFrom: 'q03',
    sections: [
      { title: 'Livestream', lines: [['TM-05', 4], ['KN-07', 4]] },
      { title: 'KOC & quảng cáo sàn', lines: [['KO-03', 10], ['TM-06', 1], ['TM-07', 2]] },
    ], terms: T_ADS },
  { key: 'q20', by: 'ha', client: 'Resort Cát Vàng Hội An', contact: 'Chị Lê Minh Thư – Giám đốc Sales & Marketing', project: 'Quảng cáo đa kênh mùa lễ hội', day: '2026-11-06', at: '10:00', hours: 6.5, disc: 12,
    sections: [
      { title: 'Quảng cáo (2 tháng)', lines: [['QC-01', 2], ['QC-04', 2], ['QC-03', 2], ['QC-06', 2], ['QC-02', 2], ['QC-05', 2]] },
      { title: 'Creative', lines: [['QC-12', 2]] },
    ], terms: T_ADS,
    approvals: [{ decision: 'approve', comment: 'Khách cũ, ký 2 tháng: duyệt 12%.', minutesBeforeSend: 20 }] },
  // Open work on the morning of 09/11
  { key: 'q21', by: 'khang', client: 'Đặc sản Mẹ Gánh', contact: 'Anh Lê Văn Hoà – Giám đốc', project: 'Quảng cáo Tết 2027', day: '2026-11-06', at: '16:00', status: 'changes_requested', disc: 15,
    sections: [
      { title: 'Quảng cáo (3 tháng)', lines: [['QC-01', 3], ['QC-04', 3], ['QC-07', 3], ['QC-08', 3]] },
      { title: 'Creative Tết', lines: [['QC-12', 2], ['KN-07', 4]] },
    ], terms: T_ADS,
    approvals: [{ decision: 'changes', comment: 'Khách chỉ chạy đến 15/02 nên ngân sách chi hộ để 3 tháng là dư. Sửa lại số tháng rồi gửi duyệt lại.', at: '2026-11-09T08:40:00+07:00' }] },
  { key: 'q22', by: 'khang', client: 'Công ty TNHH Thiết bị Y tế Minh An', contact: 'Anh Cao Văn Lực – Trưởng phòng Kinh doanh', project: 'Website giới thiệu sản phẩm & SEO', day: '2026-11-09', at: '08:15', status: 'pending', disc: 15,
    sections: [
      { title: 'Website', lines: [['WS-01', 1], ['WS-08', 1]] },
      { title: 'SEO (3 tháng)', lines: [['WS-03', 3], ['WS-07', 10]] },
    ], terms: [T_REVISE] },
  { key: 'q23', by: 'ha', client: 'Spa Thanh Mộc', contact: 'Chị Phạm Thu Trang – Chủ spa', project: 'Fanpage & quảng cáo tháng 12', day: '2026-11-09', at: '08:50', status: 'draft', disc: 0, copiedFrom: 'q06',
    sections: [{ title: 'Kênh nội dung & quảng cáo', lines: [['KN-01', 1], ['QC-01', 1], ['QC-04', 1]] }], terms: T_ADS },
];

// 19 history quotes (Jul–Sep 2026): timestamps unchanged so the Diagnostics baseline still holds.
const HISTORY: [requested: string, sent: string, client: string, project: string, disc: number, lines: [string, number][]][] = [
  ['2026-07-03T07:00:00Z', '2026-07-06T01:30:00Z', 'Nhà hàng Hải sản Bờ Đông', 'Fanpage mùa hè', 0, [['KN-01', 3], ['KN-02', 4], ['KN-05', 8]]],
  ['2026-07-06T02:00:00Z', '2026-07-06T08:30:00Z', 'Hội nghị khách hàng Sao Nam', 'Quay chụp hội nghị', 5, [['SK-04', 3], ['SK-06', 6], ['SK-01', 1]]],
  ['2026-07-09T07:00:00Z', '2026-07-10T03:30:00Z', 'Khách sạn Lam Hà Riverside', 'Website khách sạn', 8, [['WS-01', 1], ['WS-03', 6], ['WS-04', 3]]],
  ['2026-07-13T02:00:00Z', '2026-07-13T10:00:00Z', 'Fitlab Gym Đà Nẵng', 'Quảng cáo hội viên mới', 10, [['QC-01', 3], ['QC-04', 3], ['KN-02', 2]]],
  ['2026-07-15T07:00:00Z', '2026-07-16T04:30:00Z', 'Lễ kỷ niệm 10 năm Hoàng Gia Phát', 'Quay chụp lễ kỷ niệm', 0, [['SK-01', 1], ['SK-02', 1], ['SK-03', 1]]],
  ['2026-07-20T02:00:00Z', '2026-07-21T01:30:00Z', 'Biển Xanh Travel', 'Quảng cáo đa kênh quý III', 5, [['QC-01', 3], ['QC-03', 3], ['QC-04', 3], ['QC-06', 3]]],
  ['2026-07-21T07:00:00Z', '2026-07-22T07:00:00Z', 'Chuỗi cà phê Mộc Trà', 'Fanpage & TikTok', 8, [['KN-01', 3], ['KN-02', 6], ['KN-03', 1]]],
  ['2026-08-03T02:00:00Z', '2026-08-04T03:30:00Z', 'Spa Thanh Mộc', 'Landing page ưu đãi', 10, [['WS-02', 2], ['QC-01', 2]]],
  ['2026-08-06T07:00:00Z', '2026-08-07T08:30:00Z', 'Resort Cát Vàng Hội An', 'Quảng cáo khách Nga', 0, [['QC-02', 3], ['QC-05', 3], ['WS-02', 1]]],
  ['2026-08-10T02:00:00Z', '2026-08-10T09:30:00Z', 'Nha khoa Nụ Cười Việt', 'SEO Google Maps', 5, [['WS-04', 3], ['WS-03', 3]]],
  ['2026-08-12T07:00:00Z', '2026-08-13T05:00:00Z', 'Trung tâm Anh ngữ Bright Path', 'Video tuyển sinh', 8, [['KN-02', 6], ['SK-04', 2], ['SK-06', 2]]],
  ['2026-08-17T02:00:00Z', '2026-08-18T03:00:00Z', 'Bất động sản Vạn Khang', 'Quảng cáo dự án căn hộ', 10, [['QC-01', 3], ['QC-04', 3], ['QC-03', 3], ['QC-06', 3]]],
  ['2026-08-18T07:00:00Z', '2026-08-19T08:30:00Z', 'Công ty TNHH Mỹ phẩm Hạ Lan', 'Kênh YouTube thương hiệu', 0, [['KN-03', 1], ['KN-04', 3], ['SK-07', 2]]],
  ['2026-08-21T02:00:00Z', '2026-08-24T04:00:00Z', 'Thời trang Lụa Hiên', 'Bộ ảnh concept AI', 5, [['SK-07', 4], ['KN-01', 2]]],
  ['2026-09-03T07:00:00Z', '2026-09-04T10:00:00Z', 'Hội chợ OCOP Đà Nẵng', 'Livestream & quay hội chợ', 8, [['SK-02', 2], ['SK-04', 4], ['SK-06', 6], ['SK-05', 6]]],
  ['2026-09-07T02:00:00Z', '2026-09-08T07:00:00Z', 'Đặc sản Mẹ Gánh', 'Fanpage & quảng cáo Trung thu', 10, [['KN-01', 2], ['QC-01', 2], ['QC-04', 2]]],
  ['2026-09-09T07:00:00Z', '2026-09-11T01:30:00Z', 'Phòng khám thú y PetHome', 'Website phòng khám', 0, [['WS-02', 2], ['WS-03', 1], ['KN-05', 20]]],
  ['2026-09-14T02:00:00Z', '2026-09-15T08:00:00Z', 'Khách sạn Lam Hà Riverside', 'SEO tổng thể', 5, [['WS-05', 6], ['WS-04', 3]]],
  ['2026-09-15T07:00:00Z', '2026-09-17T02:00:00Z', 'Nội thất Gỗ Mộc An', 'Quảng cáo Google mùa cưới', 8, [['QC-03', 3], ['QC-06', 3], ['WS-02', 1]]],
];

interface Row { [k: string]: unknown }
const quotes: Row[] = [];
const lines: Row[] = [];
const approvals: Row[] = [];
const changesRequested: string[] = [];

HISTORY.forEach(([req, sent, client, project, disc, ls], i) => {
  const id = randomUUID();
  reg('quotes', id);
  const m = req.slice(5, 7);
  const items = ls.map(([code, qty]) => ({ l: lib(code), qty }));
  const totals = quoteTotals(items.map((x) => ({ qty: x.qty, unitPrice: x.l.price, kind: x.l.kind })), disc);
  quotes.push({
    id, code: `BG-26${m}-${String(i + 1).padStart(2, '0')}`, client, contact: '', venue: '', project, service_group: items[0].l.group, requested_at: req, sent_at: sent, status: 'sent',
    discount_pct: disc, subtotal: totals.subtotal, total: totals.total, vat_pct: 0, vat_amount: 0, grand_total: totals.total, source: 'import', created_by: i % 2 ? P.ha.id : P.khang.id,
    created_at: sent, updated_at: sent, terms: [],
  });
  items.forEach((x, k) => {
    const lid = randomUUID();
    lines.push({ id: lid, quote_id: id, position: k + 1, library_item_id: `@${x.l.code}`, item_name: x.l.name, unit: x.l.unit, qty: x.qty, unit_price: x.l.price, library_price: x.l.price, section: x.l.group, description: x.l.description, kind: x.l.kind, created_at: sent });
  });
});

const keyToId = new Map<string, string>();
const kpiRows: { requestedAt: number; sentAt: number | null }[] = [];
Q.forEach((q, i) => {
  const id = randomUUID();
  keyToId.set(q.key, id);
  reg('quotes', id);
  const requested = vn(q.day, q.at);
  const sent = q.hours !== undefined ? addWorkingHours(requested, q.hours, CAL).getTime() : null;
  if (sent !== null && sent > NOW) throw new Error(`${q.key} would be sent in the future`);
  const flat = q.sections.flatMap((s) => s.lines.map((l) => ({ s, l, item: lib(l[0]) })));
  const priced = flat.map(({ s, l, item }) => ({ s, item, qty: l[1], price: Math.round((item.price * (l[2] ?? 1)) / 1000) * 1000, reason: l[3] ?? null, note: l[4] ?? null }));
  const band = bandCheck(priced.map((p) => ({ name: p.item.name, qty: p.qty, unitPrice: p.price, libraryPrice: p.item.price, passThrough: p.item.kind === 'pass_through' })), q.disc, DEFAULT_BAND_RULES);
  const totals = quoteTotals(priced.map((p) => ({ qty: p.qty, unitPrice: p.price, kind: p.item.kind })), q.disc, { pct: 8, onPassThrough: false });
  const status = q.status ?? 'sent';
  const needs = band.level !== 'send_now';
  const lastApproval = q.approvals?.[q.approvals.length - 1];
  if (status === 'sent' && needs !== !!q.approvals?.some((a) => a.decision === 'approve')) throw new Error(`${q.key}: band ${band.level} vs approvals`);
  const created = requested + 12 * MIN;
  let approvalRequested: number | null = null;
  if (needs) {
    if (status === 'sent') approvalRequested = sent! - ((lastApproval?.minutesBeforeSend ?? 30) + 45) * MIN;
    if (status === 'pending') approvalRequested = vn(q.day, '09:25');
    if (status === 'changes_requested') approvalRequested = vn(q.day, '17:05');
    if (q.approvals?.[0]?.at) approvalRequested = Math.min(approvalRequested ?? Infinity, Date.parse(q.approvals[0].at) - 50 * MIN);
  }
  const approver = needs && status !== 'draft' ? band.level : null;
  const by = P[q.by].id;
  quotes.push({
    id, code: `Q-2026-${String(i + 1).padStart(3, '0')}`, client: q.client, contact: q.contact, project: q.project, venue: q.venue ?? '', service_group: priced[0].item.group,
    requested_at: iso(requested), sent_at: sent ? iso(sent) : null, status, discount_pct: q.disc, subtotal: totals.subtotal, total: totals.total, vat_pct: 8, vat_amount: totals.vatAmount, grand_total: totals.grandTotal,
    band_result: status === 'draft' ? null : band.level, band_detail: status === 'draft' ? null : publicBand(band), approver,
    approval_requested_at: approvalRequested ? iso(approvalRequested) : null, approval_notified_at: approvalRequested ? iso(approvalRequested + 2 * MIN) : null,
    source: 'app', copied_from: q.copiedFrom ? keyToId.get(q.copiedFrom) : null, created_by: by, created_at: iso(created), updated_at: iso(sent ?? Math.max(created, approvalRequested ?? 0)),
    terms: [...TERMS_DEFAULT.slice(0, 2), ...(q.terms ?? []), ...TERMS_DEFAULT.slice(2)],
  });
  priced.forEach((p, k) => {
    lines.push({
      id: randomUUID(), quote_id: id, position: k + 1, library_item_id: p.item.isNew ? p.item.id : `@${p.item.code}`, item_name: p.item.name, unit: p.item.unit, qty: p.qty, unit_price: p.price, library_price: p.item.price,
      override_reason: p.price !== p.item.price ? p.reason : null, section: p.s.title, description: [p.item.description, p.note].filter(Boolean).join('. ') || null, kind: p.item.kind, created_at: iso(created + (k + 1) * MIN),
    });
  });
  for (const a of q.approvals ?? []) {
    const at = a.at ? Date.parse(a.at) : sent! - (a.minutesBeforeSend ?? 30) * MIN;
    const approverId = band.level === 'ceo' ? ADMIN : P.qanh.id;
    const aid = randomUUID();
    approvals.push({ id: aid, quote_id: id, level: band.level, approver_id: approverId, decision: a.decision, comment: a.comment, decided_at: iso(at) });
  }
  if (status === 'changes_requested') changesRequested.push(id);
  if (q.hours !== undefined) kpiRows.push({ requestedAt: requested, sentAt: sent });
});

// -------------------------------------------------------------------------------- S1 on Lark ----
const sim = (k: keyof typeof P) => `sim:${P[k].id}`;
interface Child { code: string; name: string; who: keyof typeof P; due: string; done?: string; wrongCode?: string; fixedAt?: string; desc?: string }
interface Parent { code: string; name: string; who: keyof typeof P; due: string; created: string; desc: string; kids: Child[] }
const PARENTS: Parent[] = [
  { code: 'DA061', name: '[Hạ Lan] Chiến dịch 300 video KOC serum mới', who: 'thinh', due: '2026-11-28', created: '2026-10-23T10:20', desc: '3 đợt KOC, mỗi đợt 30–40 KOC, mỗi KOC 3 video', kids: [
    { code: 'DA061-01-S01', name: '[Hạ Lan] Chốt danh sách 30 KOC đợt 1', who: 'ngoc', due: '2026-10-28', done: '2026-10-27T15:20' },
    { code: 'DA061-01-S02', name: '[Hạ Lan] Gửi brief và sản phẩm cho KOC đợt 1', who: 'kiet', due: '2026-10-30', done: '2026-10-31T10:05' },
    { code: 'DA061-02-S03', name: '[Hạ Lan] Duyệt kịch bản video KOC đợt 1', who: 'truc', due: '2026-11-03', done: '2026-11-03T16:40' },
    { code: 'DA061-02-S04', name: '[Hạ Lan] Thu đủ 90 video KOC đợt 1', who: 'ngoc', due: '2026-11-07', desc: 'Đã nhận 71/90 video' },
    { code: 'DA061-03-S05', name: '[Hạ Lan] Tổng hợp link và số liệu video tuần 2', who: 'kiet', due: '2026-11-10' },
    { code: 'DA061-03-S06', name: '[Hạ Lan] Chốt danh sách 40 KOC đợt 2', who: 'ngoc', due: '2026-11-14' },
  ] },
  { code: 'TM024', name: '[Mộc Trà] Gian hàng Shopee & TikTok Shop cho 11.11', who: 'thinh', due: '2026-11-11', created: '2026-10-24T09:05', desc: '25 SKU, 2 sàn, livestream đêm 10/11', kids: [
    { code: 'TM024-01-S01', name: '[Mộc Trà] Setup gian hàng TikTok Shop', who: 'phuoc', due: '2026-10-29', done: '2026-10-29T11:30' },
    { code: 'TM024-01-S02', name: '[Mộc Trà] Chụp 25 ảnh sản phẩm', who: 'huy', due: '2026-10-31', done: '2026-10-30T17:10' },
    { code: 'TM024-02-S03', name: '[Mộc Trà] Banner và khung ảnh 11.11', who: 'huy', due: '2026-11-05', done: '2026-11-06T09:40' },
    { code: 'TM024-02-S04', name: '[Mộc Trà] Tối ưu listing 25 SKU', who: 'phuoc', due: '2026-11-07', done: '2026-11-07T16:00', wrongCode: 'TM24-02-S04', fixedAt: '2026-11-08T14:05' },
    { code: 'TM024-03-S05', name: '[Mộc Trà] Cài voucher và flash sale 11.11', who: 'duyen', due: '2026-11-10' },
    { code: 'TM024-03-S06', name: '[Mộc Trà] Kịch bản livestream 11.11', who: 'truc', due: '2026-11-09' },
  ] },
  { code: 'SK015', name: '[Cát Vàng] Quay chụp Gala Dinner cuối năm', who: 'phuoc', due: '2026-11-20', created: '2026-10-29T14:30', desc: 'Gala ngoài trời 19/11, có livestream', kids: [
    { code: 'SK015-01-S01', name: '[Cát Vàng] Khảo sát địa điểm và lên shotlist', who: 'huy', due: '2026-11-04', done: '2026-11-03T17:00' },
    { code: 'SK015-01-S02', name: '[Cát Vàng] Chốt ekip và thiết bị quay', who: 'phuoc', due: '2026-11-12' },
    { code: 'SK015-02-S03', name: '[Cát Vàng] Kịch bản video highlight', who: 'truc', due: '2026-11-17' },
  ] },
  { code: 'KN032', name: '[Nụ Cười Việt] Vận hành fanpage & TikTok tháng 11', who: 'duyen', due: '2026-11-30', created: '2026-10-26T08:45', desc: '24 bài fanpage, 12 video TikTok', kids: [
    { code: 'KN032-01-S01', name: '[Nụ Cười Việt] Lịch nội dung tháng 11 (24 bài)', who: 'duyen', due: '2026-10-30', done: '2026-10-30T10:00' },
    { code: 'KN032-01-S02', name: '[Nụ Cười Việt] Quay 6 video TikTok tuần 1', who: 'kiet', due: '2026-11-04', done: '2026-11-04T15:30' },
    { code: 'KN032-02-S03', name: '[Nụ Cười Việt] Lên bài tuần 1–2', who: 'duyen', due: '2026-11-08', done: '2026-11-07T17:00' },
    { code: 'KN032-02-S04', name: '[Nụ Cười Việt] Quay 6 video TikTok tuần 2', who: 'kiet', due: '2026-11-11' },
  ] },
  { code: 'WS008', name: '[Thanh Mộc] Website & SEO Google Maps', who: 'phuoc', due: '2026-12-05', created: '2026-10-30T11:15', desc: 'Website 8 trang, SEO Maps 3 tháng', kids: [
    { code: 'WS008-01-S01', name: '[Thanh Mộc] Wireframe trang chủ và trang dịch vụ', who: 'huy', due: '2026-11-06', done: '2026-11-05T16:20' },
    { code: 'WS008-01-S02', name: '[Thanh Mộc] Viết 10 bài SEO dịch vụ', who: 'truc', due: '2026-11-13' },
    { code: 'WS008-02-S03', name: '[Thanh Mộc] Tối ưu Google Business Profile', who: 'phuoc', due: '2026-11-06', desc: 'Chờ khách gửi ảnh cơ sở' },
  ] },
];

const larkTasks: Row[] = [];
const notifs: Row[] = [];
const quarter = (ms: number) => Math.ceil(ms / (15 * MIN)) * 15 * MIN; // the cron runs every 15 minutes
const ymd = (ms: number) => new Date(ms + 7 * 3_600_000).toISOString().slice(0, 10);
const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

for (const p of PARENTS) {
  const pid = randomUUID();
  reg('lark_tasks', pid);
  const created = vn(p.created.slice(0, 10), p.created.slice(11));
  larkTasks.push({
    id: pid, kind: 'parent', parent_id: null, code: p.code, parent_code: null, name: p.name, description: p.desc, assignee_open_id: sim(p.who), assignee_name: P[p.who].name, due_date: p.due,
    mode: 'simulation', lark_title: larkTitle('parent', p.code, p.name), completed_at: null, closed_at: null, code_errors: [], source: 'bot', created_by_open_id: sim(p.who), created_by: P[p.who].id,
    created_at: iso(created), updated_at: iso(created),
  });
  p.kids.forEach((k, idx) => {
    const kid = randomUUID();
    reg('lark_tasks', kid);
    const kCreated = created + (idx + 1) * 4 * MIN + (idx >= 3 ? 3 * 86_400_000 : 0);
    const doneAt = k.done ? vn(k.done.slice(0, 10), k.done.slice(11)) : null;
    const fixedAt = k.fixedAt ? vn(k.fixedAt.slice(0, 10), k.fixedAt.slice(11)) : null;
    // Walk the cron day by day: 09:00 reminder slot and a completion check every 15 minutes.
    let closedAt: number | null = null;
    const codeAt = (t: number) => (k.wrongCode && (fixedAt === null || t < fixedAt) ? k.wrongCode : k.code);
    const tracked = (t: number): LarkTracked => ({ parentCode: p.code, parentName: p.name, childCode: codeAt(t), childName: k.name, assigneeOpenId: sim(k.who), assigneeName: P[k.who].name, dueDate: k.due, completedAt: doneAt !== null && doneAt <= t ? doneAt : null, closedAt });
    for (let day = ymd(kCreated); day <= ymd(NOW) && closedAt === null; day = addDay(day, 1)) {
      const slot = vn(day, '09:00') + (2 + idx) * 1000;
      // Completion found by a quarter-hour tick before 09:00 on this day?
      const candidates: number[] = [];
      if (doneAt !== null) candidates.push(quarter(Math.max(doneAt, fixedAt ?? 0)));
      const completeTick = candidates.find((t) => ymd(t) === day && t < vn(day, '09:00'));
      if (completeTick !== undefined) {
        const c = completionCheck(tracked(completeTick));
        if (c.done) {
          closedAt = completeTick + 3000;
          notifs.push({ id: randomUUID(), task_id: kid, local_date: day, kind: 'completion', milestone: 'DONE', assignee_open_id: sim(k.who), status: 'simulated', attempts: 1, message: completionMessage(tracked(completeTick), TZ), sent_at: iso(closedAt), created_at: iso(closedAt - 1500) });
          break;
        }
      }
      if (slot >= kCreated && slot <= NOW) {
        const a = decideLarkAction(tracked(slot), slot, TZ, { schedule: DEFAULT_LARK_SCHEDULE, sentToday: false });
        if (a.type === 'remind') {
          notifs.push({ id: randomUUID(), task_id: kid, local_date: day, kind: 'reminder', milestone: a.milestone.label, assignee_open_id: sim(k.who), status: 'simulated', attempts: 1, message: reminderMessage(tracked(slot), a.milestone, a.codeErrors), sent_at: iso(slot), created_at: iso(slot - 1500) });
        }
      }
      const later = candidates.find((t) => ymd(t) === day && t >= vn(day, '09:00') && t <= NOW);
      if (later !== undefined && completionCheck(tracked(later)).done) {
        closedAt = later + 3000;
        notifs.push({ id: randomUUID(), task_id: kid, local_date: day, kind: 'completion', milestone: 'DONE', assignee_open_id: sim(k.who), status: 'simulated', attempts: 1, message: completionMessage(tracked(later), TZ), sent_at: iso(closedAt), created_at: iso(closedAt - 1500) });
      }
    }
    larkTasks.push({
      id: kid, kind: 'child', parent_id: pid, code: k.code, parent_code: p.code, name: k.name, description: k.desc ?? null, assignee_open_id: sim(k.who), assignee_name: P[k.who].name, due_date: k.due,
      mode: 'simulation', lark_title: larkTitle('child', k.code, k.name), completed_at: doneAt !== null && doneAt <= NOW ? iso(doneAt) : null, closed_at: closedAt ? iso(closedAt) : null, code_errors: [],
      source: idx % 3 === 2 ? 'web' : 'bot', created_by_open_id: sim(p.who), created_by: P[p.who].id, created_at: iso(kCreated), updated_at: iso(closedAt ?? doneAt ?? kCreated),
    });
  });
}
for (const n of notifs) reg('lark_notifications', String(n.id));

// ---------------------------------------------------------------------------------- summary ------
const late = kpiRows.filter((r) => workingHoursBetween(r.requestedAt, r.sentAt!, CAL) > 8).length;
const avg = kpiRows.reduce((s, r) => s + workingHoursBetween(r.requestedAt, r.sentAt!, CAL), 0) / kpiRows.length;
const kids = larkTasks.filter((t) => t.kind === 'child');
console.error(`quotes app=${Q.length} sent=${kpiRows.length} late=${late} (${((late / kpiRows.length) * 100).toFixed(1)}%) avg=${avg.toFixed(2)}h; history=${HISTORY.length}`);
console.error(`lark parents=${PARENTS.length} children=${kids.length} notifications=${notifs.length} (reminders ${notifs.filter((n) => n.kind === 'reminder').length})`);
console.error(`library new=${ADDED.length} total=${LIB.size}`);

// --------------------------------------------------------------------------------------- SQL -----
const J = (v: unknown) => `$J$${JSON.stringify(v)}$J$`;
const out: string[] = [];
out.push('begin;');
out.push(`create table if not exists public.seed_registry (table_name text not null, row_id text not null, created_at timestamptz not null default now(), primary key (table_name, row_id));
alter table public.seed_registry enable row level security;
revoke all on public.seed_registry from anon, authenticated;
grant all on public.seed_registry to service_role;`);
// remove the previous sample set (quotes DEMO-*, Lark "(mẫu)")
out.push(`delete from public.quotes where code like 'DEMO-%';
delete from public.lark_tasks where name like '%(mẫu)%';
delete from public.quotes where id in (select row_id::uuid from public.seed_registry where table_name = 'quotes');
delete from public.lark_tasks where id in (select row_id::uuid from public.seed_registry where table_name = 'lark_tasks');
delete from public.library_items where id in (select row_id::uuid from public.seed_registry where table_name = 'library_items')
  and not exists (select 1 from public.quote_lines l where l.library_item_id = library_items.id and l.quote_id not in (select row_id::uuid from public.seed_registry where table_name = 'quotes'));
delete from public.seed_registry where table_name in ('quotes','lark_tasks','lark_notifications','library_items');`);
// people
for (const p of Object.values(P)) {
  if (p.isNew) {
    out.push(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', '${p.id}', 'authenticated', 'authenticated', '${p.email}', '', now(), ${J({ provider: 'email', providers: ['email'], ops_role: p.role })}::jsonb, ${J({ full_name: p.name })}::jsonb, '2026-10-20T02:00:00Z', now(), '', '', '', '')
on conflict (id) do nothing;`);
  } else {
    out.push(`update auth.users set email = '${p.email}', raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || ${J({ full_name: p.name })}::jsonb where id = '${p.id}';
update auth.identities set identity_data = identity_data || ${J({ email: p.email })}::jsonb where user_id = '${p.id}';`);
  }
  out.push(`update public.profiles set email = '${p.email}', full_name = '${p.name}', role = '${p.role}', active = true where id = '${p.id}';
insert into public.seed_registry (table_name, row_id) values ('auth.users', '${p.id}') on conflict do nothing;`);
}
out.push(`delete from public.lark_people where open_id like 'sim:%' and (profile_id is null or profile_id in (${Object.values(P).map((p) => `'${p.id}'`).join(',')}));
insert into public.lark_people (open_id, name, profile_id) select 'sim:' || id, coalesce(nullif(full_name, ''), email), id from public.profiles on conflict (open_id) do update set name = excluded.name;`);
// library
for (const [code, , , , , , description] of EXISTING) out.push(`update public.library_items set description = coalesce(description, ${J(description)}) where code = '${code}';`);
const newLib = [...LIB.values()].filter((l) => l.isNew).map((l) => ({ id: l.id, code: l.code, name: l.name, unit: l.unit, service_group: l.group, unit_price: l.price, kind: l.kind, description: l.description, last_reviewed_at: '2026-10-20', active: true, updated_by: P.qanh.id, created_at: '2026-10-20T03:00:00Z', updated_at: '2026-10-20T03:00:00Z' }));
out.push(`insert into public.library_items (id, code, name, unit, service_group, unit_price, kind, description, last_reviewed_at, active, updated_by, created_at, updated_at)
select id, code, name, unit, service_group, unit_price, kind, description, last_reviewed_at, active, updated_by, created_at, updated_at from json_populate_recordset(null::public.library_items, ${J(newLib)});`);
for (const l of newLib) reg('library_items', l.id);
// quotes: Long's own drafts move to the end of the numbering
out.push(`update public.quotes set code = 'Q-2026-' || lpad((${Q.length} + rn)::text, 3, '0') from (select id qid, row_number() over (order by created_at) rn from public.quotes where code like 'Q-2026-%' and created_by = 'ac7a2401-5774-4868-83be-d657da6e42f2') x where id = x.qid;`);
out.push(`insert into public.quotes (id, code, client, contact, project, venue, service_group, requested_at, sent_at, status, discount_pct, subtotal, total, vat_pct, vat_amount, grand_total, band_result, band_detail, approver, approval_requested_at, approval_notified_at, source, copied_from, created_by, created_at, updated_at, terms)
select id, code, client, contact, project, venue, service_group, requested_at, sent_at, status, discount_pct, subtotal, total, vat_pct, vat_amount, grand_total, band_result, band_detail, approver, approval_requested_at, approval_notified_at, source, copied_from, created_by, created_at, updated_at, terms from json_populate_recordset(null::public.quotes, ${J(quotes)});`);
const linesOut = lines.map((l) => ({ ...l, library_item_id: typeof l.library_item_id === 'string' && l.library_item_id.startsWith('@') ? null : l.library_item_id, lib_code: typeof l.library_item_id === 'string' && l.library_item_id.startsWith('@') ? l.library_item_id.slice(1) : null }));
out.push(`insert into public.quote_lines (id, quote_id, position, library_item_id, item_name, unit, qty, unit_price, library_price, override_reason, section, description, kind, created_at)
select r.id, r.quote_id, r.position, coalesce(r.library_item_id, li.id), r.item_name, r.unit, r.qty, r.unit_price, r.library_price, r.override_reason, r.section, r.description, r.kind, r.created_at
from json_populate_recordset(null::public.quote_lines, ${J(linesOut)}) r
left join json_to_recordset(${J(linesOut.map((l) => ({ id: l.id, lib_code: l.lib_code })))}) c(id uuid, lib_code text) on c.id = r.id
left join public.library_items li on li.code = c.lib_code;`);
out.push(`insert into public.approvals (id, quote_id, level, approver_id, decision, comment, decided_at) select id, quote_id, level, approver_id, decision, comment, decided_at from json_populate_recordset(null::public.approvals, ${J(approvals)});`);
// Inserting lines sends a changes_requested quote back to Draft (trigger), which also clears its band: restore both.
for (const qid of changesRequested) {
  const q = quotes.find((x) => x.id === qid)!;
  out.push(`update public.quotes set status = 'changes_requested', band_result = '${q.band_result}', approver = '${q.approver}', band_detail = ${J(q.band_detail)}::jsonb, approval_requested_at = '${q.approval_requested_at}', approval_notified_at = '${q.approval_notified_at}' where id = '${qid}';`);
}
out.push(`select setval('public.quote_code_seq', greatest((select max(substring(code from 8)::int) from public.quotes where code ~ '^Q-2026-\\d+$'), 1));`);
// lark
out.push(`insert into public.lark_tasks (id, kind, parent_id, code, parent_code, name, description, assignee_open_id, assignee_name, due_date, mode, lark_title, completed_at, closed_at, code_errors, source, created_by_open_id, created_by, created_at, updated_at)
select id, kind, parent_id, code, parent_code, name, description, assignee_open_id, assignee_name, due_date, mode, lark_title, completed_at, closed_at, code_errors, source, created_by_open_id, created_by, created_at, updated_at from json_populate_recordset(null::public.lark_tasks, ${J(larkTasks.filter((t) => t.kind === 'parent'))});`);
out.push(`insert into public.lark_tasks (id, kind, parent_id, code, parent_code, name, description, assignee_open_id, assignee_name, due_date, mode, lark_title, completed_at, closed_at, code_errors, source, created_by_open_id, created_by, created_at, updated_at)
select id, kind, parent_id, code, parent_code, name, description, assignee_open_id, assignee_name, due_date, mode, lark_title, completed_at, closed_at, code_errors, source, created_by_open_id, created_by, created_at, updated_at from json_populate_recordset(null::public.lark_tasks, ${J(kids)});`);
out.push(`insert into public.lark_notifications (id, task_id, local_date, kind, milestone, assignee_open_id, status, attempts, message, sent_at, created_at)
select id, task_id, local_date, kind, milestone, assignee_open_id, status, attempts, message, sent_at, created_at from json_populate_recordset(null::public.lark_notifications, ${J(notifs)});`);
out.push(`update public.settings set lark_status = ${J({ at: iso(vn('2026-11-09', '09:45')), mode: 'simulation', today: '2026-11-09', failed: 0, synced: 0, reminders: 0, syncErrors: 0, completions: 0, waitingForTime: 0 })}::jsonb where id = 1;`);
// old checkpoint module: drop the "(mẫu)" markers
out.push(`update public.tasks set name = replace(name, ' (mẫu)', '') where name like '%(mẫu)%';
update public.checkpoints set answer_reason = replace(answer_reason, ' (mẫu)', '') where answer_reason like '%(mẫu)%';
update public.alerts set reason = replace(reason, ' (mẫu)', '') where reason like '%(mẫu)%';
insert into public.seed_registry (table_name, row_id) select 'tasks', id::text from public.tasks where owner_id in (${Object.values(P).map((p) => `'${p.id}'`).join(',')}) on conflict do nothing;`);
out.push(`insert into public.seed_registry (table_name, row_id) select * from json_to_recordset(${J(registry.map(([table_name, row_id]) => ({ table_name, row_id })))}) x(table_name text, row_id text) on conflict do nothing;`);
out.push('commit;');
process.stdout.write(out.join('\n\n') + '\n');
if (process.env.SHOWCASE_DEBUG) {
  for (const t of kids) {
    const ns = notifs.filter((n) => n.task_id === t.id).map((n) => `${String(n.local_date).slice(5)}:${n.milestone}`);
    console.error(`${t.code} due ${t.due_date} done ${t.completed_at ?? '-'} closed ${t.closed_at ?? '-'} | ${ns.join(' ')}`);
  }
  console.error(larkLate());
}
function larkLate() {
  let onTime = 0, lateN = 0, openLate = 0;
  for (const t of kids) {
    if (t.completed_at) (ymd(Date.parse(String(t.completed_at))) <= String(t.due_date) ? onTime++ : lateN++);
    else if (String(t.due_date) < ymd(NOW)) openLate++;
  }
  return { onTime, late: lateN, openLate, pct: ((lateN + openLate) / (onTime + lateN + openLate)) * 100 };
}
