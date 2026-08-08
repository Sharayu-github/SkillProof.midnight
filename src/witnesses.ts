/**
 * SkillProof — shared TypeScript helpers and the private (witness) data model.
 *
 * Privacy contract (mirrors contracts/verification.compact):
 *   - The student's Profile and Certificate live ONLY here, in the DApp's
 *     private state. They are fed to the zero-knowledge witnesses and are
 *     never written to the ledger, never logged, and never returned.
 *   - Strings are encoded as fixed-width Bytes<N> so the Compact compiler can
 *     hash them inside a commitment. They stay private.
 */

import { type WitnessContext } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type Ledger } from '../contracts/managed/verification/contract/index.js';

/** Fixed-width byte sizes used by the contract (must match verification.compact). */
export const FIELD_SIZES = {
  name: 64,
  email: 96,
  college: 96,
  skills: 128,
  certId: 32,
  skill: 64,
  issuer: 64,
} as const;

export type Profile = {
  readonly name: Uint8Array;
  readonly email: Uint8Array;
  readonly college: Uint8Array;
  readonly examScore: bigint;
  readonly cgpa: bigint;
  readonly skills: Uint8Array;
  readonly nonce: Uint8Array;
};

export type Certificate = {
  readonly id: Uint8Array;
  readonly skill: Uint8Array;
  readonly issuer: Uint8Array;
  readonly issuedAt: bigint;
  readonly nonce: Uint8Array;
};

/** Everything the prover holds that must stay hidden. */
export type VerificationPrivateState = {
  readonly secretKey: Uint8Array;
  readonly profile: Profile;
  readonly profileOpening: Uint8Array;
  readonly certificates: readonly Certificate[];
};

export const createVerificationPrivateState = (
  secretKey: Uint8Array,
  profile: Profile,
  profileOpening: Uint8Array,
  certificates: readonly Certificate[] = [],
): VerificationPrivateState => ({ secretKey, profile, profileOpening, certificates });

// ─── byte / string helpers (browser + node safe, no Buffer) ──────────────────

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const utf8ToBytes = (s: string): Uint8Array => encoder.encode(s);

export const bytesToUtf8 = (b: Uint8Array): string => decoder.decode(b);

export const bytesToHex = (b: Uint8Array): string =>
  Array.from(b, (byte) => byte.toString(16).padStart(2, '0')).join('');

export const bytesFromHex = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** UTF-8 encode and right-pad (or truncate) a string to exactly `length` bytes. */
export const strToBytes = (s: string, length: number): Uint8Array => {
  const raw = utf8ToBytes(s);
  const out = new Uint8Array(length);
  out.set(raw.slice(0, length));
  return out;
};

/** Decode fixed-width bytes back to a string, trimming trailing NULs. */
export const bytesToStr = (b: Uint8Array): string => {
  let end = b.length;
  while (end > 0 && b[end - 1] === 0) end--;
  return decoder.decode(b.slice(0, end));
};

export const randomBytes = (n: number): Uint8Array => {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
};

// ─── ergonomic constructors ───────────────────────────────────────────────────

export type ProfileInput = {
  readonly name: string;
  readonly email: string;
  readonly college: string;
  readonly examScore: number;
  readonly cgpa: number; // e.g. 8.92 — stored scaled by 100 (892) inside the profile
  readonly skills: string;
};

export const makeProfile = (input: ProfileInput): Profile => ({
  name: strToBytes(input.name, FIELD_SIZES.name),
  email: strToBytes(input.email, FIELD_SIZES.email),
  college: strToBytes(input.college, FIELD_SIZES.college),
  examScore: BigInt(input.examScore),
  cgpa: BigInt(Math.round(input.cgpa * 100)),
  skills: strToBytes(input.skills, FIELD_SIZES.skills),
  nonce: randomBytes(32),
});

export type CertificateInput = {
  readonly id: string; // a public, non-sensitive certificate identifier
  readonly skill: string;
  readonly issuer: string;
  readonly issuedAt: number; // unix epoch seconds
};

export const makeCertificate = (input: CertificateInput): Certificate => ({
  id: strToBytes(input.id, FIELD_SIZES.certId),
  skill: strToBytes(input.skill, FIELD_SIZES.skill),
  issuer: strToBytes(input.issuer, FIELD_SIZES.issuer),
  issuedAt: BigInt(input.issuedAt),
  nonce: randomBytes(32),
});

// ─── the witnesses ────────────────────────────────────────────────────────────
// Each witness returns [newPrivateState, value]. None of these values are ever
// disclosed; they only feed the zero-knowledge proof.

export const witnesses = {
  localSecretKey: ({
    privateState,
  }: WitnessContext<Ledger, VerificationPrivateState>): [
    VerificationPrivateState,
    Uint8Array,
  ] => [privateState, privateState.secretKey],

  profile: ({ privateState }: WitnessContext<Ledger, VerificationPrivateState>): [
    VerificationPrivateState,
    Profile,
  ] => [privateState, privateState.profile],

  profileOpening: ({
    privateState,
  }: WitnessContext<Ledger, VerificationPrivateState>): [
    VerificationPrivateState,
    Uint8Array,
  ] => [privateState, privateState.profileOpening],

  certificate: (
    { privateState }: WitnessContext<Ledger, VerificationPrivateState>,
    certId: Uint8Array,
  ): [VerificationPrivateState, Certificate] => {
    const cert = privateState.certificates.find((c) => bytesEqual(c.id, certId));
    if (!cert) {
      throw new Error(`Certificate not found in private state: ${bytesToHex(certId)}`);
    }
    return [privateState, cert];
  },
};
