import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Badge, Modal } from './ui';

interface TeamMember {
  id: string;
  email: string;
  roles: string[];
  driverId: string | null;
  driverName: string | null;
}

export function LinkDriverModal({
  open,
  onClose,
  driver,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  driver: { id: string; name: string } | null;
  onSaved?: () => void;
}) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<{ members: TeamMember[] }>('/api/team');
      setMembers(data.members);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load team accounts');
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    void load();
  }, [open, load]);

  const link = async (member: TeamMember) => {
    if (busyId) return;
    setBusyId(member.id);
    setError(null);
    try {
      await api(`/api/team/users/${member.id}/driver`, {
        method: 'PATCH',
        body: { driverId: driver?.id ?? null },
      });
      onSaved?.();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the link');
    } finally {
      setBusyId(null);
    }
  };

  const unlink = async (member: TeamMember) => {
    if (busyId) return;
    setBusyId(member.id);
    setError(null);
    try {
      await api(`/api/team/users/${member.id}/driver`, {
        method: 'PATCH',
        body: { driverId: null },
      });
      onSaved?.();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the link');
    } finally {
      setBusyId(null);
    }
  };

  const candidates = members.filter((m) => m.roles.includes('DRIVER'));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={driver ? `Link a login to ${driver.name}` : 'Link a login to a driver'}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </>
      }
    >
      {error && <div className="alert alert-error">{error}</div>}

      <p className="muted small" style={{ marginTop: 0 }}>
        Pick which team login drives for {driver?.name}. The driver signs in with that
        email and lands in the driver app with this profile (My Trips, duty status, HOS, fuel).
      </p>

      {candidates.length === 0 ? (
        <p className="muted small">
          No DRIVER logins exist in this team yet — invite one on the Team &amp; invites page and
          pick this driver in the invite.
        </p>
      ) : (
        <ul className="doc-list">
          {candidates.map((m) => {
            const linkedHere = m.driverId === driver?.id;
            const linkedElsewhere = m.driverId && m.driverId !== driver?.id;
            return (
              <li key={m.id} className="doc-item">
                <div>
                  <strong>{m.email}</strong>
                  <div className="muted small">
                    {linkedHere
                      ? `Linked to ${driver?.name}`
                      : linkedElsewhere
                        ? `Linked to ${m.driverName ?? 'another driver'}`
                        : 'No driver linked'}
                  </div>
                </div>
                <span className="row-actions" style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {linkedHere ? (
                    <>
                      <Badge tone="green">Linked</Badge>
                      <button className="btn-sm" disabled={busyId === m.id} onClick={() => void unlink(m)}>
                        Unlink
                      </button>
                    </>
                  ) : (
                    <button className="btn-sm" disabled={busyId === m.id} onClick={() => void link(m)}>
                      {linkedElsewhere ? 'Reassign here' : 'Link'}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '18px 0' }} />
      <p className="muted small" style={{ marginBottom: 0 }}>
        Linking takes effect on the driver's next sign-in or token refresh — no re-invite needed.
      </p>
    </Modal>
  );
}