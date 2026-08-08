import './globals';
import '@midnight-ntwrk/dapp-connector-api';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { setNetworkId, type NetworkId } from '@midnight-ntwrk/midnight-js-network-id';

import { SkillProofProvider } from './SkillProofContext';
import App from './App';
import './styles.css';

const networkId = (import.meta.env.VITE_NETWORK_ID as NetworkId) ?? 'preview';
setNetworkId(networkId);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <SkillProofProvider>
      <App />
    </SkillProofProvider>
  </React.StrictMode>,
);
