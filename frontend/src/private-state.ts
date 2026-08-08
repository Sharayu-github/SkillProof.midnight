/**
 * SkillProof — browser private-state storage.
 *
 * Holds the student's PRIVATE state (secret key, profile, opening, certificates)
 * in localStorage. This is the heart of the privacy model: this data is fed to
 * the zero-knowledge witnesses and never leaves the browser. Only derived
 * commitments, hashes, and the minimal disclosed `Answer` are sent to the chain.
 *
 * The provider is a localStorage-backed implementation of the SDK's
 * `PrivateStateProvider` interface, scoped per contract address like the
 * canonical in-memory provider shipped with example-bboard.
 */

import type { ContractAddress, SigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import {
  type ExportPrivateStatesOptions,
  type ExportSigningKeysOptions,
  type ImportPrivateStatesOptions,
  type ImportPrivateStatesResult,
  type ImportSigningKeysOptions,
  type ImportSigningKeysResult,
  type PrivateStateExport,
  type PrivateStateId,
  type PrivateStateProvider,
  type SigningKeyExport,
} from '@midnight-ntwrk/midnight-js-types';

import {
  FIELD_SIZES,
  strToBytes,
  type Certificate,
  type Profile,
  type ProfileInput,
  type VerificationPrivateState,
} from '../../src/witnesses.js';

// ─── serialization ────────────────────────────────────────────────────────────
// Uint8Arrays are not JSON-safe; convert to/from hex. The profile's cgpa is
// stored scaled by 100 (e.g. 892 for 8.92) to keep it an integer.

export type SerializedCertificate = ProfileInput extends never
  ? never
  : {
      readonly id: string;
      readonly skill: string;
      readonly issuer: string;
      readonly issuedAt: number;
      readonly nonce: string;
    };

export type SerializedProfile = {
  readonly name: string;
  readonly email: string;
  readonly college: string;
  readonly examScore: number;
  readonly cgpa: number;
  readonly skills: string;
  readonly nonce: string;
};

export type SerializedPrivateState = {
  readonly secretKey: string;
  readonly profileOpening: string;
  readonly profile: SerializedProfile;
  readonly certificates: readonly SerializedCertificate[];
};

export const bytesToHex = (b: Uint8Array): string =>
  Array.from(b, (byte) => byte.toString(16).padStart(2, '0')).join('');

export const bytesFromHex = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

export const randomBytes = (n: number): Uint8Array => {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
};

export const serializePrivateState = (ps: VerificationPrivateState): SerializedPrivateState => ({
  secretKey: bytesToHex(ps.secretKey),
  profileOpening: bytesToHex(ps.profileOpening),
  profile: {
    name: bytesToStr(ps.profile.name),
    email: bytesToStr(ps.profile.email),
    college: bytesToStr(ps.profile.college),
    examScore: Number(ps.profile.examScore),
    cgpa: Number(ps.profile.cgpa) / 100,
    skills: bytesToStr(ps.profile.skills),
    nonce: bytesToHex(ps.profile.nonce),
  },
  certificates: ps.certificates.map((c) => ({
    id: bytesToStr(c.id),
    skill: bytesToStr(c.skill),
    issuer: bytesToStr(c.issuer),
    issuedAt: Number(c.issuedAt),
    nonce: bytesToHex(c.nonce),
  })),
});

export const deserializePrivateState = (s: SerializedPrivateState): VerificationPrivateState => {
  const p = s.profile;
  const profile: Profile = {
    name: strToBytes(p.name, FIELD_SIZES.name),
    email: strToBytes(p.email, FIELD_SIZES.email),
    college: strToBytes(p.college, FIELD_SIZES.college),
    examScore: BigInt(p.examScore),
    cgpa: BigInt(Math.round(p.cgpa * 100)),
    skills: strToBytes(p.skills, FIELD_SIZES.skills),
    nonce: bytesFromHex(p.nonce),
  };
  const certificates: Certificate[] = s.certificates.map((c) => ({
    id: strToBytes(c.id, FIELD_SIZES.certId),
    skill: strToBytes(c.skill, FIELD_SIZES.skill),
    issuer: strToBytes(c.issuer, FIELD_SIZES.issuer),
    issuedAt: BigInt(c.issuedAt),
    nonce: bytesFromHex(c.nonce),
  }));
  return {
    secretKey: bytesFromHex(s.secretKey),
    profile,
    profileOpening: bytesFromHex(s.profileOpening),
    certificates,
  };
};

const bytesToStr = (b: Uint8Array): string => {
  let end = b.length;
  while (end > 0 && b[end - 1] === 0) end--;
  return new TextDecoder().decode(b.slice(0, end));
};

/** Create a fresh, random student identity (brand-new pseudonym). */
export const createFreshPrivateState = (): VerificationPrivateState => ({
  secretKey: randomBytes(32),
  profileOpening: randomBytes(32),
  profile: {
    name: new Uint8Array(FIELD_SIZES.name),
    email: new Uint8Array(FIELD_SIZES.email),
    college: new Uint8Array(FIELD_SIZES.college),
    examScore: 0n,
    cgpa: 0n,
    skills: new Uint8Array(FIELD_SIZES.skills),
    nonce: randomBytes(32),
  },
  certificates: [],
});

export const emptyProfile = (): Profile => ({
  name: new Uint8Array(FIELD_SIZES.name),
  email: new Uint8Array(FIELD_SIZES.email),
  college: new Uint8Array(FIELD_SIZES.college),
  examScore: 0n,
  cgpa: 0n,
  skills: new Uint8Array(FIELD_SIZES.skills),
  nonce: randomBytes(32),
});

// ─── the provider ──────────────────────────────────────────────────────────────

const STORAGE_PREFIX = 'skillproof:private:';

const encode = <T>(value: T): string => JSON.stringify(value);
const decode = <T>(value: string): T => JSON.parse(value) as T;

/**
 * A private state provider that persists its contents to localStorage, scoped
 * by contract address and private state ID.
 */
export const localStoragePrivateStateProvider = <
  PSI extends PrivateStateId = PrivateStateId,
  PS = unknown,
>(): PrivateStateProvider<PSI, PS> => {
  const privateStates = new Map<ContractAddress, Map<PSI, PS>>();
  const signingKeys = new Map<ContractAddress, SigningKey>();
  let contractAddress: ContractAddress | null = null;

  const requireContractAddress = (): ContractAddress => {
    if (contractAddress === null) {
      throw new Error('Contract address not set. Call setContractAddress() before accessing private state.');
    }
    return contractAddress;
  };

  const storageKey = (address: ContractAddress): string => `${STORAGE_PREFIX}${address}`;

  const loadFromStorage = (address: ContractAddress): Map<PSI, PS> => {
    const raw = localStorage.getItem(storageKey(address));
    if (!raw) return new Map<PSI, PS>();
    try {
      const entries = decode<Array<[string, unknown]>>(raw);
      return new Map<PSI, PS>(entries as Array<[PSI, PS]>);
    } catch {
      return new Map<PSI, PS>();
    }
  };

  const saveToStorage = (address: ContractAddress): void => {
    const states = privateStates.get(address);
    if (!states || states.size === 0) {
      localStorage.removeItem(storageKey(address));
      return;
    }
    localStorage.setItem(storageKey(address), encode(Array.from(states.entries())));
  };

  const getScopedStates = (address: ContractAddress): Map<PSI, PS> => {
    let scopedStates = privateStates.get(address);
    if (!scopedStates) {
      scopedStates = loadFromStorage(address);
      privateStates.set(address, scopedStates);
    }
    return scopedStates;
  };

  const exportPrivateStatePayload = (address: ContractAddress): Record<string, string> =>
    Object.fromEntries(
      Array.from(getScopedStates(address).entries()).map(([stateId, value]) => [stateId, encode(value)]),
    );

  const exportSigningKeyPayload = (): Record<ContractAddress, SigningKey> => Object.fromEntries(signingKeys.entries());

  return {
    setContractAddress(address: ContractAddress): void {
      contractAddress = address;
    },
    set(key: PSI, state: PS): Promise<void> {
      const address = requireContractAddress();
      getScopedStates(address).set(key, state);
      saveToStorage(address);
      return Promise.resolve();
    },
    get(key: PSI): Promise<PS | null> {
      const address = requireContractAddress();
      const value = getScopedStates(address).get(key) ?? null;
      return Promise.resolve(value);
    },
    remove(key: PSI): Promise<void> {
      const address = requireContractAddress();
      getScopedStates(address).delete(key);
      saveToStorage(address);
      return Promise.resolve();
    },
    clear(): Promise<void> {
      const address = requireContractAddress();
      privateStates.delete(address);
      localStorage.removeItem(storageKey(address));
      return Promise.resolve();
    },
    setSigningKey(contractAddress: ContractAddress, signingKey: SigningKey): Promise<void> {
      signingKeys.set(contractAddress, signingKey);
      return Promise.resolve();
    },
    getSigningKey(contractAddress: ContractAddress): Promise<SigningKey | null> {
      const value = signingKeys.get(contractAddress) ?? null;
      return Promise.resolve(value);
    },
    removeSigningKey(contractAddress: ContractAddress): Promise<void> {
      signingKeys.delete(contractAddress);
      return Promise.resolve();
    },
    clearSigningKeys(): Promise<void> {
      signingKeys.clear();
      return Promise.resolve();
    },
    exportPrivateStates(options?: ExportPrivateStatesOptions): Promise<PrivateStateExport> {
      void options;
      const address = requireContractAddress();
      return Promise.resolve({
        format: 'midnight-private-state-export',
        encryptedPayload: encode({ contractAddress: address, states: exportPrivateStatePayload(address) }),
        salt: 'localStorage-private-state-provider',
      });
    },
    importPrivateStates(
      exportData: PrivateStateExport,
      options?: ImportPrivateStatesOptions,
    ): Promise<ImportPrivateStatesResult> {
      const address = requireContractAddress();
      const conflictStrategy = options?.conflictStrategy ?? 'error';
      const payload = decode<{ contractAddress?: ContractAddress; states?: Record<string, string> }>(
        exportData.encryptedPayload,
      );
      const states = payload.states ?? {};
      const scopedStates = getScopedStates(address);
      let imported = 0;
      let skipped = 0;
      let overwritten = 0;

      for (const [rawStateId, serializedState] of Object.entries(states)) {
        const stateId = rawStateId as PSI;
        const hasExisting = scopedStates.has(stateId);
        if (hasExisting) {
          if (conflictStrategy === 'skip') {
            skipped += 1;
            continue;
          }
          if (conflictStrategy === 'error') {
            return Promise.reject(new Error(`Private state conflict for '${stateId}'`));
          }
          overwritten += 1;
        } else {
          imported += 1;
        }
        scopedStates.set(stateId, decode<PS>(serializedState));
      }
      saveToStorage(address);
      return Promise.resolve({ imported, skipped, overwritten });
    },
    exportSigningKeys(options?: ExportSigningKeysOptions): Promise<SigningKeyExport> {
      void options;
      return Promise.resolve({
        format: 'midnight-signing-key-export',
        encryptedPayload: encode({ keys: exportSigningKeyPayload() }),
        salt: 'localStorage-signing-key-provider',
      });
    },
    importSigningKeys(
      exportData: SigningKeyExport,
      options?: ImportSigningKeysOptions,
    ): Promise<ImportSigningKeysResult> {
      const conflictStrategy = options?.conflictStrategy ?? 'error';
      const payload = decode<{ keys?: Record<ContractAddress, SigningKey> }>(exportData.encryptedPayload);
      const keys = payload.keys ?? {};
      let imported = 0;
      let skipped = 0;
      let overwritten = 0;

      for (const [address, signingKey] of Object.entries(keys)) {
        const hasExisting = signingKeys.has(address);
        if (hasExisting) {
          if (conflictStrategy === 'skip') {
            skipped += 1;
            continue;
          }
          if (conflictStrategy === 'error') {
            return Promise.reject(new Error(`Signing key conflict for '${address}'`));
          }
          overwritten += 1;
        } else {
          imported += 1;
        }
        signingKeys.set(address, signingKey);
      }

      return Promise.resolve({ imported, skipped, overwritten });
    },
  };
};
