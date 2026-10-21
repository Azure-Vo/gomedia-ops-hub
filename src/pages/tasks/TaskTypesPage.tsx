import { useState } from 'react';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Modal, PageHeader, useAsync, useToast } from '@/components/ui';
import { check, supabase } from '@/lib/supabase';
import { loadTypes, TaskType, typeMilestones } from './data';

interface Draft {
  id?: string;
  name: string;
  ms: string[];
}

export function TaskTypesPage() {
  const toast = useToast();
  const [edit, setEdit] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useAsync(() => loadTypes(true), []);

  async function save() {
    if (!edit) return;
    if (!edit.name.trim() || edit.ms.some((m) => !m.trim())) {
      toast('Nhập tên loại và đủ 4 mốc.', 'bad');
      return;
    }
    setBusy(true);
    try {
      const row = { name: edit.name.trim(), milestone_1: edit.ms[0].trim(), milestone_2: edit.ms[1].trim(), milestone_3: edit.ms[2].trim(), milestone_4: edit.ms[3].trim() };
      if (edit.id) check(await supabase.from('task_types').update(row).eq('id', edit.id));
      else check(await supabase.from('task_types').insert(row));
      toast('Đã lưu loại task. Task tạo sau sẽ dùng 4 mốc mới; task cũ giữ nguyên.');
      setEdit(null);
      reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(t: TaskType) {
    try {
      check(await supabase.from('task_types').update({ active: !t.active }).eq('id', t.id));
      reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  return (
    <div>
      <PageHeader
        title="Loại task & 4 mốc chuẩn"
        subtitle="Mỗi loại task có 4 mốc kiểm chứng được (có sản phẩm hoặc bằng chứng). Bot hỏi mốc 1 ở 25% thời gian, mốc 2 ở 50%, mốc 3 ở 75%, mốc 4 ở 99%."
        actions={
          <Button icon="plus" onClick={() => setEdit({ name: '', ms: ['', '', '', ''] })}>
            Thêm loại task
          </Button>
        }
      />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data!.map((t) => (
            <Card
              key={t.id}
              title={
                <span className="flex items-center gap-2">
                  {t.name} {!t.active && <Badge>Đã tắt</Badge>}
                </span>
              }
              actions={
                <>
                  <Button size="sm" variant="ghost" icon="edit" onClick={() => setEdit({ id: t.id, name: t.name, ms: typeMilestones(t) })}>
                    Sửa
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle(t)}>
                    {t.active ? 'Tắt' : 'Bật'}
                  </Button>
                </>
              }
            >
              <ol className="flex flex-col gap-1.5 text-[14.5px]">
                {typeMilestones(t).map((m, i) => (
                  <li key={i}>
                    <span className="font-semibold text-ink-3">{[25, 50, 75, 99][i]}% · </span>
                    {m}
                  </li>
                ))}
              </ol>
            </Card>
          ))}
        </div>
      )}
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Sửa loại task' : 'Thêm loại task'}
        footer={
          <Button busy={busy} onClick={save}>
            Lưu
          </Button>
        }
      >
        {edit && (
          <div className="flex flex-col gap-3">
            <Field label="Tên loại">{(id) => <Input id={id} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />}</Field>
            {edit.ms.map((m, i) => (
              <Field key={i} label={`Mốc ${i + 1} (${[25, 50, 75, 99][i]}%)`}>
                {(id) => (
                  <Input
                    id={id}
                    value={m}
                    onChange={(e) => {
                      const ms = [...edit.ms];
                      ms[i] = e.target.value;
                      setEdit({ ...edit, ms });
                    }}
                  />
                )}
              </Field>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
