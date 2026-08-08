import { useState } from 'react';
import { useSkillProof } from '../SkillProofContext';

export const VerifyPanel: React.FC = () => {
  const { issuerSecretKeyHex, onChainIssuer, setIssuerSecretKey, verify, busy, studentId } =
    useSkillProof();
  const [secretHex, setSecretHex] = useState('');
  const [targetStudentId, setTargetStudentId] = useState(studentId ?? '');
  const [certId, setCertId] = useState('');
  const [skill, setSkill] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const isIssuer = issuerSecretKeyHex !== null;

  const onSetKey = async () => {
    setErr(null);
    try {
      await setIssuerSecretKey(secretHex.trim());
      setMsg('Issuer identity set. You may now verify certificates.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const onVerify = async () => {
    setErr(null);
    setMsg(null);
    try {
      const r = await verify(targetStudentId.trim(), certId.trim(), skill.trim());
      setMsg(`Marked "${certId}" (${skill}) as verified. Tx ${r.txId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="panel">
      <h2>Issuer — verify a certificate</h2>
      {!isIssuer ? (
        <>
          <p className="hint">
            Only the contract's authorized issuer can mark a claimed certificate as verified.
            Paste the issuer secret key (64 hex chars — the seed used at deploy time) to unlock
            this panel.
          </p>
          <label className="field">
            <span>Issuer secret key</span>
            <input
              className="mono"
              value={secretHex}
              onChange={(e) => setSecretHex(e.target.value)}
              maxLength={64}
              placeholder="0123…abcd"
            />
          </label>
          <button onClick={() => void onSetKey()}>Unlock issuer panel</button>
          {msg ? <p className="ok">{msg}</p> : null}
          {err ? <p className="error">{err}</p> : null}
        </>
      ) : (
        <>
          <p className="hint">
            Issuer key set. On-chain issuer: <span className="mono">{onChainIssuer?.slice(0, 16)}…</span>
          </p>
          <label className="field">
            <span>Student id (hex)</span>
            <input
              className="mono"
              value={targetStudentId}
              onChange={(e) => setTargetStudentId(e.target.value)}
              placeholder="64 hex characters"
            />
          </label>
          <label className="field">
            <span>Certificate id</span>
            <input value={certId} onChange={(e) => setCertId(e.target.value)} maxLength={32} />
          </label>
          <label className="field">
            <span>Skill</span>
            <input value={skill} onChange={(e) => setSkill(e.target.value)} maxLength={64} />
          </label>
          <button onClick={() => void onVerify()} disabled={busy === 'verifying'}>
            {busy === 'verifying' ? 'Verifying…' : 'Mark as verified'}
          </button>
          {msg ? <p className="ok">{msg}</p> : null}
          {err ? <p className="error">{err}</p> : null}
        </>
      )}
    </section>
  );
};
