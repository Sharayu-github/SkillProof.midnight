import { useCallback, useState } from 'react';
import { useSkillProof } from './SkillProofContext';
import { WalletPanel } from './components/WalletPanel';
import { ProfilePanel } from './components/ProfilePanel';
import { CertificatePanel } from './components/CertificatePanel';
import { VerifyPanel } from './components/VerifyPanel';
import { ProvePanel } from './components/ProvePanel';
import { LedgerPanel } from './components/LedgerPanel';

export const App: React.FC = () => {
  const { status, error, connect, reset } = useSkillProof();
  const [connecting, setConnecting] = useState(false);
  const [network, setNetwork] = useState<string>(
    (import.meta.env.VITE_NETWORK_ID as string) ?? 'preview',
  );

  const onConnect = useCallback(async () => {
    setConnecting(true);
    try {
      await connect(network);
    } catch (e) {
      console.error(e);
    } finally {
      setConnecting(false);
    }
  }, [connect, network]);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>SkillProof</h1>
          <p className="tagline">Privacy-preserving skill verification on the Midnight Network</p>
        </div>
        {status === 'connected' ? (
          <button className="ghost" onClick={() => void reset()}>
            Disconnect
          </button>
        ) : null}
      </header>

      {status !== 'connected' ? (
        <section className="panel connect-panel">
          <h2>Connect to get started</h2>
          <p>
            SkillProof verifies skills with zero-knowledge proofs. Your name, email, college,
            exam scores and certificates stay <strong>entirely on this device</strong> — only
            commitments and a minimal proof answer reach the blockchain.
          </p>
          <label className="field">
            <span>Network</span>
            <select value={network} onChange={(e) => setNetwork(e.target.value)}>
              <option value="preview">Preview</option>
              <option value="preprod">Preprod</option>
              <option value="undeployed">Undeployed (local devnet)</option>
            </select>
          </label>
          <button onClick={() => void onConnect()} disabled={connecting}>
            {connecting ? 'Connecting…' : 'Connect Midnight Lace wallet'}
          </button>
          {error ? <p className="error">{error}</p> : null}
          <p className="hint">
            Make sure the Midnight Lace wallet extension is installed and unlocked.
          </p>
        </section>
      ) : (
        <main className="grid">
          <WalletPanel />
          <ProfilePanel />
          <CertificatePanel />
          <VerifyPanel />
          <ProvePanel />
          <LedgerPanel />
        </main>
      )}
    </div>
  );
};

export default App;
