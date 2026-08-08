import { useState } from 'react';
import { useSkillProof } from '../SkillProofContext';

export const CertificatePanel: React.FC = () => {
  const { myState, addCertificate, busy } = useSkillProof();
  const [id, setId] = useState('');
  const [skill, setSkill] = useState('');
  const [issuer, setIssuer] = useState('');
  const [issuedAt, setIssuedAt] = useState(Math.floor(Date.now() / 1000));
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const certs = myState?.certificates ?? [];

  const onAdd = async () => {
    setErr(null);
    setMsg(null);
    if (!id || !skill || !issuer) {
      setErr('certificate id, skill and issuer are required');
      return;
    }
    try {
      const r = await addCertificate({ id, skill, issuer, issuedAt: Math.floor(issuedAt) });
      setMsg(`Certificate "${id}" committed on-chain. Tx ${r.txId}`);
      setId('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="panel">
      <h2>Certificates (private)</h2>
      <p className="hint">
        The full certificate (skill, issuer, date) stays in this browser. Only its id and a
        commitment hash reach the chain.
      </p>
      <label className="field">
        <span>Certificate id</span>
        <input value={id} onChange={(e) => setId(e.target.value)} maxLength={32} />
      </label>
      <label className="field">
        <span>Skill</span>
        <input value={skill} onChange={(e) => setSkill(e.target.value)} maxLength={64} />
      </label>
      <label className="field">
        <span>Issuer</span>
        <input value={issuer} onChange={(e) => setIssuer(e.target.value)} maxLength={64} />
      </label>
      <label className="field">
        <span>Issued at (unix seconds)</span>
        <input type="number" value={issuedAt} onChange={(e) => setIssuedAt(Number(e.target.value))} />
      </label>
      <button onClick={() => void onAdd()} disabled={busy === 'adding certificate'}>
        {busy === 'adding certificate' ? 'Committing…' : 'Add & commit certificate'}
      </button>
      {msg ? <p className="ok">{msg}</p> : null}
      {err ? <p className="error">{err}</p> : null}

      {certs.length > 0 ? (
        <ul className="cert-list">
          {certs.map((c) => (
            <li key={c.id}>
              <strong>{c.id}</strong> — {c.skill} · {c.issuer} · {new Date(c.issuedAt * 1000).toLocaleDateString()}
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">No certificates held yet.</p>
      )}
    </section>
  );
};
