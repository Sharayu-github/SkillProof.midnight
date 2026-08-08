import { useSkillProof } from '../SkillProofContext';

export const WalletPanel: React.FC = () => {
  const { networkId, contractAddress, isDeployer, studentId, issuerSecretKeyHex } = useSkillProof();

  return (
    <section className="panel">
      <h2>Wallet &amp; Contract</h2>
      <dl>
        <dt>Network</dt>
        <dd>{networkId}</dd>
        <dt>Contract address</dt>
        <dd className="mono">{contractAddress}</dd>
        <dt>Role</dt>
        <dd>{isDeployer ? 'Deployer (contract issuer)' : 'Participant'}</dd>
        <dt>Pseudonymous student id</dt>
        <dd className="mono">{studentId}</dd>
        <dt>Issuer secret key stored</dt>
        <dd>{issuerSecretKeyHex ? 'yes (in this browser)' : 'no'}</dd>
      </dl>
      <p className="hint">
        The student id is a hash of a secret key held only in this browser — it never reveals
        who you are.
      </p>
    </section>
  );
};
