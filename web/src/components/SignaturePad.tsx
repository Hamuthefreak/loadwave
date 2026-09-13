import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Modal } from './ui';

export type SignatureRole = 'RECEIVER' | 'CARRIER' | 'BROKER';

const ROLES: Array<{ value: SignatureRole; label: string }> = [
  { value: 'RECEIVER', label: 'Receiver (at delivery)' },
  { value: 'CARRIER', label: 'Carrier (driver)' },
  { value: 'BROKER', label: 'Broker / customer' },
];

const PAD_HEIGHT = 170;

/**
 * Capture a signature on a phone or a desktop.
 *
 * The drawing goes straight onto a canvas and is submitted as a JPEG, which is
 * the format the delivery packet embeds — so what is signed here is what a
 * factor sees, with no re-rendering step that could change it.
 *
 * Pointer events cover mouse, finger and stylus in one path, and
 * `touch-action: none` on the canvas stops the sheet scrolling out from under
 * the pen while somebody is signing.
 */
export function SignaturePad({
  open,
  loadId,
  laneLabel,
  defaultRole = 'RECEIVER',
  onClose,
  onSigned,
  /**
   * Post the capture somewhere other than a load's POD. A settlement statement
   * is signed with the same pad and the same drawn bytes — one capture path, so
   * what a driver draws at the yard is what the PDF embeds, whether it goes on a
   * delivery packet or a pay statement.
   */
  endpoint,
  extraBody,
  roles,
  title,
  hint,
}: {
  open: boolean;
  loadId?: string | null;
  laneLabel?: string;
  defaultRole?: SignatureRole | string;
  onClose: () => void;
  onSigned?: () => void;
  endpoint?: string;
  extraBody?: Record<string, unknown>;
  roles?: Array<{ value: string; label: string }>;
  title?: string;
  hint?: string;
}) {
  const roleOptions = roles ?? ROLES;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [role, setRole] = useState<string>(defaultRole);
  const [signerName, setSignerName] = useState('');
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Strokes live in CSS pixels rather than only in the bitmap, so the signature
  // can be re-painted after the canvas changes size. Sizing the backing store
  // alone would leave the ink stretched the moment a phone is turned sideways
  // mid-signature — and a stretched signature is a bad thing to send a factor.
  const strokes = useRef<Array<Array<{ x: number; y: number }>>>([]);

  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // A white base, not transparent: a JPEG has no alpha, so an unpainted
    // canvas would come back as a black rectangle in the PDF.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#101828';
    for (const stroke of strokes.current) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      if (stroke.length === 1) {
        // A tap is still a mark.
        ctx.lineTo(stroke[0].x + 0.1, stroke[0].y);
      } else {
        for (let i = 1; i < stroke.length; i += 1) ctx.lineTo(stroke[i].x, stroke[i].y);
      }
      ctx.stroke();
    }
  }, []);

  /** Match the backing store to the laid-out size, then repaint what is drawn. */
  const syncCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || canvas.parentElement?.clientWidth || 320;
    const nextWidth = Math.max(1, Math.round(cssWidth * dpr));
    const nextHeight = Math.max(1, Math.round(PAD_HEIGHT * dpr));
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }
    repaint();
  }, [repaint]);

  const resetCanvas = useCallback(() => {
    strokes.current = [];
    setHasInk(false);
    syncCanvas();
  }, [syncCanvas]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setRole(defaultRole);
    setSignerName('');
    strokes.current = [];
    setHasInk(false);
    // Wait for the sheet to be laid out before measuring the canvas.
    const id = window.setTimeout(syncCanvas, 60);
    // Turning the phone changes the canvas width: re-fit and repaint rather
    // than leaving the ink on a stale bitmap.
    const onResize = () => syncCanvas();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [open, defaultRole, syncCanvas]);

  const positionOf = (event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const startStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    try {
      // Keeps the stroke alive if the finger slides off the pad. Optional and
      // non-fatal on WebViews that refuse it, so ink is never lost to it.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* not supported here — the stroke still records via move events */
    }
    drawing.current = true;
    const point = positionOf(event);
    strokes.current.push([point]);
    // Round caps turn the zero-length segment into a dot, so a deliberate tap
    // leaves a mark instead of nothing at all.
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x + 0.1, point.y);
    ctx.stroke();
    if (!hasInk) setHasInk(true);
  };

  const extendStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const point = positionOf(event);
    const stroke = strokes.current[strokes.current.length - 1];
    if (!stroke) return;
    const previous = stroke[stroke.length - 1];
    stroke.push(point);
    // Only the new segment is painted. Re-stroking the whole path on every move
    // would darken and thicken the line as it grew, so the signature on screen
    // would not match the one a repaint (or a rotation) produces.
    ctx.beginPath();
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  };

  const endStroke = () => {
    drawing.current = false;
  };

  const save = async () => {
    if (busy) return;
    if (!endpoint && !loadId) return;
    if (signerName.trim().length < 2) {
      setError('Please type the name of the person signing.');
      return;
    }
    if (!hasInk) {
      setError('Please sign in the box above.');
      return;
    }
    const canvas = canvasRef.current;
    const dataUrl = canvas?.toDataURL('image/jpeg', 0.9) ?? '';
    const base64 = dataUrl.split(',')[1] ?? '';
    if (!base64) {
      setError('Could not read the signature — please try again.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api(endpoint ?? `/api/loads/${loadId}/signatures`, {
        method: 'POST',
        body: { role, signerName: signerName.trim(), data: base64, ...(extraBody ?? {}) },
      });
      onSigned?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the signature.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title ?? 'Capture signature'}
      footer={
        <>
          <button className="btn-ghost" onClick={() => resetCanvas()} disabled={busy}>
            Clear
          </button>
          <button className="btn-green" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save signature'}
          </button>
        </>
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        {hint ??
          (laneLabel
            ? `Signature for ${laneLabel}. It goes on the delivery packet next to the rate and route.`
            : 'The signature goes on the delivery packet next to the rate and route.')}
      </p>

      <label>
        Signed by
        <input
          value={signerName}
          onChange={(e) => setSignerName(e.target.value)}
          placeholder="Name of the person signing"
          maxLength={120}
          autoComplete="off"
        />
      </label>

      <label>
        Signing as
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          {roleOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div className="signature-pad">
        <canvas
          ref={canvasRef}
          className="signature-canvas"
          style={{ height: PAD_HEIGHT, width: '100%', touchAction: 'none' }}
          onPointerDown={startStroke}
          onPointerMove={extendStroke}
          onPointerUp={endStroke}
          onPointerLeave={endStroke}
          onPointerCancel={endStroke}
          aria-label="Signature box — draw with a finger, stylus or mouse"
        />
        <p className="muted small signature-hint">Draw with a finger, stylus or mouse.</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
    </Modal>
  );
}
