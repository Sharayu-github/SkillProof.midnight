# SkillProof — Privacy-Preserving Skill Verification on Midnight

SkillProof lets a student prove they possess verified skills without ever
publishing their name, email, college, exam scores, or CV. Everything personal
stays in the student's wallet as private state; only zero-knowledge proofs and
minimal commitments reach the Midnight ledger.

> **Zero-knowledge by construction.** The on-chain ledger stores pseudonymous
> student ids, commitment hashes, and a verified-skill fact set — never raw
> profile data. See `contracts/verification.compact` for the exact disclosures.

## 🚀 Deployed Contract

**Contract Address:** `30ea2b5c2370261aab6b100d13c0065f652660267e76da958fc5f47fe0dcd6`
**Network:** Midnight Preview  
**Deployment Status:** ✅ Successfully Deployed

---

## Table of contents

- [Highlights](#highlights)
- [Repository layout](#repository-layout)
- [How the privacy model works](#how-the-privacy-model-works)
- [Prerequisites](#prerequisites)
- [Quick start (local devnet)](#quick-start-local-devnet)
- [The CLI](#the-cli)
- [The web frontend](#the-web-frontend)
- [Networks](#networks)
- [Configuration](#configuration)
- [Testing](#testing)
- [State & persistence files](#state--persistence-files)
- [Dependency pins & the onchain-runtime fix](#dependency-pins--the-onchain-runtime-fix)
- [CI/CD Pipeline](#cicd-pipeline)
- [Final checklist](#final-checklist)

---

## Highlights

- **Compact smart contract** (`Verification`) with four stateful circuits:
  `registerStudent`, `addCertificate`, `markVerified`, `proveSkill` (+ the pure
  `studentKey` / `issuerKey` derivation circuits).
- **Pseudonymous identities** — a `studentId` is a domain-separated persistent
  hash of a local secret key (`skillproof:student:` + sk), never tied to a name.
- **Privacy-preserving verification** — the issuer marks a claimed certificate
  as verified; the student then answers an employer's "do you have skill X?"
  query with a ZK proof that discloses only `{ studentId, skill, result: true,
  answeredAt }`.
- **Browser DApp** (Vite + React + Midnight DApp Connector) with a `useSkillProof`
  hook and six panels: wallet, profile, certificates, issuer verify, prove, and a
  live ledger view.
- **Reproducible local devnet** via `compose.yml` (node + indexer + proof-server).
- **12 unit tests** driving the contract through the `@midnight-ntwrk/midnight-js`-based
  simulator, including negative cases (double registration, non-issuer verify,
  unclaimed certs, wrong skills).

---

## Repository layout

```
contracts/verification.compact   The Compact contract (single source of truth)
contracts/managed/verification/  Generated artifacts (ignored; rebuilt by `npm run compile`)
src/                             Backend CLI + Midnight driver
  contract.ts                      Compiled-contract assembly (circuits + witnesses)
  witnesses.ts                     TS mirrors of studentKey / issuerKey / private-state helpers
  wallet.ts                        Wallet SDK wrapper (createWallet, funding, keyring)
  network.ts                       Network configs + .midnight-state.json persistence
  deploy.ts                        `npm run deploy` — deploy contract to the active network
  setup.ts                        `npm run setup` — provision wallet + deploy (all-in-one)
  cli.ts                          The command-line interface
  student-state.ts                 Student identity/profile/certificates (private, local)
  check-balance.ts                 Wallet balance reporter
frontend/                        Vite + React DApp
  src/SkillProofContext.tsx         useSkillProof hook + SkillProofProvider
  src/components/                   WalletPanel, ProfilePanel, CertificatePanel,
                                    VerifyPanel, ProvePanel, LedgerPanel
  .env.example                      VITE_NETWORK_ID / VITE_CONTRACT_ADDRESS / VITE_ISSUER_SECRET_KEY
tests/verification.test.ts       Vitest suite (12 tests) against the compiled contract
compose.yml                      Local devnet: midnight-node + indexer + proof-server
scripts/copy-zk-assets.mjs       Copies generated keys/zkir into frontend/public
```

---

## How the privacy model works

| On-chain (public) | Private (never on-chain) |
| --- | --- |
| `students: studentId → { profileCommitment, active, registeredAt }` | Full profile: name, email, college, examScore, cgpa, skills |
| `claimedCerts: studentId → certId → persistentHash(cert)` | Certificate contents: skill, issuer, issuedAt, nonce |
| `verifiedCerts: studentId → certId → { skill, verifiedAt }` | The commitment `opening` (prevents dictionary attacks) |
| `verificationCount: studentId → count` | The student's local secret key |

Flow:

1. **register** — the student proves they hold a full profile and writes only
   `persistentCommit<Profile>(profile, opening)` to the ledger.
2. **add-cert** — the student claims a certificate; only its `persistentHash` is
   committed on-chain, keyed by `certId`.
3. **verify** — the authorized issuer (whose derived key was sealed at deploy)
   marks the claimed cert as verified for a given skill. This fact is public on
   purpose — it is what employers query.
4. **prove** — the student answers an employer's query with a proof that their
   held profile opens the on-chain commitment, and that a held certificate binds
   to a verified on-chain claim for that skill. The deliberate disclosure is
   exactly `{ studentId, skill, result: true, answeredAt }`.

---

## Prerequisites

- **Node.js ≥ 22** (tested on 22.x)
- **Docker** (for the local devnet only)
- **Midnight toolchain** (`compact` compiler) — only needed to recompile the
  contract (`npm run compile`). Prebuilt artifacts can be regenerated from a
  fresh clone; see [Quick start](#quick-start-local-devnet).

## Quick start (local devnet)

```bash
npm install

# 1. (Optional) Recompile the contract and copy ZK assets into the frontend
npm run compile

# 2. Start the local devnet (node :9944, indexer :8088, proof-server :6300)
npm run proof-server:start
#   ...or: docker compose up -d --wait

# 3. Deploy the contract (funds a wallet from the devnet genesis seed)
npm run deploy
#   → prints the contract address, saved to .midnight-state.json

# 4. Drive it from the CLI
npm run cli -- profile "Aarav Sharma" aarav@example.com "PICT Pune" 92 8.9 "Rust,ZK"
npm run cli -- register
npm run cli -- add-cert cert-001 "Rust" "PICT Pune" 1784764800
npm run cli -- verify <studentIdHex> cert-001 "Rust"
npm run cli -- prove "Rust" cert-001

# 5. Run the web app (dev server on :5173, expects a running devnet or preview)
npm run frontend:dev
```

Everything personal is generated and persisted locally under `student-state.json`;
nothing about the profile ever leaves the device except its commitment.

---

## The CLI

```
npm run cli -- balance                    # wallet tNight / DUST balances
npm run cli -- status                     # network, contract, student id, certs
npm run cli -- profile <name> <email> <college> <examScore> <cgpa> <skills>
npm run cli -- register                   # on-chain: commit profile commitment
npm run cli -- add-cert <certId> <skill> <issuer> <issuedAt>
npm run cli -- verify <studentIdHex> <certId> <skill>   # issuer-only
npm run cli -- prove <querySkill> <certId>              # answer an employer query
```

The issuer identity is derived from the wallet seed that deployed the contract
(see `src/witnesses.ts`); the student identity is the random secret key stored
in `student-state.json`. The CLI re-derives both and connects with the right
private state automatically.

---

## The web frontend

- **Stack:** Vite + React + TypeScript, the Midnight DApp Connector
  (`dapp-connector-api`) for wallet pairing, and `midnight-js-*` providers for
  public data / proof / private state.
- **`useSkillProof` hook** (`SkillProofContext.tsx`) exposes the whole app state:
  `status`, `walletAddress`, `contractAddress`, `ledger`, `myState`, `studentId`,
  plus actions `connect`, `deploy`, `setProfile`, `register`, `addCertificate`,
  `setIssuerSecretKey`, `verify`, `proveSkill`.
- **Panels:** Wallet (connect / balances) · Profile (set profile, register) ·
  Certificates (add a cert, commit it) · Verify (issuer marks verified) ·
  Prove (answer an employer query with a ZK proof) · Ledger (live contract state).
- **Issuer mode:** paste `VITE_ISSUER_SECRET_KEY` (the seed from
  `.midnight-state.json`) or enter it in the Verify panel to unlock issuer-only
  actions in the browser.
- `VITE_CONTRACT_ADDRESS` lets the app auto-join an already-deployed contract
  instead of deploying a fresh one.

Build with `npm run frontend:build` (also runs `tsc --noEmit`); the `dist/`
output is served by any static host. The ZK `keys/` and `zkir/` assets are copied
into the build by `npm run frontend:prepare`.

---

## Networks

| Network | Node | Indexer | Proof server | Faucet |
| --- | --- | --- | --- | --- |
| `undeployed` (default) | `ws://127.0.0.1:9944` (compose) | `http://127.0.0.1:8088/api/v4/graphql` | `http://127.0.0.1:6300` | — (genesis-funded) |
| `preview` | `https://rpc.preview.midnight.network` | `https://indexer.preview.midnight.network/api/v4/graphql` | local `:6300` | `https://midnight-tmnight-preview.nethermind.dev` |
| `preprod` | `https://rpc.preprod.midnight.network` | `https://indexer.preprod.midnight.network/api/v4/graphql` | local `:6300` | `https://midnight-tmnight-preprod.nethermind.dev` |

Select a network with `--network <id>` (e.g. `npm run deploy -- --network preview`)
or `VITE_NETWORK_ID`. `preview` / `preprod` need a funded wallet on that network
(use the faucet) and a locally running proof-server.

---

## Configuration

| File | Purpose |
| --- | --- |
| `.env` (optional, root) | Override `MIDNIGHT_NETWORK`, `MIDNIGHT_NODE_URL`, `MIDNIGHT_INDEXER_URL`, `MIDNIGHT_PROOF_SERVER_URL`, `PRIVATE_STATE_PASSWORD`, `SEED` |
| `frontend/.env` | `VITE_NETWORK_ID`, `VITE_CONTRACT_ADDRESS`, `VITE_ISSUER_SECRET_KEY` (copy from `.env.example`) |

---

## Testing

```bash
npm run typecheck     # tsc --noEmit across src/
npm test              # vitest — 12 tests, simulator-based, no network needed
```

The suite drives the compiled contract through `registerStudent` →
`addCertificate` → `markVerified` → `proveSkill`, asserts the *privacy* property
(no personal data is written to ledger state), and covers the negative paths:
duplicate registration, non-issuer verification, unclaimed certs, mismatched
skills, and unverified certs.

---

## State & persistence files

| File | Contents | VCS |
| --- | --- | --- |
| `.midnight-state.json` | Active network, wallet seeds, deployment records | ignored |
| `student-state.json` | Student secret key, profile, certificates (private) | ignored |
| `midnight-level-db/` | level-js private state store (per-account) | ignored |
| `.midnight-wallet-state/` | Wallet SDK cache | ignored |
| `contracts/managed/` | Generated contract + ZK keys (rebuilt by `npm run compile`) | ignored |

Reset the runtime state with `npm run clean` (keeps `student-state.json`).

---

## Dependency pins & the onchain-runtime fix

Pinned versions (matched to the local devnet images):

- `midnight-js-*` **4.1.1**, `wallet-sdk` **1.2.0**, `compact-runtime` **0.16.0**
- `ledger-v8` **8.1.0**, proof-server **8.1.0**, indexer-standalone **4.3.3**,
  midnight-node **1.0.0**, compact compiler **0.31.1** (runtime **0.16.0**)

> **Known upstream landmine — `onchain-runtime-v3`.** `compact-runtime` resolves
> `^3.0.0` to 3.1.0 while `midnight-js-protocol` pins exactly 3.0.0. That
> installs *two* copies of the package, so its `StateValue` class exists twice
> and every stateful contract call fails with `expected instance of StateValue`.
> This project pins a single shared copy via npm `overrides`:
>
> ```json
> "overrides": { "@midnight-ntwrk/onchain-runtime-v3": "3.0.0" }
> ```
>
> Do not remove it without re-verifying a stateful call (`npm run cli -- register`).

---

## CI/CD Pipeline

This project includes a comprehensive GitHub Actions workflow at `.github/workflows/ci.yml` that runs automatically on every push and pull request to ensure code quality and functionality.

### Automated Pipeline Stages

1. **Verify Test Suite** (Minimum Passing Tests - Mandatory)
   - Installs all dependencies with `npm ci`
   - Verifies managed contract artifacts exist or documents compilation requirement
   - Runs TypeScript compilation check: `npm run typecheck`
   - Executes complete test suite: `npm test`
   - Builds production frontend: `npm run frontend:build`
   - Checks for uncommitted changes

2. **Code Quality Checks**
   - Verifies all required files exist (README.md, PROPOSAL.md, contracts, package.json)
   - Validates README.md contains required sections:
     - Contract Address
     - Deployment Status
     - Privacy model explanation
   - Validates PROPOSAL.md has substantive content:
     - Privacy features
     - Zero-knowledge proofs

3. **Security & Dependency Audit**
   - Runs `npm audit` for vulnerability scanning
   - Checks production dependencies for high-severity issues
   - Reports security findings

### Running CI Locally

To run the same checks that CI runs before pushing:

```bash
# Clean install (like CI does)
npm ci

# TypeScript type checking
npm run typecheck

# Run all tests
npm test

# Build the frontend
npm run frontend:build

# Verify nothing uncommitted
git status
```

### CI/CD Workflow Triggers

- **Push events**: Runs on `main`, `master`, `develop`, and `feature/**` branches
- **Pull requests**: Runs on PRs targeting `main`, `master`, or `develop`
- **Timeout**: 30 minutes maximum per job
- **Node version**: Tests against Node.js 22.x

### Compact Contract Compilation

The CI pipeline checks for pre-compiled contract artifacts in `contracts/managed/verification/`. 

To compile contracts locally (requires Midnight Compact compiler):
```bash
npm run compile
```

This generates:
- Contract artifacts in `contracts/managed/verification/`
- ZK keys and zkir files copied to `frontend/public/`

**Note**: The Compact compiler is part of the Midnight toolchain. Install from [Midnight Documentation](https://docs.midnight.network).

---

## Final checklist

See [CHECKLIST.md](./CHECKLIST.md) for the acceptance checklist and the exact
verification commands used to sign off this build.
