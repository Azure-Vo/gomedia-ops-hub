// Go Media Ops Hub · cấu hình cho một lần triển khai.
// Điền 2 giá trị lấy từ Supabase → Project Settings → API (URL và publishable/anon key).
// Hai giá trị này được phép công khai: dữ liệu được bảo vệ bằng Row Level Security.
window.OPS_HUB_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT-REF.supabase.co",
  supabaseAnonKey: "YOUR-PUBLISHABLE-OR-ANON-KEY",
  environment: "pilot" // "pilot" cho bản thật, "demo" cho bản trình bày
};
