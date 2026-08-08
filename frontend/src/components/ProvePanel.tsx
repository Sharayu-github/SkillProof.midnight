import { useState } from 'react';
import { useSkillProof } from '../SkillProofContext';

export const ProvePanel: React.FC = () => {
  const { myState, proveSkill, busy, ledger } = useSkillProof();
  const [querySkill, setQuerySkill] = useState('');
  const [certId, setCertId] = useState('');
  const [answer, setAnswer] = useState<{ txId: string; answer: import('../SkillProofContext').Answer } | null>(
    null,
  );
  const [err, setErr] = useState<string | null>(null);

  const certs = myState?.certificates ?? [];
  const verifiedCerts = ledger?.verifiedCerts ?? [];

  const onProve = async () => {
    setErr(null);
    setAnswer(null);
    if (!querySkill || !certId) {
      setErr('query skill and certificate id are required');
      return;
    }
    try {
      const r = await proveSkill(querySkill, certId);
      setAnswer({ txId: r.txId, answer: r.answer });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="panel">
      <h2>Prove a skill (zero-knowledge)</h2>
      <p className="hint">
        Answer an employer's question — “does this student have a verified certificate in
        X?” — with a proof that reveals only the answer, not your identity or grades.
      </p>
      <label className="field">
        <span>Query skill</span>
        <input value={querySkill} onChange={(e) => setQuerySkill(e.target.value)} maxLength={64} />
      </label>
      <label className="field">
        <span>Certificate id</span>
        <input value={certId} onChange={(e) => setCertId(e.target.value)} maxLength={32} />
      </label>
      {certs.length > 0 ? (
        <p className="hint">You hold: {certs.map((c) => `"${c.id}" (${c.skill})`).join(', ')}</p>
      ) : null}
      <button onClick={() => void onProve()} disabled={busy === 'proving'}>
        {busy === 'proving' ? 'Proving…' : 'Prove skill'}
      </button>
      {err ? <p className="error">{err}</p> : null}

      {answer ? (
        <div className="answer">
          <h3>Disclosed answer (public)</h3>
          <dl>
            <dt>studentId</dt>
            <dd className="mono">{answer.answer.studentId}</dd>
            <dt>skill</dt>
            <dd>{answer.answer.skill}</dd>
            <dt>result</dt>
            <dd>{String(answer.answer.result)}</dd>
            <dt>answeredAt</dt>
            <dd>{new Date(answer.answer.answeredAt * 1000).toISOString()}</dd>
          </dl>
          <p className="hint">Tx {answer.txId}</p>
        </div>
      ) : null}

      {verifiedCerts.length > 0 ? (
        <div>
          <h3>Verified on-chain</h3>
          <ul className="cert-list">
            {verifiedCerts.map((v) => (
              <li key={v.certId}>
                <span className="mono">{v.certId.slice(0, 16)}…</span> — {v.skill} ·{' '}
                {new Date(v.verifiedAt * 1000).toLocaleDateString()}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
};
