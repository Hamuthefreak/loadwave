import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, roleLabels } from '../../api';
import { Badge, Modal, PageHeader, Spinner } from '../../components/ui';
import { shortDate } from '../../utils/format';

interface MemberRow {
  id: string;
  email: string;
  roles: string[];
  driverId: string | null;
  driverName: string | null;
  createdAt: string;
}

interface InviteRow {
  id: string;
  email: string;
  roles: string[];
  driverId: string | null;
  driverName: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
}

interface TeamData {
  members: MemberRow[];
  invites: InviteRow[];
}

interface DriverMini {
  id: string;
  name: string;
  status: string;
}

const ROLE_OPTIONS = [
  { value: 'DISPATCHER', label: 'Dispatcher', hint: 'Runs the office: posts loads, fuel, IFTA, fleet & drivers' },
  { value: 'DRIVER', label: 'Driver', hint: 'Sees the board and their driver app — must be linked to a driver record' },
  { value: 'ADMIN', label: 'Admin', hint: 'Full control including team invites' },
];

export default function Team() {
  const [data, setData] = useState<TeamData | null>(null);
  const [drivers, setDrivers] = useState<DriverMini[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null); // inviteId for the row, or 'modal'

  const load = useCallback(async () => {
    setError(null);
    try {
      const [team, driverRows] = await Promise.all([
        api<TeamData>('/api/team'),
        api<DriverMini[]>('/api/drivers').catch(() => []),
      ]);
      setData(team);
      setDrivers(driverRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load team');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const inviteLink = (token: string) => `${window.location.origin}/signin?invite=${encodeURIComponent(token)}`;

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false; // clipboard unavailable — the link stays visible to copy manually
    }
  };

  const copyInviteLink = async (invite: InviteRow) => {
    // The raw token is only stored hashed, so sharing a link mints a fresh one.
    try {
      const res = await api<{ token: string }>(`/api/team/invites/${invite.id}/resend`, { method: 'POST', body: {} });
      await copyText(inviteLink(res.token));
      setCopied(invite.id);
      setTimeout(() => setCopied(null), 1800);
      await load(); // refresh the expiry shown in the row
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create invite link');
    }
  };

  const revoke = async (invite: InviteRow) => {
    setError(null);
    try {
      await api(`/api/team/invites/${invite.id}/revoke`, { method: 'POST', body: {} });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke invite');
    }
  };

  const copyCreated = async () => {
    if (!createdToken) return;
    await copyText(inviteLink(createdToken));
    setCopied('modal');
    setTimeout(() => setCopied(null), 1800);
  };

  const pending = (data?.invites ?? []).filter((i) => i.status === 'PENDING');

  return (
    <div>
      <PageHeader
        title="Team & invites"
        sub="Give dispatchers and drivers their own sign-in to this carrier."
        actions={<button className="btn-green" onClick={() => setShowInvite(true)}>+ Invite someone</button>}
      />

      {error && <div className="alert alert-error">{error}</div>}

      {loading || !data ? (
        <Spinner label="Loading team…" />
      ) : (
        <>
          <h2>Members ({data.members.length})</h2>
          {data.members.length === 0 ? (
            <p className="muted small">No members yet.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Linked driver</th>
                    <th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((m) => (
                    <tr key={m.id}>
                      <td><strong>{m.email}</strong></td>
                      <td>
                        <span className="badge-row">
                          {roleLabels(m.roles).map((r) => (
                            <Badge key={r} tone={r === 'Admin' ? 'purple' : r === 'Driver' ? 'cyan' : 'blue'}>{r}</Badge>
                          ))}
                        </span>
                      </td>
                      <td>{m.driverName ?? <span className="muted">—</span>}</td>
                      <td className="muted">{shortDate(m.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2>Pending invites ({pending.length})</h2>
          {pending.length === 0 ? (
            <p className="muted small">No invites waiting — send one above.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Sent</th>
                    <th>Expires</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((i) => (
                    <tr key={i.id}>
                      <td><strong>{i.email}</strong></td>
                      <td>
                        <span className="badge-row">
                          {roleLabels(i.roles).map((r) => (
                            <Badge key={r} tone={r === 'Admin' ? 'purple' : r === 'Driver' ? 'cyan' : 'blue'}>{r}</Badge>
                          ))}
                        </span>
                      </td>
                      <td className="muted">{shortDate(i.createdAt)}</td>
                      <td className="muted">{shortDate(i.expiresAt)}</td>
                      <td>
                        <span className="invite-actions">
                          <button className="btn-sm btn-ghost" onClick={() => void copyInviteLink(i)}>
                            {copied === i.id ? 'Copied ✓' : 'Copy invite link'}
                          </button>
                          <button className="btn-sm btn-danger-ghost" onClick={() => void revoke(i)}>Revoke</button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.invites.some((i) => i.status !== 'PENDING') && (
            <>
              <h2>History</h2>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.invites
                      .filter((i) => i.status !== 'PENDING')
                      .map((i) => (
                        <tr key={i.id}>
                          <td>{i.email}</td>
                          <td className="muted">{roleLabels(i.roles).join(' · ')}</td>
                          <td>
                            <Badge tone={i.status === 'ACCEPTED' ? 'green' : i.status === 'REVOKED' ? 'red' : 'gray'}>{i.status}</Badge>
                          </td>
                          <td className="muted">{shortDate(i.createdAt)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      <InviteModal
        open={showInvite}
        drivers={drivers}
        existingEmails={data?.members.map((m) => m.email) ?? []}
        onClose={() => setShowInvite(false)}
        onCreated={(token) => {
          setShowInvite(false);
          setCreatedToken(token);
          void load();
        }}
      />

      <Modal
        open={createdToken !== null}
        onClose={() => setCreatedToken(null)}
        title="Invite created"
        footer={
          <button className="btn-green" onClick={() => setCreatedToken(null)}>Done</button>
        }
      >
        <p className="muted small" style={{ margin: 0 }}>
          Send this link to the person you invited. It works for 7 days, is single-use, and
          signs them in as soon as they finish setting a password. (Email delivery isn't wired
          up yet — copy and share it yourself.)
        </p>
        <div className="invite-link-row">
          <code className="invite-link">{createdToken ? inviteLink(createdToken) : ''}</code>
          <button className="btn-sm btn-ghost" onClick={() => void copyCreated()}>
            {copied === 'modal' ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function InviteModal({
  open,
  drivers,
  existingEmails,
  onClose,
  onCreated,
}: {
  open: boolean;
  drivers: DriverMini[];
  existingEmails: string[];
  onClose: () => void;
  onCreated: (token: string) => void;
}) {
  const [role, setRole] = useState('DISPATCHER');
  const [driverId, setDriverId] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRole('DISPATCHER');
    setDriverId('');
    setEmail('');
    setError(null);
  }, [open]);

  const wantsDriver = role === 'DRIVER';
  const activeDrivers = drivers.filter((d) => d.status === 'ACTIVE');
  const missingDriver = wantsDriver && !driverId;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ token: string }>('/api/team/invites', {
        method: 'POST',
        body: {
          email,
          roles: [role],
          ...(wantsDriver ? { driverId } : {}),
        },
      });
      onCreated(res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invite');
    } finally {
      setSaving(false);
    }
  };

  const emailTaken = existingEmails.includes(email.trim().toLowerCase());

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite someone"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="btn-green"
            onClick={submit}
            disabled={saving || missingDriver || emailTaken}
          >
            {saving ? 'Creating…' : 'Create invite'}
          </button>
        </>
      }
    >
      <form id="invite-team" onSubmit={submit} className="drawer-form">
        {error && <div className="alert alert-error">{error}</div>}
        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value.toLowerCase())}
            placeholder="driver@carrier.ca"
            autoComplete="off"
          />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => { setRole(e.target.value); setDriverId(''); }}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          <span className="small muted">{ROLE_OPTIONS.find((r) => r.value === role)?.hint}</span>
        </label>
        {wantsDriver && (
          <label>
            Driver record
            <select value={driverId} onChange={(e) => setDriverId(e.target.value)} required>
              <option value="">Select the driver…</option>
              {activeDrivers.length === 0 && <option disabled>No active drivers yet — add one under Fleet</option>}
              {activeDrivers.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
        )}
        {emailTaken && <div className="alert alert-error">That email already has an account — ask them to sign in instead.</div>}
      </form>
    </Modal>
  );
}
