import { useState } from 'react';
import { useSkillProof } from '../SkillProofContext';

export const ProfilePanel: React.FC = () => {
  const { myState, setProfile, register, busy } = useSkillProof();
  const [name, setName] = useState(myState?.profile.name ?? '');
  const [email, setEmail] = useState(myState?.profile.email ?? '');
  const [college, setCollege] = useState(myState?.profile.college ?? '');
  const [examScore, setExamScore] = useState(myState?.profile.examScore ?? 0);
  const [cgpa, setCgpa] = useState(myState?.profile.cgpa ?? 0);
  const [skills, setSkills] = useState(myState?.profile.skills ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const profileSet = Boolean(myState && myState.profile.name);

  const onSave = async () => {
    setErr(null);
    try {
      await setProfile({ name, email, college, examScore: Number(examScore), cgpa: Number(cgpa), skills });
      setMsg('Profile saved locally. Nothing has been sent on-chain yet.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const onRegister = async () => {
    setErr(null);
    setMsg(null);
    try {
      const r = await register();
      setMsg(`Registered on-chain. Tx ${r.txId} at block ${r.blockHeight}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="panel">
      <h2>My profile (private)</h2>
      <p className="hint">
        Stored only in this browser and fed to the zero-knowledge witnesses. Only a
        commitment is written to the chain when you register.
      </p>
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
      </label>
      <label className="field">
        <span>Email</span>
        <input value={email} onChange={(e) => setEmail(e.target.value)} maxLength={96} />
      </label>
      <label className="field">
        <span>College / University</span>
        <input value={college} onChange={(e) => setCollege(e.target.value)} maxLength={96} />
      </label>
      <div className="row">
        <label className="field">
          <span>Exam score</span>
          <input type="number" value={examScore} onChange={(e) => setExamScore(Number(e.target.value))} />
        </label>
        <label className="field">
          <span>CGPA (0–10)</span>
          <input type="number" step="0.01" value={cgpa} onChange={(e) => setCgpa(Number(e.target.value))} />
        </label>
      </div>
      <label className="field">
        <span>Skills (comma separated)</span>
        <input value={skills} onChange={(e) => setSkills(e.target.value)} maxLength={128} />
      </label>
      <div className="row">
        <button onClick={() => void onSave()}>Save profile</button>
        <button
          onClick={() => void onRegister()}
          disabled={!profileSet || busy === 'registering'}
        >
          {busy === 'registering' ? 'Registering…' : 'Register on-chain'}
        </button>
      </div>
      {msg ? <p className="ok">{msg}</p> : null}
      {err ? <p className="error">{err}</p> : null}
    </section>
  );
};
