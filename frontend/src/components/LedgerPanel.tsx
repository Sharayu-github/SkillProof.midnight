import { useSkillProof } from '../SkillProofContext';

export const LedgerPanel: React.FC = () => {
  const { ledger, onChainIssuer } = useSkillProof();

  return (
    <section className="panel">
      <h2>On-chain status</h2>
      {!ledger ? (
        <p className="hint">Waiting for ledger state…</p>
      ) : (
        <>
          <dl>
            <dt>Registered</dt>
            <dd>{String(ledger.registered)}</dd>
            <dt>Verified certificates</dt>
            <dd>{ledger.verifiedCerts.length}</dd>
            <dt>Proofs generated (audit counter)</dt>
            <dd>{ledger.verificationCount}</dd>
            <dt>Authorized issuer (on-chain)</dt>
            <dd className="mono">{onChainIssuer}</dd>
          </dl>
          {!ledger.registered ? (
            <p className="hint">
              Not registered yet — fill in your profile and press “Register on-chain”.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
};
