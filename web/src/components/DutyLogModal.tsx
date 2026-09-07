import { Modal } from './ui';

export interface HosDaySegment {
  dutyStatus: string;
  startTime: string;
  endTime: string | null;
}

export interface HosDayRow {
  date: string;
  onDutyMinutes: number;
  offDutyMinutes: number;
  segments: HosDaySegment[];
}

export interface HosDailyLogRow {
  driverId: string;
  timezone: string;
  days: HosDayRow[];
}

// Row order matches an ELD logbook: off duty at the bottom of the sheet,
// driving at the top of the on-duty stack.
const STATUS_ORDER = ['DRIVING', 'ON_DUTY_NOT_DRIVING', 'SLEEPER_BERTH', 'OFF_DUTY'] as const;

const STATUS_LABEL: Record<string, string> = {
  DRIVING: 'Driving',
  ON_DUTY_NOT_DRIVING: 'On duty, not driving',
  SLEEPER_BERTH: 'Sleeper berth',
  OFF_DUTY: 'Off duty',
};

// Muted tones that hold up on both themes.
const STATUS_COLOR: Record<string, string> = {
  DRIVING: '#2ea869',
  ON_DUTY_NOT_DRIVING: '#e8a13c',
  SLEEPER_BERTH: '#5b9bd5',
  OFF_DUTY: '#8b949e',
};

function minutesOfDay(iso: string, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

function localTime(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  return `${parts.find((p) => p.type === 'hour')?.value}:${parts.find((p) => p.type === 'minute')?.value}`;
}

function fmtMinutes(min: number): string {
  const whole = Math.floor(min / 60);
  const rest = Math.round(min % 60);
  if (rest >= 60) return `${whole + 1}h`;
  return rest === 0 ? `${whole}h` : `${whole}h ${rest}m`;
}

/**
 * ELD-style view of one calendar day: the classic 24-hour status grid
 * (colored blocks per duty status) plus a timed segment list underneath.
 */
export default function DutyLogModal({
  day,
  timezone,
  onClose,
}: {
  day: HosDayRow | null;
  timezone: string;
  onClose: () => void;
}) {
  if (!day) return null;
  const tz = timezone || 'UTC';

  const dateLabel = new Date(`${day.date}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="wide"
      title={`Duty log · ${dateLabel}`}
      footer={
        <div className="eld-total">
          <span>On duty <strong>{fmtMinutes(day.onDutyMinutes)}</strong></span>
          <span>Off duty <strong>{fmtMinutes(day.offDutyMinutes)}</strong></span>
          <span className="muted small" style={{ marginLeft: 'auto' }}>
            Times in {tz.replace('America/', '')} time
          </span>
        </div>
      }
    >
      <div className="eld-log">
        <div className="eld-axis">
          <span />
          <span className="eld-axis-tick">
            <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>
          </span>
        </div>

        {STATUS_ORDER.map((status) => {
          const segs = day.segments.filter((s) => s.dutyStatus === status);
          return (
            <div className="eld-row" key={status}>
              <span className="eld-label">
                <i style={{ background: STATUS_COLOR[status] ?? '#8b949e' }} aria-hidden />
                {STATUS_LABEL[status] ?? status}
              </span>
              <div className="eld-track">
                {segs.map((seg, i) => {
                  const start = minutesOfDay(seg.startTime, tz);
                  const end = seg.endTime ? minutesOfDay(seg.endTime, tz) : 1440;
                  const left = (start / 1440) * 100;
                  const width = Math.max(((end - start) / 1440) * 100, 0.6);
                  return (
                    <span
                      key={i}
                      className="eld-block"
                      style={{ left: `${left}%`, width: `${width}%`, background: STATUS_COLOR[status] ?? '#8b949e' }}
                      title={`${STATUS_LABEL[status] ?? status} ${localTime(seg.startTime, tz)}–${seg.endTime ? localTime(seg.endTime, tz) : 'now'}`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {day.segments.length > 0 ? (
        <ul className="eld-list">
          {day.segments.map((seg, i) => {
            const duration = seg.endTime
              ? (new Date(seg.endTime).getTime() - new Date(seg.startTime).getTime()) / 60_000
              : null;
            return (
              <li key={i}>
                <span className="eld-dot" style={{ background: STATUS_COLOR[seg.dutyStatus] ?? '#8b949e' }} aria-hidden />
                <span className="eld-list-status">{STATUS_LABEL[seg.dutyStatus] ?? seg.dutyStatus}</span>
                <span className="eld-list-time">
                  {localTime(seg.startTime, tz)} – {seg.endTime ? localTime(seg.endTime, tz) : 'now'}
                </span>
                <span className="eld-list-dur">
                  {duration !== null ? fmtMinutes(duration) : 'in progress'}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted small" style={{ marginTop: 14 }}>
          No duty recorded this day — the driver was signed out.
        </p>
      )}
    </Modal>
  );
}