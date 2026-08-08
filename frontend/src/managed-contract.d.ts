/**
 * Ambient declaration for the generated SkillProof Compact contract.
 *
 * The real module is emitted by `compact compile` into
 * contracts/managed/verification/contract/index.js. It is imported in the
 * browser bundle via the `@verification-contract` alias (see vite.config.ts).
 * Only the surfaces the frontend touches are typed here; everything else is
 * intentionally loose to stay in sync with the compiler output.
 */

declare module '@verification-contract' {
  export type Contract<PS = unknown> = any;
  export const Contract: any;

  export function ledger(stateOrChargedState: any): any;

  export const pureCircuits: {
    studentKey(sk: Uint8Array): Uint8Array;
    issuerKey(sk: Uint8Array): Uint8Array;
  };
}
