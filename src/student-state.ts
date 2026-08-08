/**
 * SkillProof — student private-state persistence for the CLI.
 *
 * A DApp user's identity is a random secret key kept only on this machine.
 * Everything here — the secret key, the profile, the certificate contents and
 * their nonces — is PRIVATE. The file is git-ignored and must never be
 * uploaded, logged, or shared. Only hashes/commitments derived from it are
 * ever sent to the chain.
 *
 * The nonces must survive restarts: re-committing a profile or certificate
 * with a different nonce would change the commitment and break the on-chain
 * binding.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bytesToHex,
  bytesFromHex,
  randomBytes,
  strToBytes,
  FIELD_SIZES,
  type Profile,
  type Certificate,
  type ProfileInput,
  type CertificateInput,
  type VerificationPrivateState,
} from './witnesses.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STUDENT_STATE_PATH = path.resolve(__dirname, '..', 'student-state.json');

type SerializedCertificate = CertificateInput & { readonly nonce: string };
type SerializedProfile = ProfileInput & { readonly nonce: string };

export type SerializedStudentState = {
  readonly secretKey: string;
  readonly profileOpening: string;
  readonly profile: SerializedProfile;
  readonly certificates: readonly SerializedCertificate[];
};

const readFile = (p: string): SerializedStudentState | undefined => {
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw) as SerializedStudentState;
  } catch {
    return undefined;
  }
};

/** Load the student state, or create a fresh one (new random identity) if absent. */
export function ensureStudentState(): SerializedStudentState {
  const existing = readFile(STUDENT_STATE_PATH);
  if (existing) return existing;
  return newStudentState();
}

/** Create a brand-new student identity (new random secret key + opening). */
export function newStudentState(): SerializedStudentState {
  const state: SerializedStudentState = {
    secretKey: bytesToHex(randomBytes(32)),
    profileOpening: bytesToHex(randomBytes(32)),
    profile: {
      name: '',
      email: '',
      college: '',
      examScore: 0,
      cgpa: 0,
      skills: '',
      nonce: bytesToHex(randomBytes(32)),
    },
    certificates: [],
  };
  saveStudentState(state);
  return state;
}

export function saveStudentState(state: SerializedStudentState): void {
  fs.writeFileSync(STUDENT_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

export function loadStudentState(): SerializedStudentState | undefined {
  return readFile(STUDENT_STATE_PATH);
}

/** Convert serialized state into the runtime private state the witnesses expect. */
export function toPrivateState(state: SerializedStudentState): VerificationPrivateState {
  const p = state.profile;
  const profile: Profile = {
    name: strToBytes(p.name, FIELD_SIZES.name),
    email: strToBytes(p.email, FIELD_SIZES.email),
    college: strToBytes(p.college, FIELD_SIZES.college),
    examScore: BigInt(p.examScore),
    cgpa: BigInt(Math.round(p.cgpa * 100)),
    skills: strToBytes(p.skills, FIELD_SIZES.skills),
    nonce: bytesFromHex(p.nonce),
  };
  const certificates: Certificate[] = state.certificates.map((c) => ({
    id: strToBytes(c.id, FIELD_SIZES.certId),
    skill: strToBytes(c.skill, FIELD_SIZES.skill),
    issuer: strToBytes(c.issuer, FIELD_SIZES.issuer),
    issuedAt: BigInt(c.issuedAt),
    nonce: bytesFromHex(c.nonce),
  }));
  return {
    secretKey: bytesFromHex(state.secretKey),
    profile,
    profileOpening: bytesFromHex(state.profileOpening),
    certificates,
  };
}

/** Update the profile fields (nonce and identity preserved). */
export function setProfile(state: SerializedStudentState, input: ProfileInput): SerializedStudentState {
  const next: SerializedStudentState = {
    ...state,
    profile: { ...input, nonce: state.profile.nonce },
  };
  saveStudentState(next);
  return next;
}

/** Add a certificate to the held set. Returns the updated state. */
export function addCertificateToState(state: SerializedStudentState, input: CertificateInput): SerializedStudentState {
  const nonce = bytesToHex(randomBytes(32));
  const cert: SerializedCertificate = { ...input, nonce };
  const next: SerializedStudentState = {
    ...state,
    certificates: [...state.certificates, cert],
  };
  saveStudentState(next);
  return next;
}

/** Human-readable summary of the held (private) certificate, for display only. */
export const describeCertificate = (c: SerializedCertificate): string =>
  `${c.id} | skill=${c.skill} | issuer=${c.issuer} | issuedAt=${c.issuedAt}`;


