import { useEffect, useRef, useState } from 'react';
import { Button, Card, cx, useAsync, useToast } from '@/components/ui';
import { callApi } from '@/lib/api';
import { fmtVnDateTime } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import { loadMySignature, loadSignature } from '@/pages/quotes/data';

const W = 600;
const H = 220;

/**
 * 1.7 · The CEO's signature image, printed on quotes the CEO signs in the app (and on quick quotes
 * inside the price band). Draw it, or upload a photo/scan: the white paper is made transparent.
 */
export function SignatureCard({ mine = false }: { mine?: boolean } = {}) {
  const { tz } = useSettings();
  const toast = useToast();
  const current = useAsync(mine ? loadMySignature : loadSignature, [mine]);
  const [mode, setMode] = useState<'view' | 'draw'>('view');
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  async function save(image: string | null) {
    setBusy(true);
    try {
      await callApi(mine ? 'profile.signature' : 'quote.signature', { image });
      toast(image ? 'Đã lưu chữ ký mẫu' : 'Đã xoá chữ ký mẫu');
      setDraft(null);
      setMode('view');
      current.reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  const shown = draft ?? current.data?.image ?? null;
  return (
    <Card
      title={mine ? 'Chữ ký của tôi (người lập)' : 'Chữ ký mẫu trên báo giá'}
      subtitle={mine ? 'In ở ô "Người lập" khi bạn gửi duyệt hoặc gửi khách.' : 'In lên báo giá khi bạn bấm Duyệt & ký.'}
      info={mine ? 'Báo giá có 3 chữ ký: người lập (Account), đại diện Go Media (CEO) và khách hàng (ký qua link).' : 'Ảnh chữ ký, không phải chữ ký số theo luật giao dịch điện tử. Báo giá nhanh trong khung giá cũng in chữ ký này, không cần chờ ký.'}
    >
      {mode === 'draw' ? (
        <DrawPad onDone={(img) => (setDraft(img), setMode('view'))} onCancel={() => setMode('view')} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid h-[120px] place-items-center rounded-lg border border-dashed border-line bg-white">
            {shown ? <img src={shown} alt="Chữ ký mẫu" className="max-h-[100px] max-w-[90%]" /> : <span className="text-[14px] text-ink-3">Chưa có chữ ký</span>}
          </div>
          {current.data && !draft && <p className="text-[12.5px] text-ink-3">Cập nhật {fmtVnDateTime(current.data.updated_at, tz)}</p>}
          {draft && <p className="text-[13px] font-medium text-warn">Chưa lưu. Kiểm tra rồi bấm Lưu.</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon="edit" onClick={() => setMode('draw')}>
              Vẽ chữ ký
            </Button>
            <Button variant="secondary" icon="upload" onClick={() => file.current?.click()}>
              Tải ảnh
            </Button>
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try {
                  setDraft(await cleanImage(f));
                } catch {
                  toast('Không đọc được ảnh này.', 'bad');
                }
              }}
            />
            {draft && (
              <Button icon="check" busy={busy} onClick={() => save(draft)}>
                Lưu
              </Button>
            )}
            {!draft && current.data && (
              <Button variant="ghost" busy={busy} onClick={() => window.confirm('Xoá chữ ký mẫu? Sau đó không ký được báo giá cho tới khi có chữ ký mới.') && save(null)}>
                Xoá
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

export function DrawPad({ onDone, onCancel }: { onDone: (img: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [empty, setEmpty] = useState(true);
  const drawing = useRef(false);
  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!;
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0B1F5C';
  }, []);
  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H] as const;
  };
  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={ref}
        width={W}
        height={H}
        aria-label="Vùng vẽ chữ ký"
        className={cx('w-full touch-none rounded-lg border border-line bg-white', 'cursor-crosshair')}
        style={{ aspectRatio: `${W} / ${H}` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const c = e.currentTarget.getContext('2d')!;
          const [x, y] = at(e);
          c.beginPath();
          c.moveTo(x, y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const c = e.currentTarget.getContext('2d')!;
          const [x, y] = at(e);
          c.lineTo(x, y);
          c.stroke();
          setEmpty(false);
        }}
        onPointerUp={() => (drawing.current = false)}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Huỷ
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            ref.current!.getContext('2d')!.clearRect(0, 0, W, H);
            setEmpty(true);
          }}
        >
          Vẽ lại
        </Button>
        <Button icon="check" disabled={empty} onClick={() => onDone(trim(ref.current!))}>
          Dùng chữ ký này
        </Button>
      </div>
    </div>
  );
}

/** Photo or scan → transparent PNG: near-white pixels become transparent, then the margins are trimmed. */
async function cleanImage(f: File): Promise<string> {
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = bad;
      i.src = url;
    });
    const scale = Math.min(1, 900 / img.width, 360 / img.height);
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) {
      const light = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3;
      if (light > 200) d.data[i + 3] = 0;
      else if (light > 150) d.data[i + 3] = Math.round(((200 - light) / 50) * 255);
    }
    ctx.putImageData(d, 0, 0);
    return trim(c);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Crop to the drawn pixels plus a small margin, at most 600×220. */
function trim(src: HTMLCanvasElement): string {
  const ctx = src.getContext('2d')!;
  const { data, width, height } = ctx.getImageData(0, 0, src.width, src.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 20) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return src.toDataURL('image/png');
  const pad = 8;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const k = Math.min(1, W / w, H / h);
  const out = document.createElement('canvas');
  out.width = Math.round(w * k);
  out.height = Math.round(h * k);
  out.getContext('2d')!.drawImage(src, x0, y0, w, h, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}
