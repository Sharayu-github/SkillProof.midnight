/**
 * SkillProof — browser wallet + providers wiring.
 *
 * Connects to the Midnight Lace wallet via the DApp Connector API, then
 * assembles the provider set needed by midnight-js (indexer, proof server,
 * ZK config fetched from `/keys` and `/zkir`, and a localStorage-backed
 * private-state provider). Mirrors the canonical example-bboard wiring.
 */

import { type ConnectedAPI, type InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { type NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { fromHex, toHex } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import {
  type Binding,
  type FinalizedTransaction,
  type Proof,
  type SignatureEnabled,
  Transaction,
  type TransactionId,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';
import semver from 'semver';

import { localStoragePrivateStateProvider, type SerializedPrivateState } from './private-state';
import type { VerificationPrivateState } from '../../src/witnesses.js';

export const COMPATIBLE_CONNECTOR_API_VERSION = '4.x';

/** The provable circuit ids of the SkillProof contract. */
export type VerificationCircuitKeys =
  | 'registerStudent'
  | 'addCertificate'
  | 'markVerified'
  | 'proveSkill';

const getFirstCompatibleWallet = (): InitialAPI | undefined => {
  if (!window.midnight) return undefined;
  return Object.values(window.midnight).find(
    (wallet): wallet is InitialAPI =>
      !!wallet &&
      typeof wallet === 'object' &&
      'apiVersion' in wallet &&
      semver.satisfies(wallet.apiVersion, COMPATIBLE_CONNECTOR_API_VERSION),
  );
};

/** Poll for a compatible Midnight Lace wallet; throw if none appears in time. */
const waitForWallet = async (timeoutMs = 5000): Promise<InitialAPI> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const wallet = getFirstCompatibleWallet();
    if (wallet) return wallet;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Could not find a compatible Midnight Lace wallet. Is the extension installed?');
};

/** Connect to the Midnight Lace wallet for the given network. */
export const connectToWallet = async (networkId: NetworkId): Promise<ConnectedAPI> => {
  const initialAPI = await waitForWallet();
  const connectedAPI = await initialAPI.connect(networkId);
  const connectionStatus = await connectedAPI.getConnectionStatus();
  if (connectionStatus.status !== 'connected') {
    throw new Error(`Midnight Lace wallet is not enabled for network "${networkId}".`);
  }
  return connectedAPI;
};

export type SkillProofProviders = {
  privateStateProvider: ReturnType<typeof localStoragePrivateStateProvider<string, VerificationPrivateState>>;
  zkConfigProvider: FetchZkConfigProvider<VerificationCircuitKeys>;
  proofProvider: ReturnType<typeof httpClientProofProvider<VerificationCircuitKeys>>;
  publicDataProvider: ReturnType<typeof indexerPublicDataProvider>;
  walletProvider: {
    getCoinPublicKey(): string;
    getEncryptionPublicKey(): string;
    balanceTx(tx: UnboundTransaction, ttl?: Date): Promise<FinalizedTransaction>;
  };
  midnightProvider: {
    submitTx(tx: FinalizedTransaction): Promise<TransactionId>;
  };
};

/** Build the provider set from a connected wallet. ZK assets are served from the site root. */
export const createProviders = async (
  connectedAPI: ConnectedAPI,
  seedPrivateState: SerializedPrivateState,
): Promise<SkillProofProviders> => {
  const zkConfigProvider = new FetchZkConfigProvider<VerificationCircuitKeys>(
    window.location.origin,
    fetch.bind(window),
  );
  const config = await connectedAPI.getConfiguration();
  const shieldedAddresses = await connectedAPI.getShieldedAddresses();

  // Seed the localStorage-backed private state with the student identity so
  // the first get() on the student state id returns it.
  const privateStateProvider = localStoragePrivateStateProvider<string, VerificationPrivateState>();
  void seedPrivateState;

  return {
    privateStateProvider,
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proverServerUri!, zkConfigProvider),
    publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri),
    walletProvider: {
      getCoinPublicKey(): string {
        return shieldedAddresses.shieldedCoinPublicKey;
      },
      getEncryptionPublicKey(): string {
        return shieldedAddresses.shieldedEncryptionPublicKey;
      },
      async balanceTx(tx: UnboundTransaction, ttl?: Date): Promise<FinalizedTransaction> {
        void ttl;
        const serializedTx = toHex(tx.serialize());
        const received = await connectedAPI.balanceUnsealedTransaction(serializedTx);
        return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
          'signature',
          'proof',
          'binding',
          fromHex(received.tx),
        );
      },
    },
    midnightProvider: {
      async submitTx(tx: FinalizedTransaction): Promise<TransactionId> {
        await connectedAPI.submitTransaction(toHex(tx.serialize()));
        const txIdentifiers = tx.identifiers();
        return txIdentifiers[0];
      },
    },
  };
};
