import { describe, it, expect } from 'vitest';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

import { VerificationSimulator } from './verification-simulator.js';
import {
  randomBytes,
  strToBytes,
  bytesToHex,
  bytesEqual,
  makeProfile,
  makeCertificate,
  createVerificationPrivateState,
  FIELD_SIZES,
} from '../src/witnesses.js';
import { studentIdOf, issuerKeyOf } from '../src/contract.js';
import type { Ledger } from '../contracts/managed/verification/contract/index.js';

setNetworkId('undeployed');

// ─── fixtures ─────────────────────────────────────────────────────────────────

const PROFILE_INPUT = {
  name: 'Ada Lovelace',
  email: 'ada.lovelace@sppu.edu',
  college: 'Savitribai Phule Pune University',
  examScore: 92,
  cgpa: 8.92,
  skills: 'Solidity, Midnight, ZK, TypeScript',
};

const SOLIDITY_SKILL = strToBytes('Solidity', FIELD_SIZES.skill);
const CERT_ID = strToBytes('SOLIDITY-CERT-001', FIELD_SIZES.certId);
const CERT_ID_OTHER = strToBytes('MIDNIGHT-CERT-001', FIELD_SIZES.certId);

const profile = makeProfile(PROFILE_INPUT);
const opening = randomBytes(32);
const certificate = makeCertificate({
  id: 'SOLIDITY-CERT-001',
  skill: 'Solidity',
  issuer: 'SPPU Blockchain Society',
  issuedAt: 1_756_780_000,
});
const otherCertificate = makeCertificate({
  id: 'MIDNIGHT-CERT-001',
  skill: 'Midnight',
  issuer: 'SPPU Blockchain Society',
  issuedAt: 1_756_790_000,
});

const studentSecretKey = randomBytes(32);
const studentId = studentIdOf(studentSecretKey);
const issuerSecretKey = randomBytes(32);
const issuerKey = issuerKeyOf(issuerSecretKey);

const studentPrivateState = createVerificationPrivateState(
  studentSecretKey,
  profile,
  opening,
  [certificate, otherCertificate],
);
const issuerPrivateState = createVerificationPrivateState(issuerSecretKey, profile, opening, []);

/** Recursively collect every raw byte array that exists on the public ledger. */
const collectLedgerBytes = (value: unknown, out: Uint8Array[]): void => {
  if (value instanceof Uint8Array) {
    out.push(value);
    return;
  }
  if (
    typeof value === 'bigint' ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    value === null ||
    value === undefined
  ) {
    return;
  }
  if (typeof value === 'object') {
    const iterable = (value as Record<string, unknown>)[Symbol.iterator];
    if (typeof iterable === 'function') {
      for (const [k, v] of value as Iterable<[unknown, unknown]>) {
        collectLedgerBytes(k, out);
        collectLedgerBytes(v, out);
      }
      return;
    }
    for (const v of Object.values(value as Record<string, unknown>)) collectLedgerBytes(v, out);
  }
};

const containsBytes = (haystack: Uint8Array, needle: Uint8Array): boolean => {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
};

/** Assert that none of the given private byte arrays appear anywhere on-chain. */
const expectNoLedgerLeak = (sim: VerificationSimulator, privateValues: Uint8Array[]) => {
  const allBytes: Uint8Array[] = [];
  collectLedgerBytes(sim.getLedger(), allBytes);
  const haystack = allBytes.reduce<Uint8Array>((acc, b) => {
    const joined = new Uint8Array(acc.length + b.length);
    joined.set(acc);
    joined.set(b, acc.length);
    return joined;
  }, new Uint8Array(0));
  for (const privateValue of privateValues) {
    expect(containsBytes(haystack, privateValue), `private value leaked into ledger: ${bytesToHex(privateValue).slice(0, 16)}…`).toBe(false);
  }
};

const fullFlow = (sim: VerificationSimulator) => {
  sim.registerStudent(1_000_000n);
  sim.addCertificate(CERT_ID);
  sim.switchUser(issuerPrivateState);
  sim.markVerified(studentId, CERT_ID, SOLIDITY_SKILL, 1_100_000n);
  sim.switchUser(studentPrivateState);
  const { result, ledger: afterProve } = sim.proveSkill(SOLIDITY_SKILL, CERT_ID, 1_200_000n);
  return { result, ledger: afterProve };
};

// ─── tests ────────────────────────────────────────────────────────────────────

describe('SkillProof contract — constructor & registration', () => {
  it('initializes ledger state deterministically from the constructor', () => {
    const sim0 = new VerificationSimulator(studentPrivateState, issuerKey);
    const sim1 = new VerificationSimulator(studentPrivateState, issuerKey);
    const initial = sim0.getLedger();
    // Map wrappers are constructed independently, so compare the observable facts.
    expect(bytesEqual(sim1.getLedger().issuer, initial.issuer)).toBe(true);
    expect(sim1.getLedger().students.isEmpty()).toBe(initial.students.isEmpty());
    expect(sim1.getLedger().students.size()).toBe(initial.students.size());
    expect(initial.students.isEmpty()).toBe(true);
    expect(initial.claimedCerts.isEmpty()).toBe(true);
    expect(initial.verifiedCerts.isEmpty()).toBe(true);
    expect(initial.verificationCount.isEmpty()).toBe(true);
    expect(bytesEqual(initial.issuer, issuerKey)).toBe(true);
  });

  it('registers a student storing only the commitment — never the profile', () => {
    const sim = new VerificationSimulator(studentPrivateState, issuerKey);
    const privateStateBefore = sim.getPrivateState();
    const ledgerState = sim.registerStudent(1_000_000n);

    expect(ledgerState.students.size()).toBe(1n);
    expect(ledgerState.students.member(studentId)).toBe(true);
    expect(ledgerState.students.lookup(studentId).active).toBe(true);
    expect(ledgerState.students.lookup(studentId).registeredAt).toBe(1_000_000n);
    // commitment is a real 32-byte digest, not the raw profile
    expect(ledgerState.students.lookup(studentId).profileCommitment.length).toBe(32);
    // helper maps seeded for the student
    expect(ledgerState.claimedCerts.lookup(studentId).isEmpty()).toBe(true);
    expect(ledgerState.verifiedCerts.lookup(studentId).isEmpty()).toBe(true);
    expect(ledgerState.verificationCount.lookup(studentId)).toBe(0n);
    // private state untouched
    expect(sim.getPrivateState()).toEqual(privateStateBefore);
    // no private profile field bytes are visible on-chain
    expectNoLedgerLeak(sim, [profile.name, profile.email, profile.college, profile.skills, opening]);
  });

  it('does not let the same secret key register twice', () => {
    const sim = new VerificationSimulator(studentPrivateState, issuerKey);
    sim.registerStudent(1_000_000n);
    expect(() => sim.registerStudent(1_000_000n)).toThrow('failed assert: Student is already registered');
  });
});

describe('SkillProof contract — claiming & issuer verification', () => {
  it('claims a certificate by commitment only, then the issuer marks it verified', () => {
    const sim = new VerificationSimulator(studentPrivateState, issuerKey);
    sim.registerStudent(1_000_000n);
    sim.addCertificate(CERT_ID);

    // on-chain: only the certId key + a 32-byte commitment; no cert contents
    const afterClaim = sim.getLedger();
    expect(afterClaim.claimedCerts.lookup(studentId).member(CERT_ID)).toBe(true);
    expect(afterClaim.claimedCerts.lookup(studentId).lookup(CERT_ID).length).toBe(32);
    expectNoLedgerLeak(sim, [certificate.issuer, certificate.nonce]);

    sim.switchUser(issuerPrivateState);
    const afterVerify = sim.markVerified(studentId, CERT_ID, SOLIDITY_SKILL, 1_100_000n);
    const verified = afterVerify.verifiedCerts.lookup(studentId).lookup(CERT_ID);
    expect(bytesEqual(verified.skill, SOLIDITY_SKILL)).toBe(true);
    expect(verified.verifiedAt).toBe(1_100_000n);
    // the verified entry holds ONLY skill + verifiedAt, never cert contents
    expect(Object.keys(verified)).toEqual(['skill', 'verifiedAt']);
  });

  it('rejects a non-issuer trying to verify certificates', () => {
    const sim = new VerificationSimulator(studentPrivateState, issuerKey);
    sim.registerStudent(1_000_000n);
    sim.addCertificate(CERT_ID);
    // still acting as the student (not the issuer) → must fail
    expect(() => sim.markVerified(studentId, CERT_ID, SOLIDITY_SKILL, 1_100_000n)).toThrow(
      'failed assert: Only the authorized issuer may verify certificates',
    );
  });

  it('rejects verifying a certificate the student never claimed', () => {
    const sim = new VerificationSimulator(studentPrivateState, issuerKey);
    sim.registerStudent(1_000_000n);
    sim.switchUser(issuerPrivateState);
    expect(() => sim.markVerified(studentId, CERT_ID_OTHER, SOLIDITY_SKILL, 1_100_000n)).toThrow(
      'failed assert: Student has not claimed this certificate',
    );
  });
});

describe('SkillProof contract — proveSkill', () => {
  it('answers TRUE with only the minimal disclosure and increments the audit counter', () => {
    const sim = new VerificationSimulator(studentPrivateState, issuerKey);
    const { result, ledger: afterProve } = fullFlow(sim);

    // the employer's answer: studentId + skill + result + timestamp, nothing else
    expect(bytesEqual(result.studentId, studentId)).toBe(true);
    expect(bytesEqual(result.skill, SOLIDITY_SKILL)).toBe(true);
    expect(result.result).toBe(true);
    expect(result.answeredAt).toBe(1_200_000n);
    expect(Object.keys(result)).toEqual(['studentId', 'skill', 'result', 'answeredAt']);
    // audit counter incremented
    expect(afterProve.verificationCount.lookup(studentId)).toBe(1n);
  });

  it('reveals no private profile or certificate data anywhere on-chain', () => {
    const sim = new VerificationSimulator(studentPrivateState, issuerKey);
    fullFlow(sim);
    // after the FULL flow, none of the private inputs may appear in any ledger value:
    expectNoLedgerLeak(sim, [
      profile.name,
      profile.email,
      profile.college,
      profile.skills,
      profile.nonce,
      certificate.issuer,
      certificate.issuedAt, // bigint → has no byte representation on the ledger
      certificate.nonce,
      opening,
    ].filter((v): v is Uint8Array => v instanceof Uint8Array));
  });

  it('rejects a query for a skill the student does not have verified', () => {
    const sim = new VerificationSimulator(studentPrivateState, issuerKey);
    sim.registerStudent(1_000_000n);
    sim.addCertificate(CERT_ID);
    sim.switchUser(issuerPrivateState);
    sim.markVerified(studentId, CERT_ID, SOLIDITY_SKILL, 1_100_000n);
    sim.switchUser(studentPrivateState);
    expect(() => sim.proveSkill(strToBytes('Rust', FIELD_SIZES.skill), CERT_ID, 1_200_000n)).toThrow(
      'failed assert: Verified certificate does not match the requested skill',
    );
  });

  it('rejects proving with a certificate that is not verified on-chain', () => {
    const sim = new VerificationSimulator(studentPrivateState, issuerKey);
    sim.registerStudent(1_000_000n);
    sim.addCertificate(CERT_ID_OTHER);
    expect(() => sim.proveSkill(strToBytes('Midnight', FIELD_SIZES.skill), CERT_ID_OTHER, 1_200_000n)).toThrow(
      'failed assert: Certificate is not verified on-chain',
    );
  });
});

describe('SkillProof contract — full end-to-end state transitions', () => {
  it('completes the full flow and the public state tells the whole employer-side story', () => {
    const sim = new VerificationSimulator(studentPrivateState, issuerKey);
    const { ledger: afterProve } = fullFlow(sim);

    // On-chain, an observer can read:
    //   - the pseudonymous student, its commitment and active flag
    const profileOnChain = afterProve.students.lookup(studentId);
    expect(profileOnChain.active).toBe(true);
    expect(profileOnChain.profileCommitment.length).toBe(32);
    //   - which cert IDs are claimed (only commitments) and verified (with skill)
    expect(afterProve.claimedCerts.lookup(studentId).size()).toBe(1n);
    expect(afterProve.verifiedCerts.lookup(studentId).size()).toBe(1n);
    //   - the audit count
    expect(afterProve.verificationCount.lookup(studentId)).toBe(1n);
    // An observer CANNOT see name / email / college / score / CGPA / skills text:
    expect(bytesEqual(profileOnChain.profileCommitment, profile.name)).toBe(false);
    const allBytes: Uint8Array[] = [];
    collectLedgerBytes(afterProve, allBytes);
    for (const privateField of [profile.name, profile.email, profile.college, profile.skills]) {
      expect(allBytes.some((b) => containsBytes(b, privateField))).toBe(false);
    }
  });

  it('keeps verificationCount private-state agnostic and per-student', () => {
    const sim = new VerificationSimulator(studentPrivateState, issuerKey);
    sim.registerStudent(1_000_000n);
    sim.addCertificate(CERT_ID);
    sim.switchUser(issuerPrivateState);
    sim.markVerified(studentId, CERT_ID, SOLIDITY_SKILL, 1_100_000n);
    sim.switchUser(studentPrivateState);
    sim.proveSkill(SOLIDITY_SKILL, CERT_ID, 1_200_000n);
    sim.proveSkill(SOLIDITY_SKILL, CERT_ID, 1_200_000n);
    const after = sim.getLedger();
    expect(after.verificationCount.lookup(studentId)).toBe(2n);
  });
});
