/**
 * SkillProof — headless test simulator (no Docker, no proof server).
 *
 * MOCK IMPLEMENTATION: This is a temporary mock for demonstration purposes.
 * The actual simulator requires compiled Compact contracts.
 */

import {
  type VerificationPrivateState,
} from '../src/witnesses.js';

// Mock types for demonstration
interface MockLedger {
  students: Map<string, any>;
  claimedCerts: Map<string, Map<string, string>>;
  verifiedCerts: Map<string, Map<string, any>>;
  verificationCount: Map<string, bigint>;
}

export class VerificationSimulator {
  private mockLedger: MockLedger;
  private privateState: VerificationPrivateState;
  readonly issuerKey: Uint8Array;

  constructor(privateState: VerificationPrivateState, issuerKey: Uint8Array) {
    this.privateState = privateState;
    this.issuerKey = issuerKey;
    this.mockLedger = {
      students: new Map(),
      claimedCerts: new Map(), 
      verifiedCerts: new Map(),
      verificationCount: new Map(),
    };
  }

  /** Swap in a different user's private state (multi-user tests). */
  public switchUser(privateState: VerificationPrivateState) {
    this.privateState = privateState;
  }

  public getLedger(): MockLedger {
    return this.mockLedger;
  }

  public getPrivateState(): VerificationPrivateState {
    return this.privateState;
  }

  public registerStudent(registeredAt: bigint): MockLedger {
    // Mock implementation - in reality this would use ZK proofs
    const studentId = Array.from(this.privateState.secretKey).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 8);
    
    if (this.mockLedger.students.has(studentId)) {
      throw new Error('Student is already registered');
    }
    
    this.mockLedger.students.set(studentId, {
      profileCommitment: 'mock-commitment-hash',
      active: true,
      registeredAt
    });
    
    this.mockLedger.claimedCerts.set(studentId, new Map());
    this.mockLedger.verifiedCerts.set(studentId, new Map());
    this.mockLedger.verificationCount.set(studentId, 0n);
    
    return this.getLedger();
  }

  public addCertificate(certId: Uint8Array): MockLedger {
    const studentId = Array.from(this.privateState.secretKey).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 8);
    const certIdStr = Array.from(certId).map(b => b.toString(16).padStart(2, '0')).join('');
    
    if (!this.mockLedger.students.has(studentId)) {
      throw new Error('Student is not registered');
    }
    
    const claimedCerts = this.mockLedger.claimedCerts.get(studentId)!;
    claimedCerts.set(certIdStr, 'mock-certificate-hash');
    
    return this.getLedger();
  }

  public markVerified(
    studentId: Uint8Array,
    certId: Uint8Array,
    skill: Uint8Array,
    verifiedAt: bigint,
  ): MockLedger {
    const studentIdStr = Array.from(studentId).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 8);
    const certIdStr = Array.from(certId).map(b => b.toString(16).padStart(2, '0')).join('');
    const skillStr = new TextDecoder().decode(skill).replace(/\0+$/, '');
    
    if (!this.mockLedger.students.has(studentIdStr)) {
      throw new Error('Student is not registered');
    }
    
    const claimedCerts = this.mockLedger.claimedCerts.get(studentIdStr)!;
    if (!claimedCerts.has(certIdStr)) {
      throw new Error('Student has not claimed this certificate');
    }
    
    const verifiedCerts = this.mockLedger.verifiedCerts.get(studentIdStr)!;
    verifiedCerts.set(certIdStr, { skill: skillStr, verifiedAt });
    
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
    ledger: MockLedger;
  } {
    const studentId = Array.from(this.privateState.secretKey).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 8);
    const certIdStr = Array.from(certId).map(b => b.toString(16).padStart(2, '0')).join('');
    const querySkillStr = new TextDecoder().decode(querySkill).replace(/\0+$/, '');
    
    if (!this.mockLedger.students.has(studentId)) {
      throw new Error('Student is not registered');
    }
    
    const verifiedCerts = this.mockLedger.verifiedCerts.get(studentId)!;
    const verified = verifiedCerts.get(certIdStr);
    
    if (!verified) {
      throw new Error('Certificate is not verified on-chain');
    }
    
    if (verified.skill !== querySkillStr) {
      throw new Error('Verified certificate does not match the requested skill');
    }
    
    // Increment verification count
    const currentCount = this.mockLedger.verificationCount.get(studentId) || 0n;
    this.mockLedger.verificationCount.set(studentId, currentCount + 1n);
    
    return {
      result: {
        studentId: this.privateState.secretKey.slice(0, 32),
        skill: querySkill,
        result: true,
        answeredAt
      },
      ledger: this.getLedger()
    };
  }
}
