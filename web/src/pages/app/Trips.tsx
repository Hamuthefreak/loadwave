import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { Badge, Empty, Lane, Modal, PageHeader, Spinner } from '../../components/ui';
import { FuelLogButton } from '../../components/FuelLogger';
import { km, money, perMile, regionLabel, shortDate } from '../../utils/format';
import { equipmentLabel } from './regions';

interface Trip {
  id: string;
  originCountry: string;
  originRegion: string;
  originLocality: string | null;
  destinationCountry: string;
  destinationRegion: string;
  destinationLocality: string | null;
  status: string;
  distanceKmEstimate: string | null;
  pickupDate: string | null;
  deliveryDate: string | null;
  pickupFlexible: boolean;
  commodity: string | null;
  weightKg: string | null;
  equipmentType: string | null;
  detentionRate: string | null;
  stopCount: number;
  freightCurrency: string;
  freightAmountBase: string | null;
  freightAmountTransaction: string | null;
  createdAt: string;
}

const ACTIVE_STATUSES = new Set(['ASSIGNED', 'IN_TRANSIT']);
const DONE_STATUSES = new Set(['DELIVERED', 'INVOICED']);

function statusTone(status: string): 'green' | 'amber' | 'gray' | 'cyan' {
  if (status === 'ASSIGNED') return 'cyan';
  if (status === 'IN_TRANSIT') return 'amber';
  if (status === 'DELIVERED' || status === 'INVOICED') return 'green';
  return 'gray';
}

function statusLabel(status: string): string {
  if (status === 'ASSIGNED') return 'Assigned to you';
  if (status === 'IN_TRANSIT') return 'In transit';
  if (status === 'DELIVERED') return 'Delivered';
  if (status === 'INVOICED') return 'Invoiced';
  return status;
}

function locality(country: string, region: string, name: string | null): string {
  return name ? `${name}, ${regionLabel(region)}` : `${regionLabel(region)} (${country})`;
}

export default function Trips() {
  const [rows, setRows] = useState<Trip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deliver, setDeliver] = useState<Trip | null>(null);
  const [deliverBusy, setDeliverBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await api<Trip[]>('/api/loads/mine'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load your trips');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const advance = async (trip: Trip, status: string, doneMsg: string) => {
    if (busyId) return;
    setBusyId(trip.id);
    setError(null);
    try {
      await api(`/api/loads/${trip.id}/status`, { method: 'PATCH', body: { status } });
      setFlash(doneMsg);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed — try again');
    } finally {
      setBusyId(null);
    }
  };

  const startTrip = (trip: Trip) => void advance(trip, 'IN_TRANSIT', 'Trip started — drive safe!');
  const confirmDeliver = async () => {
    if (!deliver || deliverBusy) return;
    setDeliverBusy(true);
    setError(null);
    try {
      await api(`/api/loads/${deliver.id}/status`, { method: 'PATCH', body: { status: 'DELIVERED' } });
      setFlash('Delivered! Flip to Off duty in the sidebar when you wrap up.');
      setDeliver(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not mark delivered');
    } finally {
      setDeliverBusy(false);
    }
  };

  const active = (rows ?? []).filter((t) => ACTIVE_STATUSES.has(t.status));
  const done = (rows ?? []).filter((t) => DONE_STATUSES.has(t.status));

  const section = (title: string, trips: Trip[]) =>
    trips.length > 0 && (
      <section>
        <div className="section-sub">{title}</div>
        <div className="trip-list">
          {trips.map((t) => (
            <TripCard
              key={t.id}
              trip={t}
              busy={busyId === t.id}
              onStart={() => startTrip(t)}
              onDeliver={() => setDeliver(t)}
              onLogFuel={() => setFlash('Fuel stop logged — it’s saved to your fleet fuel records & IFTA.')}
            />
          ))}
        </div>
      </section>
    );

  return (
    <div>
      <PageHeader
        title="My Trips"
        sub="Loads your dispatcher has sent your way — start them, run them, mark them delivered."
        actions={<button className="btn-ghost" onClick={() => void load()}>↻ Refresh</button>}
      />

      {flash && <div className="alert alert-success" style={{ marginBottom: 16 }}>{flash}</div>}
      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <Spinner label="Loading your trips…" />
      ) : (rows ?? []).length === 0 ? (
        <Empty
          title="No trips yet"
          sub="When your dispatcher assigns you a load it shows up here — usually right after they pick you in My Loads."
          action={
            <button className="btn-ghost" onClick={() => void load()}>Check again</button>
          }
        />
      ) : (
        <div className="trip-sections">
          {section('On the go', active)}
          {section('Completed', done)}
          {active.length === 0 && done.length === 0 && (
            <Empty
              title="Nothing happening"
              sub="Any loads assigned to you outside the active flow will land here for your dispatcher to sort out."
            />
          )}
        </div>
      )}

      <Modal
        open={deliver !== null}
        onClose={() => setDeliver(null)}
        title="Mark delivered?"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setDeliver(null)}>Not yet</button>
            <button className="btn-green" onClick={() => void confirmDeliver()} disabled={deliverBusy}>
              {deliverBusy ? 'Confirming…' : 'Delivered'}
            </button>
          </>
        }
      >
        {deliver && (
          <div>
            <p className="muted" style={{ marginTop: 0 }}>
              This tells dispatch the freight is off your truck at{' '}
              <strong>{locality(deliver.destinationCountry, deliver.destinationRegion, deliver.destinationLocality)}</strong>.
              They'll take it from here (invoice time).
            </p>
            <p className="muted small" style={{ marginBottom: 0 }}>
              Tip: flip yourself to <strong>Off duty</strong> after you finish for the day — it's the
              toggle in the sidebar.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function TripCard({
  trip,
  busy,
  onStart,
  onDeliver,
  onLogFuel,
}: {
  trip: Trip;
  busy: boolean;
  onStart: () => void;
  onDeliver: () => void;
  onLogFuel: () => void;
}) {
  const rate = trip.freightAmountBase ?? trip.freightAmountTransaction;
  const pm = perMile(rate, trip.distanceKmEstimate);
  const pickupWindow = trip.pickupDate
    ? `${shortDate(trip.pickupDate)}${trip.pickupFlexible ? ' (flexible)' : ''}`
    : 'ASAP / on dispatch';

  return (
    <div className="card trip-card">
      <div className="trip-head">
        <Lane
          big
          originCountry={trip.originCountry}
          originRegion={trip.originRegion}
          destinationCountry={trip.destinationCountry}
          destinationRegion={trip.destinationRegion}
        />
        <div className="trip-head-side">
          <Badge tone={statusTone(trip.status)}>{statusLabel(trip.status)}</Badge>
          {rate != null && (
            <div className="trip-amount">{money(rate, trip.freightCurrency)}</div>
          )}
          {pm && <div className="muted small">{pm}/mi</div>}
        </div>
      </div>

      <dl className="trip-facts">
        <div className="trip-fact">
          <dt>Pickup</dt>
          <dd>
            {locality(trip.originCountry, trip.originRegion, trip.originLocality)}
            <span className="muted small"> · {pickupWindow}</span>
          </dd>
        </div>
        <div className="trip-fact">
          <dt>Deliver by</dt>
          <dd>{trip.deliveryDate ? shortDate(trip.deliveryDate) : '—'}</dd>
        </div>
        <div className="trip-fact">
          <dt>Load</dt>
          <dd>{trip.commodity ?? 'General freight'}</dd>
        </div>
        <div className="trip-fact">
          <dt>Weight</dt>
          <dd>{trip.weightKg ? `${Number(trip.weightKg).toLocaleString('en-CA')} kg` : '—'}</dd>
        </div>
        {trip.equipmentType && (
          <div className="trip-fact">
            <dt>Equipment</dt>
            <dd>{equipmentLabel(trip.equipmentType)}</dd>
          </div>
        )}
        <div className="trip-fact">
          <dt>Distance</dt>
          <dd>{km(trip.distanceKmEstimate)}</dd>
        </div>
      </dl>

      {(trip.status === 'ASSIGNED' || trip.status === 'IN_TRANSIT') && (
        <div className="trip-actions">
          <FuelLogButton label="Log fuel" onLogged={onLogFuel} />
          {trip.status === 'ASSIGNED' && (
            <button className="btn-green" onClick={onStart} disabled={busy}>
              {busy ? 'Starting…' : 'Start trip'}
            </button>
          )}
          {trip.status === 'IN_TRANSIT' && (
            <button className="btn-green" onClick={onDeliver} disabled={busy}>
              {busy ? 'Updating…' : 'Mark delivered'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
