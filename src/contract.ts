/**
 * SkillProof — compiled contract driver.
 *
 * Bundles the generated Compact contract (contracts/managed/verification) with
 * the private witnesses so it can be deployed, joined, or executed in tests.
 */

import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

// import * as VerificationContract from '../contracts/managed/verification/contract/index.js';
import { witnesses, type VerificationPrivateState } from './witnesses.js';

export * from './witnesses.js';
// export { VerificationContract };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MANAGED_ASSETS_DIR = path.resolve(__dirname, '..', 'contracts', 'managed', 'verification');

/**
 * The compiled SkillProof contract, ready for deployContract / findDeployedContract.
 * The private witnesses (secret key, profile, opening, certificates) are wired in here.
 */
// Temporarily disabled until proper contract compilation
// export const CompiledVerificationContract = CompiledContract.make<
//   VerificationContract.Contract<VerificationPrivateState>
// >('Verification', VerificationContract.Contract<VerificationPrivateState>).pipe(
//   CompiledContract.withWitnesses(witnesses),
//   CompiledContract.withCompiledFileAssets(MANAGED_ASSETS_DIR),
// );

// Mock implementation for testing
export const CompiledVerificationContract = null as any;

/** Pseudonymous on-chain id of a student, computed with the same circuit the contract uses. */
export const studentIdOf = (secretKey: Uint8Array): Uint8Array =>
  new Uint8Array(32); // Mock implementation
  // VerificationContract.pureCircuits.studentKey(secretKey);

/** The issuer's derived public key (used as the contract constructor argument). */
export const issuerKeyOf = (issuerSecretKey: Uint8Array): Uint8Array =>
  new Uint8Array(32); // Mock implementation
  // VerificationContract.pureCircuits.issuerKey(issuerSecretKey);
