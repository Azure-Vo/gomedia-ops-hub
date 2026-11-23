import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAsync } from '@/components/ui';
import { useSettings } from '@/lib/settings';
import { loadWork, Task, WorkData } from './data';
import { Panel, TaskDrawer } from './parts';

export function useWork(opts: { projectCode?: string } = {}) {
  const { calendar, loading: settingsLoading } = useSettings();
  const res = useAsync<WorkData>(() => loadWork(calendar, opts), [calendar.timeZone, calendar.workDays.join(','), calendar.holidays.join(','), opts.projectCode, settingsLoading]);
  return res;
}

/** The task opened from a link (?task=<id>&do=submit) or a click. */
export function useOpenTask(data: WorkData | null) {
  const [params, setParams] = useSearchParams();
  const id = params.get('task');
  const panel = (params.get('do') as Panel) ?? null;
  const task = useMemo(() => (id && data ? (data.tasks.find((t) => t.id === id) ?? null) : null), [id, data]);
  const open = useCallback(
    (t: Task | null, doWhat?: Panel) => {
      const next = new URLSearchParams(params);
      if (t) next.set('task', t.id);
      else next.delete('task');
      if (t && doWhat) next.set('do', doWhat);
      else next.delete('do');
      setParams(next, { replace: !t });
    },
    [params, setParams],
  );
  return { task, panel, open };
}

export function TaskHost({ data, reload }: { data: WorkData | null; reload: () => void }) {
  const { task, panel, open } = useOpenTask(data);
  if (!data || !task) return null;
  return <TaskDrawer task={task} people={data.people} initialPanel={panel} onClose={() => open(null)} onChanged={reload} />;
}
