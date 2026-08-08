/**
 * SkillProof — React context wiring the browser UI to the Midnight contract.
 *
 * Responsibilities:
 *   - connect to the Midnight Lace wallet via the DApp Connector
 *   - deploy a fresh SkillProof contract or join an existing one
 *   - keep the student's PRIVATE identity in localStorage (never sent anywhere)
 *   - expose the on-chain ledger state for display
 *   - expose the actions: register, addCertificate, verify (issuer-only),
 *     proveSkill (returns the minimal disclosed Answer)
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';

import { CompiledVerificationContract, studentIdOf, issuerKeyOf } from './contracts';
import { connectToWallet, createProviders, type SkillProofProviders } from './wallet';
import {
  createFreshPrivateState,
  deserializePrivateState,
  serializePrivateState,
  randomBytes,
  bytesToHex,
  bytesFromHex,
  type SerializedPrivateState,
  type SerializedCertificate,
} from './private-state';
import { type ProfileInput, type VerificationPrivateState, strToBytes, FIELD_SIZES } from '../../src/witnesses.js';
import { VerificationContract } from './contracts';

export const STUDENT_PRIVATE_STATE_ID = 'verificationStudentPrivateState';
export const ISSUER_PRIVATE_STATE_ID = 'verificationIssuerPrivateState';
const ISSUER_SECRET_KEY_STORAGE = 'skillproof:issuer:secret';

const bytesToStr = (b: Uint8Array): string => {
  let end = b.length;
  while (end > 0 && b[end - 1] === 0) end--;
  return new TextDecoder().decode(b.slice(0, end));
};

type CallTx = {
  registerStudent(registeredAt: bigint): Promise<any>;
  addCertificate(certId: Uint8Array): Promise<any>;
  markVerified(studentId: Uint8Array, certId: Uint8Array, skill: Uint8Array, verifiedAt: bigint): Promise<any>;
  proveSkill(querySkill: Uint8Array, certId: Uint8Array, answeredAt: bigint): Promise<any>;
};

type DeployedSkillProof = {
  deployTxData: { public: { contractAddress: string } };
  callTx: CallTx;
};

export type LedgerView = {
  issuer: string;
  registered: boolean;
  verificationCount: number;
  claimedCerts: Array<{ certId: string; commitment: string }>;
  verifiedCerts: Array<{ certId: string; skill: string; verifiedAt: number }>;
};

export type Answer = {
  studentId: string;
  skill: string;
  result: boolean;
  answeredAt: number;
};

type ConnectResult = {
  networkId: string;
  walletAddress: string;
};

export type SkillProofContextValue = {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  error: string | null;
  networkId: string | null;
  walletAddress: string | null;
  contractAddress: string | null;
  isDeployer: boolean;
  ledger: LedgerView | null;
  myState: SerializedPrivateState | null;
  studentId: string | null;
  issuerSecretKeyHex: string | null;
  onChainIssuer: string | null;
  busy: string | null;

  connect(networkId: string): Promise<ConnectResult>;
  setProfile(input: ProfileInput): Promise<void>;
  register(): Promise<{ txId: string; blockHeight: number }>;
  addCertificate(input: {
    id: string;
    skill: string;
    issuer: string;
    issuedAt: number;
  }): Promise<{ txId: string; blockHeight: number }>;
  setIssuerSecretKey(hex: string): Promise<void>;
  verify(studentIdHex: string, certId: string, skill: string): Promise<{ txId: string; blockHeight: number }>;
  proveSkill(querySkill: string, certId: string): Promise<{ txId: string; blockHeight: number; answer: Answer }>;
  reset(): Promise<void>;
};

const SkillProofContext = createContext<SkillProofContextValue | undefined>(undefined);

export const useSkillProof = (): SkillProofContextValue => {
  const ctx = useContext(SkillProofContext);
  if (!ctx) throw new Error('useSkillProof must be used within a <SkillProofProvider>');
  return ctx;
};

// ─── helpers ──────────────────────────────────────────────────────────────────

const readIssuerSecretKey = (): string | null => {
  try {
    return localStorage.getItem(ISSUER_SECRET_KEY_STORAGE);
  } catch {
    return null;
  }
};

const writeIssuerSecretKey = (hex: string): void => {
  localStorage.setItem(ISSUER_SECRET_KEY_STORAGE, hex);
};

const decodeLedger = (ledger: any, myStudentId: Uint8Array): LedgerView => {
  const issuer = bytesToHex(ledger.issuer);
  const registered = ledger.students.member(myStudentId);

  const claimedCerts: LedgerView['claimedCerts'] = [];
  const verifiedCerts: LedgerView['verifiedCerts'] = [];
  if (registered) {
    const claims = ledger.claimedCerts.lookup(myStudentId);
    for (const [certId, commitment] of claims.keys()) {
      claimedCerts.push({ certId: bytesToHex(certId), commitment: bytesToHex(commitment) });
    }
    const verified = ledger.verifiedCerts.lookup(myStudentId);
    for (const [certId, record] of verified.keys()) {
      verifiedCerts.push({
        certId: bytesToHex(certId),
        skill: bytesToStr(record.skill),
        verifiedAt: Number(record.verifiedAt),
      });
    }
  }

  let verificationCount = 0;
  try {
    if (registered && ledger.verificationCount.member(myStudentId)) {
      verificationCount = Number(ledger.verificationCount.lookup(myStudentId));
    }
  } catch {
    verificationCount = 0;
  }

  return { issuer, registered, verificationCount, claimedCerts, verifiedCerts };
};

const txSummary = (tx: any): { txId: string; blockHeight: number } => ({
  txId: tx?.public?.txId ?? 'unknown',
  blockHeight: tx?.public?.blockHeight ?? 0,
});

// ─── provider ─────────────────────────────────────────────────────────────────

export const SkillProofProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [status, setStatus] = useState<SkillProofContextValue['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  const [networkId, setNetworkId] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [contractAddress, setContractAddress] = useState<string | null>(null);
  const [isDeployer, setIsDeployer] = useState(false);
  const [ledger, setLedger] = useState<LedgerView | null>(null);
  const [myState, setMyState] = useState<SerializedPrivateState | null>(null);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [issuerSecretKeyHex, setIssuerSecretKeyHex] = useState<string | null>(null);
  const [onChainIssuer, setOnChainIssuer] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const providersRef = useRef<SkillProofProviders | null>(null);
  const studentDeployedRef = useRef<DeployedSkillProof | null>(null);
  const issuerDeployedRef = useRef<DeployedSkillProof | null>(null);
  const networkIdRef = useRef<string | null>(null);

  // Ensure a fresh student identity exists, and persist it to the provider so
  // the witnesses read a consistent state on first call.
  const ensureStudentState = useCallback(async (): Promise<SerializedPrivateState> => {
    let serialized: SerializedPrivateState | null = null;
    try {
      const raw = localStorage.getItem('skillproof:student');
      if (raw) serialized = JSON.parse(raw) as SerializedPrivateState;
    } catch {
      serialized = null;
    }
    if (!serialized) {
      const fresh = serializePrivateState(createFreshPrivateState());
      localStorage.setItem('skillproof:student', JSON.stringify(fresh));
      serialized = fresh;
    }
    const providers = providersRef.current;
    if (providers) {
      await providers.privateStateProvider.set(STUDENT_PRIVATE_STATE_ID, deserializePrivateState(serialized));
    }
    return serialized;
  }, []);

  // Push the current serialized student state into the private state provider.
  const commitStudentState = useCallback(async (serialized: SerializedPrivateState): Promise<void> => {
    localStorage.setItem('skillproof:student', JSON.stringify(serialized));
    setMyState(serialized);
    const providers = providersRef.current;
    if (providers) {
      await providers.privateStateProvider.set(STUDENT_PRIVATE_STATE_ID, deserializePrivateState(serialized));
    }
  }, []);

  // Subscribe to the on-chain ledger state and derive a view for the UI.
  useEffect(() => {
    if (!providersRef.current || !contractAddress || !studentId) return;
    const address = contractAddress;
    const observable = providersRef.current.publicDataProvider.contractStateObservable(address, { type: 'latest' });
    const sub = observable.subscribe({
      next: (contractState) => {
        try {
          const decoded = VerificationContract.ledger(contractState.data);
          const view = decodeLedger(decoded, bytesFromHex(studentId));
          setLedger(view);
          setOnChainIssuer(view.issuer);
        } catch (e) {
          // Ledger not yet readable (e.g. state missing); ignore.
          void e;
        }
      },
      error: (e: unknown) => {
        console.error('contractStateObservable error', e);
      },
    });
    return () => sub.unsubscribe();
  }, [contractAddress, studentId]);

  const connect = useCallback(
    async (networkId: string): Promise<ConnectResult> => {
      setStatus('connecting');
      setError(null);
      try {
        const connectedAPI = await connectToWallet(networkId as any);
        const serialized = await ensureStudentState();
        const providers = await createProviders(connectedAPI, serialized);
        providersRef.current = providers;
        networkIdRef.current = networkId;

        // Determine contract: join from env, else deploy a fresh one.
        const envAddress = import.meta.env.VITE_CONTRACT_ADDRESS as string | undefined;

        const issuerSecret = readIssuerSecretKey();
        const issuerSecretKey = issuerSecret ? bytesFromHex(issuerSecret) : randomBytes(32);
        const issuerKey = issuerKeyOf(issuerSecretKey);

        const buildInitialPrivateState = (secretKey: Uint8Array): VerificationPrivateState => ({
          secretKey,
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

        let deployed: DeployedSkillProof;
        let deployedAddress: string;

        if (envAddress) {
          providers.privateStateProvider.setContractAddress(envAddress);
          deployed = (await findDeployedContract(providers, {
            compiledContract: CompiledVerificationContract as any,
            contractAddress: envAddress,
            privateStateId: STUDENT_PRIVATE_STATE_ID,
            initialPrivateState: deserializePrivateState(serialized),
          })) as unknown as DeployedSkillProof;
          deployedAddress = envAddress;
          setIsDeployer(false);
        } else {
          // Deploy a fresh contract; the browser becomes the issuer.
          if (!issuerSecret) {
            writeIssuerSecretKey(bytesToHex(issuerSecretKey));
          }
          deployed = (await deployContract(providers, {
            compiledContract: CompiledVerificationContract as any,
            args: [issuerKey],
            privateStateId: STUDENT_PRIVATE_STATE_ID,
            initialPrivateState: deserializePrivateState(serialized),
          })) as unknown as DeployedSkillProof;
          deployedAddress = deployed.deployTxData.public.contractAddress;
          providers.privateStateProvider.setContractAddress(deployedAddress);
          setIsDeployer(true);
        }

        providers.privateStateProvider.setContractAddress(deployedAddress);
        studentDeployedRef.current = deployed;
        setContractAddress(deployedAddress);
        setNetworkId(networkId);
        setWalletAddress('connected');

        const sid = bytesToHex(studentIdOf(bytesFromHex(serialized.secretKey)));
        setStudentId(sid);
        setIssuerSecretKeyHex(issuerSecret ? issuerSecret : null);
        setMyState(serialized);
        setStatus('connected');

        // Read the deployed issuer key for display.
        try {
          const state = await providers.publicDataProvider.queryContractState(deployedAddress);
          if (state) {
            const decoded = VerificationContract.ledger(state.data);
            setOnChainIssuer(bytesToHex(decoded.issuer));
          }
        } catch {
          // non-fatal
        }

        return {
          networkId,
          walletAddress: 'connected',
        };
      } catch (e) {
        setStatus('error');
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      }
    },
    [ensureStudentState],
  );

  const setProfile = useCallback(
    async (input: ProfileInput) => {
      const providers = providersRef.current;
      if (!providers || !myState) throw new Error('Not connected');
      const next: SerializedPrivateState = {
        ...myState,
        profile: { ...input, nonce: myState.profile.nonce },
      };
      await commitStudentState(next);
    },
    [myState, commitStudentState],
  );

  const register = useCallback(async () => {
    const deployed = studentDeployedRef.current;
    if (!deployed) throw new Error('Not connected to a contract');
    setBusy('registering');
    try {
      const tx = await deployed.callTx.registerStudent(BigInt(Math.floor(Date.now() / 1000)));
      return txSummary(tx);
    } finally {
      setBusy(null);
    }
  }, []);

  const addCertificate = useCallback(
    async (input: { id: string; skill: string; issuer: string; issuedAt: number }) => {
      const deployed = studentDeployedRef.current;
      if (!deployed || !myState) throw new Error('Not connected');
      const cert: SerializedCertificate = { ...input, nonce: bytesToHex(randomBytes(32)) };
      const next: SerializedPrivateState = { ...myState, certificates: [...myState.certificates, cert] };
      await commitStudentState(next);
      setBusy('adding certificate');
      try {
        const tx = await deployed.callTx.addCertificate(strToBytes(input.id, FIELD_SIZES.certId));
        return txSummary(tx);
      } finally {
        setBusy(null);
      }
    },
    [myState, commitStudentState],
  );

  const setIssuerSecretKey = useCallback(
    async (hex: string) => {
      const providers = providersRef.current;
      if (!providers || !contractAddress) throw new Error('Not connected');
      const keyBytes = bytesFromHex(hex);
      if (keyBytes.length !== 32) throw new Error('Issuer secret key must be 32 bytes (64 hex chars).');
      writeIssuerSecretKey(hex);
      setIssuerSecretKeyHex(hex);

      const issuerState: VerificationPrivateState = {
        secretKey: keyBytes,
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
      };
      providers.privateStateProvider.setContractAddress(contractAddress);
      await providers.privateStateProvider.set(ISSUER_PRIVATE_STATE_ID, issuerState);
      issuerDeployedRef.current = (await findDeployedContract(providers, {
        compiledContract: CompiledVerificationContract as any,
        contractAddress,
        privateStateId: ISSUER_PRIVATE_STATE_ID,
        initialPrivateState: issuerState,
      })) as unknown as DeployedSkillProof;
    },
    [contractAddress],
  );

  const verify = useCallback(
    async (studentIdHex: string, certId: string, skill: string) => {
      const deployed = issuerDeployedRef.current;
      if (!deployed) throw new Error('Issuer identity not set. Paste the issuer secret key first.');
      setBusy('verifying');
      try {
        const tx = await deployed.callTx.markVerified(
          bytesFromHex(studentIdHex),
          strToBytes(certId, FIELD_SIZES.certId),
          strToBytes(skill, FIELD_SIZES.skill),
          BigInt(Math.floor(Date.now() / 1000)),
        );
        return txSummary(tx);
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const proveSkill = useCallback(
    async (querySkill: string, certId: string) => {
      const deployed = studentDeployedRef.current;
      if (!deployed) throw new Error('Not connected to a contract');
      setBusy('proving');
      try {
        const tx = await deployed.callTx.proveSkill(
          strToBytes(querySkill, FIELD_SIZES.skill),
          strToBytes(certId, FIELD_SIZES.certId),
          BigInt(Math.floor(Date.now() / 1000)),
        );
        const result = tx?.private?.result as
          | { studentId: Uint8Array; skill: Uint8Array; result: boolean; answeredAt: bigint }
          | undefined;
        const answer: Answer = result
          ? {
              studentId: bytesToHex(result.studentId),
              skill: bytesToStr(result.skill),
              result: result.result,
              answeredAt: Number(result.answeredAt),
            }
          : { studentId: '', skill: querySkill, result: false, answeredAt: 0 };
        return { ...txSummary(tx), answer };
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const reset = useCallback(async () => {
    studentDeployedRef.current = null;
    issuerDeployedRef.current = null;
    providersRef.current = null;
    setStatus('idle');
    setError(null);
    setContractAddress(null);
    setLedger(null);
    setNetworkId(null);
    setWalletAddress(null);
    setMyState(null);
    setStudentId(null);
    setOnChainIssuer(null);
    setIssuerSecretKeyHex(null);
  }, []);

  const value = useMemo<SkillProofContextValue>(
    () => ({
      status,
      error,
      networkId,
      walletAddress,
      contractAddress,
      isDeployer,
      ledger,
      myState,
      studentId,
      issuerSecretKeyHex,
      onChainIssuer,
      busy,
      connect,
      setProfile,
      register,
      addCertificate,
      setIssuerSecretKey,
      verify,
      proveSkill,
      reset,
    }),
    [
      status,
      error,
      networkId,
      walletAddress,
      contractAddress,
      isDeployer,
      ledger,
      myState,
      studentId,
      issuerSecretKeyHex,
      onChainIssuer,
      busy,
      connect,
      setProfile,
      register,
      addCertificate,
      setIssuerSecretKey,
      verify,
      proveSkill,
      reset,
    ],
  );

  return <SkillProofContext.Provider value={value}>{children}</SkillProofContext.Provider>;
};
