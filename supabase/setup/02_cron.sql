-- =====================================================================================
-- Go Media Ops Hub · scheduled jobs                                    version 1.0.0
-- Run AFTER the Edge Function "ops-hub" is deployed.
-- 1) Replace YOUR-PROJECT-REF on the line below with your project's reference
--    (Supabase → Project Settings → General → Project ID).
-- 2) Run the whole file. Running it again is safe.
-- It keeps the project address and a random job secret in Supabase Vault (encrypted) and
-- calls the function every 15 minutes. The function itself never sends outside working hours.
-- =====================================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  v_url text := 'https://YOUR-PROJECT-REF.supabase.co';
  v_id uuid;
begin
  if v_url like '%YOUR-PROJECT-REF%' then
    raise exception 'Hãy thay YOUR-PROJECT-REF bằng mã project của bạn rồi chạy lại.';
  end if;
  select id into v_id from vault.secrets where name = 'ops_project_url';
  if v_id is null then
    perform vault.create_secret(v_url, 'ops_project_url', 'Go Media Ops Hub: project URL for scheduled jobs');
  else
    perform vault.update_secret(v_id, v_url);
  end if;
  if not exists (select 1 from vault.secrets where name = 'ops_cron_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
                                'ops_cron_secret', 'Go Media Ops Hub: secret header for scheduled jobs');
  end if;
end $$;

select cron.unschedule(jobid) from cron.job where jobname in ('ops-dispatch-checkpoints', 'ops-close-tasks');

select cron.schedule('ops-dispatch-checkpoints', '*/15 * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'ops_project_url') || '/functions/v1/ops-hub/dispatch-checkpoints',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ops_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000)
$job$);

select cron.schedule('ops-close-tasks', '*/15 * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'ops_project_url') || '/functions/v1/ops-hub/close-tasks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ops_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000)
$job$);

-- Expected result: two rows, both active = true.
select jobname, schedule, active from cron.job where jobname like 'ops-%' order by jobname;
