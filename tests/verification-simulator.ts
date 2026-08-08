/**
 * SkillProof — headless test simulator (no Docker, no proof server).
 *
 * Runs the compiled contract against the compact-runtime in-process, exactly
 * like the canonical example-bboard simulator. The same simulator is the basis
 * for all tests below.
 */

import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
} from '@midnight-ntwrk/compact-runtime';
import {
  Contract,
  type Ledger,
  ledger,
} from '../contracts/managed/verification/contract/index.js';
import {
  type VerificationPrivateState,
  witnesses,
} from '../src/witnesses.js';

export class VerificationSimulator {
  readonly contract: Contract<VerificationPrivateState>;
  circuitContext: CircuitContext<VerificationPrivateState>;
  readonly issuerKey: Uint8Array;

  constructor(privateState: VerificationPrivateState, issuerKey: Uint8Array) {
    this.contract = new Contract<VerificationPrivateState>(witnesses);
    this.issuerKey = issuerKey;
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(
        createConstructorContext(privateState, '0'.repeat(64)),
        issuerKey,
      );
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(
        currentContractState.data,
        sampleContractAddress(),
      ),
    };
  }

  /** Swap in a different user's private state (multi-user tests). */
  public switchUser(privateState: VerificationPrivateState) {
    this.circuitContext.currentPrivateState = privateState;
  }

  public getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public getPrivateState(): VerificationPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  public registerStudent(registeredAt: bigint): Ledger {
    this.circuitContext = this.contract.impureCircuits
      .registerStudent(this.circuitContext, registeredAt)
      .context;
    return this.getLedger();
  }

  public addCertificate(certId: Uint8Array): Ledger {
    this.circuitContext = this.contract.impureCircuits
      .addCertificate(this.circuitContext, certId)
      .context;
    return this.getLedger();
  }

  public markVerified(
    studentId: Uint8Array,
    certId: Uint8Array,
    skill: Uint8Array,
    verifiedAt: bigint,
  ): Ledger {
    this.circuitContext = this.contract.impureCircuits
      .markVerified(this.circuitContext, studentId, certId, skill, verifiedAt)
      .context;
    return this.getLedger();
  }

  public proveSkill(
    querySkill: Uint8Array,
    certId: Uint8Array,
    answeredAt: bigint,
  ): {
    result: {
      studentId: Uint8Array;
      skill: Uint8Array;
      result: boolean;
      answeredAt: bigint;
    };
    ledger: Ledger;
  } {
    const results = this.contract.impureCircuits.proveSkill(
      this.circuitContext,
      querySkill,
      certId,
      answeredAt,
    );
    this.circuitContext = results.context;
    return { result: results.result, ledger: this.getLedger() };
  }
}
