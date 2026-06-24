import { useState } from 'react';
import { approveMissionOperation, cancelMissionOperation, createMissionOperation } from '../state/missionOperationsClient';
import './MissionOperationsControls.css';

function values(value) { return String(value || '').split(/[\n,]+/).map((item) => item.trim()).filter(Boolean); }

export function MissionIntakeForm({ onChanged }) {
  const [form, setForm] = useState({ missionId: '', operatorIntent: '', intendedOutcome: '', allowedFiles: 'shared/agents/**, stephanos-ui/src/**, stephanos-server/**, tests/**', requiredTests: '', requiredEvidence: 'focused test output, build verification', browserProofRequired: false });
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const change = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setStatus('');
    try {
      const result = await createMissionOperation({ missionId: form.missionId, operatorIntent: form.operatorIntent, intendedOutcome: form.intendedOutcome, allowedFiles: values(form.allowedFiles), requiredTests: values(form.requiredTests), requiredEvidence: values(form.requiredEvidence), browserProofRequired: form.browserProofRequired });
      setStatus(`Mission ${result.missionId} created in ${result.currentPhase}.`); onChanged?.();
    } catch (error) { setStatus(error.message); } finally { setBusy(false); }
  };
  return <form className="mission-operations-control" onSubmit={submit} data-testid="mission-operations-intake"><h3>New mission</h3><div className="mission-operations-control-grid"><label>Mission ID<input value={form.missionId} onChange={change('missionId')} required pattern="[a-z0-9][a-z0-9._-]{2,127}" /></label><label>Intended outcome<input value={form.intendedOutcome} onChange={change('intendedOutcome')} required /></label><label className="mission-operations-control-wide">Operator intent<textarea value={form.operatorIntent} onChange={change('operatorIntent')} required rows="3" /></label><label className="mission-operations-control-wide">Allowed source scopes<textarea value={form.allowedFiles} onChange={change('allowedFiles')} required rows="2" /></label><label>Required tests<textarea value={form.requiredTests} onChange={change('requiredTests')} required rows="2" /></label><label>Required evidence<textarea value={form.requiredEvidence} onChange={change('requiredEvidence')} required rows="2" /></label><label className="mission-operations-checkbox"><input type="checkbox" checked={form.browserProofRequired} onChange={change('browserProofRequired')} />Browser proof required</label></div><div className="mission-operations-control-actions"><button type="submit" disabled={busy}>{busy ? 'Creating...' : 'Create bounded mission'}</button></div>{status ? <div className="mission-operations-control-status" role="status">{status}</div> : null}</form>;
}

export function MissionActionControls({ mission, onChanged }) {
  const [token, setToken] = useState(''); const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false);
  const pendingApproval = mission.approvals.some((approval) => approval.status === 'pending');
  const terminal = ['COMPLETE', 'CANCELLED'].includes(mission.mission.state);
  const approve = async (event) => { event.preventDefault(); setBusy(true); setStatus(''); try { const result = await approveMissionOperation(mission.mission.missionId, token); setToken(''); setStatus(`Approval accepted. Mission phase: ${result.currentPhase}.`); onChanged?.(); } catch (error) { setStatus(error.message); } finally { setBusy(false); } };
  const cancel = async () => { setBusy(true); setStatus(''); try { const result = await cancelMissionOperation(mission.mission.missionId, 'Cancelled from Mission Operations dashboard.'); setStatus(`Mission phase: ${result.currentPhase}.`); onChanged?.(); } catch (error) { setStatus(error.message); } finally { setBusy(false); } };
  if (!pendingApproval && terminal) return null;
  return <section className="mission-operations-control mission-operations-control--mission" data-testid="mission-operations-actions">{pendingApproval ? <form onSubmit={approve} className="mission-operations-approval-form"><label>Private head-bound approval token<input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} required /></label><button type="submit" disabled={busy || !token}>{busy ? 'Submitting...' : 'Approve exact PR head'}</button></form> : null}{!terminal ? <button type="button" className="mission-operations-cancel" onClick={cancel} disabled={busy}>Cancel mission</button> : null}{status ? <div className="mission-operations-control-status" role="status">{status}</div> : null}</section>;
}
