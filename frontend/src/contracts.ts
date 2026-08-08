/**
 * SkillProof — compiled contract driver for the browser.
 *
 * Wraps the generated Compact contract with the private witnesses so it can be
 * deployed or joined from the frontend. Mirrors the repo-root driver
 * (src/contract.ts) without the Node-only imports, so it stays browser-safe.
 */

import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import * as VerificationContract from '@verification-contract';
import { witnesses, type VerificationPrivateState } from '../../src/witnesses.js';

export * as VerificationContract from '@verification-contract';
export { witnesses } from '../../src/witnesses.js';
export type { VerificationPrivateState } from '../../src/witnesses.js';

/**
 * The compiled SkillProof contract, ready for deployContract / findDeployedContract.
 * ZK assets are served from `/keys` and `/zkir` (copied into `public/`).
 */
export const CompiledVerificationContract = CompiledContract.make<
  VerificationContract.Contract<VerificationPrivateState>
>('Verification', VerificationContract.Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets('./'),
);

/** Pseudonymous on-chain id of a student (computed with the same circuit the contract uses). */
export const studentIdOf = (secretKey: Uint8Array): Uint8Array =>
  VerificationContract.pureCircuits.studentKey(secretKey);

/** The issuer's derived public key (used as the contract constructor argument). */
export const issuerKeyOf = (issuerSecretKey: Uint8Array): Uint8Array =>
  VerificationContract.pureCircuits.issuerKey(issuerSecretKey);
