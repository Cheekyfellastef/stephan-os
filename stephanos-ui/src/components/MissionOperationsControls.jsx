import { useState } from 'react';
import { approveMissionOperation, cancelMissionOperation } from '../state/missionOperationsClient';
import './MissionOperationsControls.css';

export function MissionActionControls({ mission, onChanged }) {
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const approvals = Array.isArray(mission?.approvals) ? mission.approvals : [];
  const pendingApproval = approvals.some((approval) => approval.status === 'pending');
  const terminal = ['COMPLETE', 'CANCELLED'].includes(mission?.mission?.state);
  const missionId = String(mission?.mission?.missionId || '');

  const approve = async (event) => {
    event.preventDefault();
    setBusy(true);
    setStatus('');
    try {
      const result = await approveMissionOperation(missionId, token);
      setToken('');
      setStatus(`Approval accepted. Mission phase: ${result.currentPhase}.`);
      onChanged?.();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    setStatus('');
    try {
      const result = await cancelMissionOperation(
        missionId,
        'Cancelled from Mission Operations dashboard.',
      );
      setStatus(`Mission phase: ${result.currentPhase}.`);
      onChanged?.();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };

  if (!pendingApproval && terminal) return null;
  return (
    <section
      className="mission-operations-control mission-operations-control--mission"
      data-testid="mission-operations-actions"
    >
      {pendingApproval ? (
        <form onSubmit={approve} className="mission-operations-approval-form">
          <label>
            Private head-bound approval token
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy || !token}>
            {busy ? 'Submitting...' : 'Approve exact PR head'}
          </button>
        </form>
      ) : null}
      {!terminal ? (
        <button
          type="button"
          className="mission-operations-cancel"
          onClick={cancel}
          disabled={busy}
        >
          Cancel mission
        </button>
      ) : null}
      {status ? <div className="mission-operations-control-status" role="status">{status}</div> : null}
    </section>
  );
}
