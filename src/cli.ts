/**
 * SkillProof CLI — interact with a deployed SkillProof contract from the
 * command line.
 *
 * Two identities live on this machine:
 *   - ISSUER: derived from the wallet seed (the deployer). Its private state
 *     was stored at deploy time under 'verificationPrivateState' and is read
 *     back from the local level DB. Only the issuer can run `verify`.
 *   - STUDENT: a fresh random identity persisted in student-state.json
 *     (git-ignored). Everything about the student — name, email, college,
 *     exam scores, skills, certificate contents — lives only here and is fed
 *     to the zero-knowledge witnesses. Only commitments and the minimal
 *     disclosed `Answer` ever reach the chain.
 *
 * Usage (run from the repo root):
 *   npm run cli -- balance
 *   npm run cli -- status
 *   npm run cli -- profile <name> <email> <college> <examScore> <cgpa> <skills>
 *   npm run cli -- register
 *   npm run cli -- add-cert <certId> <skill> <issuer> <issuedAt>
 *   npm run cli -- verify <studentIdHex> <certId> <skill>
 *   npm run cli -- prove <querySkill> <certId>
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';

// Midnight SDK imports
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';

import { resolveNetwork, getOrCreateSeed, getDeployment } from './network';
import { createWallet, persistWalletState, unshieldedToken, type WalletContext } from './wallet';
import {
  CompiledVerificationContract,
  issuerKeyOf,
  studentIdOf,
  MANAGED_ASSETS_DIR,
  bytesToHex,
  bytesFromHex,
  strToBytes,
  FIELD_SIZES,
} from './contract.js';
import {
  ensureStudentState,
  setProfile,
  addCertificateToState,
  toPrivateState,
  loadStudentState,
  describeCertificate,
} from './student-state.js';

// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

// Private state IDs. The issuer's state was stored at deploy time; the
// student's is stored on first register and (being stable) re-seeded from
// student-state.json on every run.
const ISSUER_PRIVATE_STATE_ID = 'verificationPrivateState';
const STUDENT_PRIVATE_STATE_ID = 'verificationStudentPrivateState';
const PRIVATE_STATE_STORE = 'verification-state';

const { network, config: networkConfig } = resolveNetwork();
const SEED = getOrCreateSeed(network);

// ─── Providers ─────────────────────────────────────────────────────────────────

async function createProviders(walletCtx: WalletContext) {
  const privateStatePassword = process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Local-Devnet-Development-Placeholder-1';

  const walletProvider = {
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return walletCtx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };

  const zkConfigProvider = new NodeZkConfigProvider(MANAGED_ASSETS_DIR);
  const accountId = walletCtx.unshieldedKeystore.getBech32Address().toString();

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: PRIVATE_STATE_STORE,
      accountId,
      privateStoragePasswordProvider: () => privateStatePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

// ─── Shared setup ──────────────────────────────────────────────────────────────

async function connect() {
  const deployment = getDeployment(network);
  if (!deployment) {
    console.error(`No deploy on file for network ${network}. Run \`npm run setup -- --network ${network}\` first.`);
    process.exit(1);
  }

  const walletCtx = await createWallet({ network, networkConfig, seed: SEED });
  const state = await walletCtx.wallet.waitForSyncedState();
  await persistWalletState(network, walletCtx);
  const providers = await createProviders(walletCtx);
  return { deployment, walletCtx, state, providers };
}

/** Connect with the issuer identity (reads its private state from the level DB). */
async function connectAsIssuer(walletCtx: WalletContext, providers: Awaited<ReturnType<typeof createProviders>>, contractAddress: string) {
  return findDeployedContract(providers, {
    compiledContract: CompiledVerificationContract as any,
    contractAddress,
    privateStateId: ISSUER_PRIVATE_STATE_ID,
  });
}

/** Connect with the student identity (re-seeds its private state from student-state.json). */
async function connectAsStudent(walletCtx: WalletContext, providers: Awaited<ReturnType<typeof createProviders>>, contractAddress: string) {
  const serialized = ensureStudentState();
  return findDeployedContract(providers, {
    compiledContract: CompiledVerificationContract as any,
    contractAddress,
    privateStateId: STUDENT_PRIVATE_STATE_ID,
    initialPrivateState: toPrivateState(serialized),
  });
}

// ─── Commands ──────────────────────────────────────────────────────────────────

async function cmdBalance() {
  const { walletCtx } = await connect();
  const state = await walletCtx.wallet.waitForSyncedState();
  const tNight = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
  const dust = state.dust.balance(new Date());
  console.log(`  Network: ${network}`);
  console.log(`  tNight:  ${tNight.toLocaleString()}`);
  console.log(`  DUST:    ${dust.toLocaleString()}`);
  await persistWalletState(network, walletCtx);
  await walletCtx.wallet.stop();
}

async function cmdStatus() {
  const deployment = getDeployment(network);
  const serialized = loadStudentState();
  console.log(`  Network:     ${network}`);
  console.log(`  Contract:    ${deployment ? deployment.address : '(not deployed — run npm run setup)'}`);
  if (serialized) {
    console.log(`  Student id:  ${bytesToHex(studentIdOf(bytesFromHex(serialized.secretKey)))}`);
    console.log(`  Student pid: ${bytesToHex(bytesFromHex(serialized.secretKey).subarray(0, 4))}… (secret)`);
    if (serialized.profile.name) {
      console.log(`  Profile:     ${serialized.profile.name} <${serialized.profile.email}>`);
    } else {
      console.log('  Profile:     (not set — use `profile` then `register`)');
    }
    console.log(`  Certificates: ${serialized.certificates.length}`);
    for (const c of serialized.certificates) console.log(`    - ${describeCertificate(c)}`);
  } else {
    console.log('  Student:     (no student identity yet)');
  }
  const issuerKey = issuerKeyOf(bytesFromHex(SEED));
  console.log(`  Issuer key:  ${bytesToHex(issuerKey)}`);
}

async function cmdProfile(args: string[]) {
  const [name, email, college, examScoreStr, cgpaStr, skills] = args;
  const examScore = Number(examScoreStr);
  const cgpa = Number(cgpaStr);
  if (!name || !email || !college || !Number.isFinite(examScore) || !Number.isFinite(cgpa) || !skills) {
    console.error('  Usage: npm run cli -- profile <name> <email> <college> <examScore> <cgpa> <skills>');
    process.exit(1);
  }
  if (cgpa < 0 || cgpa > 10) {
    console.error('  cgpa must be between 0 and 10.');
    process.exit(1);
  }
  const state = ensureStudentState();
  setProfile(state, { name, email, college, examScore, cgpa, skills });
  console.log(`  Profile saved locally (never leaves this device):`);
  console.log(`    name=${name} email=${email} college=${college} examScore=${examScore} cgpa=${cgpa} skills=${skills}`);
  console.log(`  Next: npm run cli -- register`);
}

async function cmdRegister() {
  const { walletCtx, providers, deployment } = await connect();
  try {
    const serialized = ensureStudentState();
    if (!serialized.profile.name) {
      console.error('  No profile set yet. Run: npm run cli -- profile <name> <email> <college> <examScore> <cgpa> <skills>');
      return;
    }
    const studentId = studentIdOf(bytesFromHex(serialized.secretKey));
    console.log(`  Registering student ${bytesToHex(studentId).slice(0, 16)}… (commitment only, nothing personal is published)`);
    const deployed = await connectAsStudent(walletCtx, providers, deployment.address);
    const tx = await deployed.callTx.registerStudent(BigInt(Math.floor(Date.now() / 1000)));
    console.log(`  ✅ Registered`);
    console.log(`  Transaction ID: ${tx.public.txId}`);
    console.log(`  Block height: ${tx.public.blockHeight}`);
    console.log(`  Your pseudonymous student id: ${bytesToHex(studentId)}`);
  } catch (err: any) {
    console.error('  ❌ Failed:', err instanceof Error ? err.message : err);
  } finally {
    await persistWalletState(network, walletCtx);
    await walletCtx.wallet.stop();
  }
}

async function cmdAddCert(args: string[]) {
  const [certId, skill, issuer, issuedAtStr] = args;
  const issuedAt = Number(issuedAtStr);
  if (!certId || !skill || !issuer || !Number.isFinite(issuedAt)) {
    console.error('  Usage: npm run cli -- add-cert <certId> <skill> <issuer> <issuedAt-unix-seconds>');
    process.exit(1);
  }
  if (certId.length > FIELD_SIZES.certId || skill.length > FIELD_SIZES.skill || issuer.length > FIELD_SIZES.issuer) {
    console.error(`  certId ≤ ${FIELD_SIZES.certId}, skill ≤ ${FIELD_SIZES.skill}, issuer ≤ ${FIELD_SIZES.issuer} characters.`);
    process.exit(1);
  }
  const { walletCtx, providers, deployment } = await connect();
  try {
    const serialized = addCertificateToState(ensureStudentState(), { id: certId, skill, issuer, issuedAt });
    console.log('  Certificate added to private state (kept off-chain):');
    console.log(`    ${describeCertificate({ id: certId, skill, issuer, issuedAt, nonce: '' })}`);
    console.log('  Committing its hash on-chain…');
    const deployed = await connectAsStudent(walletCtx, providers, deployment.address);
    const tx = await deployed.callTx.addCertificate(strToBytes(certId, FIELD_SIZES.certId));
    console.log(`  ✅ Certificate committed`);
    console.log(`  Transaction ID: ${tx.public.txId}`);
    console.log(`  Block height: ${tx.public.blockHeight}`);
    console.log(`  Next: the issuer runs verify, then you can prove the skill.`);
  } catch (err: any) {
    console.error('  ❌ Failed:', err instanceof Error ? err.message : err);
  } finally {
    await persistWalletState(network, walletCtx);
    await walletCtx.wallet.stop();
  }
}

async function cmdVerify(args: string[]) {
  const [studentIdHex, certId, skill] = args;
  if (!studentIdHex || !certId || !skill) {
    console.error('  Usage: npm run cli -- verify <studentIdHex> <certId> <skill>');
    process.exit(1);
  }
  if (certId.length > FIELD_SIZES.certId || skill.length > FIELD_SIZES.skill) {
    console.error(`  certId ≤ ${FIELD_SIZES.certId}, skill ≤ ${FIELD_SIZES.skill} characters.`);
    process.exit(1);
  }
  const { walletCtx, providers, deployment } = await connect();
  try {
    console.log('  Connecting with issuer identity…');
    const deployed = await connectAsIssuer(walletCtx, providers, deployment.address);
    const tx = await deployed.callTx.markVerified(
      bytesFromHex(studentIdHex),
      strToBytes(certId, FIELD_SIZES.certId),
      strToBytes(skill, FIELD_SIZES.skill),
      BigInt(Math.floor(Date.now() / 1000)),
    );
    console.log(`  ✅ Verified ${certId} (${skill}) for student ${studentIdHex.slice(0, 16)}…`);
    console.log(`  Transaction ID: ${tx.public.txId}`);
    console.log(`  Block height: ${tx.public.blockHeight}`);
  } catch (err: any) {
    console.error('  ❌ Failed:', err instanceof Error ? err.message : err);
  } finally {
    await persistWalletState(network, walletCtx);
    await walletCtx.wallet.stop();
  }
}

async function cmdProve(args: string[]) {
  const [querySkill, certId] = args;
  if (!querySkill || !certId) {
    console.error('  Usage: npm run cli -- prove <querySkill> <certId>');
    process.exit(1);
  }
  const { walletCtx, providers, deployment } = await connect();
  try {
    const serialized = ensureStudentState();
    if (!serialized.certificates.some((c) => c.id === certId)) {
      console.error(`  You don't hold a certificate with id "${certId}". Add it with: npm run cli -- add-cert ${certId} <skill> <issuer> <issuedAt>`);
      return;
    }
    const deployed = await connectAsStudent(walletCtx, providers, deployment.address);
    console.log(`  Proving skill "${querySkill}"…`);
    const tx = await deployed.callTx.proveSkill(
      strToBytes(querySkill, FIELD_SIZES.skill),
      strToBytes(certId, FIELD_SIZES.certId),
      BigInt(Math.floor(Date.now() / 1000)),
    );
    const answer = tx.private.result as {
      studentId: Uint8Array;
      skill: Uint8Array;
      result: boolean;
      answeredAt: bigint;
    };
    console.log('  ✅ Proof generated. Disclosed answer (public):');
    console.log(`    studentId:  ${bytesToHex(answer.studentId)}`);
    console.log(`    skill:      ${bytesToStr(answer.skill)}`);
    console.log(`    result:     ${answer.result}`);
    console.log(`    answeredAt: ${answer.answeredAt} (unix seconds)`);
    console.log(`  Transaction ID: ${tx.public.txId}`);
    console.log(`  Block height: ${tx.public.blockHeight}`);
  } catch (err: any) {
    console.error('  ❌ Failed:', err instanceof Error ? err.message : err);
  } finally {
    await persistWalletState(network, walletCtx);
    await walletCtx.wallet.stop();
  }
}

function bytesToStr(b: Uint8Array): string {
  let end = b.length;
  while (end > 0 && b[end - 1] === 0) end--;
  return new TextDecoder().decode(b.slice(0, end));
}

// ─── Entry ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                  SkillProof CLI                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  console.log(`  Network: ${network}\n`);

  const [, , command, ...args] = process.argv;
  switch (command) {
    case 'balance':
      await cmdBalance();
      break;
    case 'status':
      await cmdStatus();
      break;
    case 'profile':
      await cmdProfile(args);
      break;
    case 'register':
      await cmdRegister();
      break;
    case 'add-cert':
      await cmdAddCert(args);
      break;
    case 'verify':
      await cmdVerify(args);
      break;
    case 'prove':
      await cmdProve(args);
      break;
    default:
      console.log('Usage:');
      console.log('  npm run cli -- balance');
      console.log('  npm run cli -- status');
      console.log('  npm run cli -- profile <name> <email> <college> <examScore> <cgpa> <skills>');
      console.log('  npm run cli -- register');
      console.log('  npm run cli -- add-cert <certId> <skill> <issuer> <issuedAt>');
      console.log('  npm run cli -- verify <studentIdHex> <certId> <skill>');
      console.log('  npm run cli -- prove <querySkill> <certId>');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
