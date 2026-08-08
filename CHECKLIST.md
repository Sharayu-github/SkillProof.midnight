# SkillProof — Final Acceptance Checklist

Sign-off checklist for the SkillProof submission. Each item includes the exact
command used to verify it. All commands run from the repository root.

Legend: ✅ = verified clean · ⬜ = open / not run

---

## 1. Tooling & reproducibility

- [ ] ✅ `node --version` → `v22.x` (engine requirement is `>=22`)
- [ ] ✅ `npm install` completes with the `overrides` in place (single
      `onchain-runtime-v3` 3.0.0 — see README § Dependency pins)
- [ ] ✅ `npm run compile` compiles all 4 circuits and copies `keys/` + `zkir/`
      into `frontend/public/`

## 2. Static checks & unit tests

- [ ] ✅ `npm run typecheck` → `tsc --noEmit` passes with no errors
- [ ] ✅ `npm test` → **12/12** Vitest tests pass (simulator-based, offline)

  ```
   Test Files  1 passed (1)
        Tests  12 passed (12)
  ```

- [ ] ✅ Negative paths covered: duplicate registration, non-issuer verify,
      unclaimed cert, mismatched skill, unverified cert
- [ ] ✅ Privacy assertion: no personal profile/certificate data present in the
      simulated ledger state after the full flow

## 3. Frontend build

- [ ] ✅ `npm run frontend:prepare` copies ZK assets
- [ ] ✅ `npm run frontend:build` → `tsc --noEmit && vite build --mode preview`
      succeeds (`✓ built`)
- [ ] ✅ `dist/` contains `index.html`, JS/CSS bundles, both WASM runtimes
      (`midnight_onchain_runtime_wasm_bg`, `midnight_ledger_wasm_bg`), `keys/` (8), `zkir/` (8)
- [ ] ✅ Known-harmless warnings only: `isomorphic-ws` `WebSocket` import
      (browser global is used at runtime) and `PLUGIN_TIMINGS` perf note

## 4. Local devnet (`compose.yml`)

- [ ] ✅ `npm run proof-server:start` (or `docker compose up -d --wait`) brings up
      node, indexer, proof-server — all **healthy**
- [ ] ✅ Node healthcheck gates the indexer until block 1 exists (see
      `compose.yml` comments)
- [ ] ✅ `docker compose ps` → all three containers `Up (healthy)`
- [ ] ✅ Ports free of conflicts before start (9944 / 8088 / 6300 — the leftover
      `my-app-*` devnet was stopped first)

## 5. On-chain lifecycle (smoke test on devnet)

- [ ] ✅ `npm run deploy` — wallet funded from genesis seed (250 T tNight),
      contract deployed, address saved to `.midnight-state.json`
- [ ] ✅ `npm run cli -- profile "Ishita Patel" ishita@example.com "COEP Pune" 95 9.2 "TypeScript,Zero-Knowledge"`
- [ ] ✅ `npm run cli -- register` → ✅ Registered (commitment only)
- [ ] ✅ `npm run cli -- add-cert cert-002 "TypeScript" "COEP Pune" 1785100000`
      → ✅ Certificate committed (hash on-chain)
- [ ] ✅ `npm run cli -- verify <studentIdHex> cert-002 "TypeScript"` → ✅ Verified
      (issuer-only action)
- [ ] ✅ `npm run cli -- prove "TypeScript" cert-002` → ✅ Proof generated;
      disclosed answer `{ studentId, skill, result: true, answeredAt }`
- [ ] ✅ Every step lands in a block (block heights recorded 274/280/285/293 in
      the acceptance run)
- [ ] ✅ Re-register the same student is rejected ("already registered")
- [ ] ✅ Prove with a mismatched skill is rejected ("failed assert: Verified
      certificate does not match the requested skill")

## 6. Version control & deliverable

- [ ] ✅ `git status` clean (only ignored runtime artifacts present)
- [ ] ✅ README.md and CHECKLIST.md committed
- [ ] ✅ Pushed to `github.com/Sharayu-github/SkillProof.midnight` (`main`)
- [ ] ✅ `overrides` + `.gitignore` committed (onchain-runtime fix, `midnight-level-db/`)

---

- [ ] ✅ Re-register the same student is rejected ("already registered")
- [ ] ✅ Prove with a mismatched skill is rejected ("failed assert: Verified
      certificate does not match the requested skill")

## 6. Version control & deliverable

- [ ] ✅ `git status` clean (only ignored runtime artifacts present)
- [ ] ✅ README.md and CHECKLIST.md committed
- [ ] ✅ Pushed to `github.com/Sharayu-github/SkillProof.midnight` (`main`)
- [ ] ✅ `overrides` + `.gitignore` committed (onchain-runtime fix, `midnight-level-db/`)

---

## Verification transcript (acceptance run)

| Step | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm test` | 12/12 pass |
| `npm run compile` | 4 circuits, zk assets copied |
| `npm run frontend:build` | built in ~4.6s |
| `npm run deploy` | ✅ contract `826f8d5e09f686afa2271e8de14a79a28d33f78e136938264995828d4aa58685` |
| `cli profile + register` | ✅ student `95d68b81…` block 274 |
| `cli add-cert cert-002` | ✅ block 280 |
| `cli verify cert-002` | ✅ block 285 |
| `cli prove "TypeScript"` | ✅ result:true, block 293 |
| `cli prove "Rust"` (wrong skill) | ❌ rejected: "does not match the requested skill" |
