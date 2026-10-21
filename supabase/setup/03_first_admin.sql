-- =====================================================================================
-- Go Media Ops Hub · first admin                                       version 1.0.0
-- Run ONCE per project, after 01_schema.sql and after you created your own user in
-- Supabase → Authentication → Users → Add user → Create new user (tick "Auto Confirm User").
-- 1) Replace YOUR-EMAIL@example.com below with that e-mail.  2) Run the whole file.
-- Every other account is invited from the app (Admin → Người dùng), never added by hand:
-- accounts the app did not create stay inactive and see nothing.
-- =====================================================================================
do $$
declare
  v_email text := lower(trim('YOUR-EMAIL@example.com'));
  n int;
begin
  if v_email like '%your-email%' then
    raise exception 'Hãy thay YOUR-EMAIL@example.com bằng email của bạn rồi chạy lại.';
  end if;
  update public.profiles set role = 'admin', active = true where lower(email) = v_email;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Chưa có tài khoản %. Tạo user ở Authentication → Users → Add user trước, rồi chạy lại.', v_email;
  end if;
end $$;

-- Expected result: one row with your e-mail, role admin, active true.
select email, role, active from public.profiles where role = 'admin';
