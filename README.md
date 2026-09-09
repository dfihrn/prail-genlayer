# Prail

**Evidence-aware execution control for autonomous protocols.**

Prail is enforcement infrastructure for autonomous protocols, protocol
developers, autonomous treasury systems, and agent-controlled execution systems.
It evaluates protected actions before they are allowed to continue. The frontend
is an operator/demo interface that makes this enforcement path visible to humans;
it is not the core product.

Prail is powered by the deployed MANDATE v3 Intelligent Contract on GenLayer
Studionet. It combines deterministic operating limits with GenLayer consensus over
live external evidence, then enforces approved decisions against protected
contracts through finalized cross-contract execution.

## What Prail is

An autonomous protocol or agent can integrate Prail before executing a protected
action:

`Agent proposes action → Prail evaluates operating rules → allowed action continues`

The current hackathon implementation applies that pattern to treasury allocation.
Prail is not merely advisory: its decision gates access to a protected treasury
state transition.

## The problem

Autonomous systems need enforceable limits, but not every policy is the same kind
of rule. A numeric concentration limit can be evaluated exactly. A security policy
that depends on changing web evidence requires semantic judgment and must remain
safe when evidence is unavailable, contradictory, or insufficient.

Using AI for the numeric rule would add unnecessary nondeterminism. Treating the
security rule as ordinary caller-supplied contract input would make the caller the
source of the evidence used to authorize its own action.

## Why GenLayer

Prail keeps the deterministic and judgment-based parts separate:

- **Deterministic:** “An allocation may not exceed 25% of treasury funds” is
  ordinary contract logic and runs first.
- **Judgment-based:** “Do not allocate to a protocol if there is credible
  unresolved evidence of an active security incident” depends on current external
  evidence and semantic interpretation.

For the judgment-based rule, GenLayer validators independently retrieve the same
controlled sources, evaluate the evidence, normalize it into decision-bearing
states, and reach consensus. Unavailable or unresolved evidence fails closed. AI
and nondeterministic execution are not used for the numeric allocation rule.

## How it works

`Agent proposes allocation`
`→ deterministic cumulative concentration check`
`→ controlled external evidence retrieval`
`→ GenLayer validator judgment`
`→ normalized consensus decision`
`→ authorized cross-contract execution`
`→ finalized TargetTreasury state verification`

Decision semantics:

- `APPROVE` — the protected action may continue.
- `REJECT` — the protected action is blocked.
- `UNDETERMINED` — the protected action is also blocked. This is fail-closed
  behavior for unavailable, contradictory, insufficient, or otherwise unresolved
  evidence.

TargetTreasury does not trust arbitrary callers. It was deployed with the
canonical MANDATE address as its authorized enforcement contract, and its protected
allocation mutation accepts only MANDATE's finalized cross-contract call. A direct
caller cannot bypass the policy path through an unrestricted treasury method.

## Current hackathon implementation

Implemented today:

- a cumulative 25% per-protocol concentration rule;
- one registered demo counterparty: Aave V3 Ethereum Pool;
- two fixed, Aave-specific evidence sources selected by the deployed MANDATE
  contract rather than the caller;
- GenLayer consensus over normalized security-incident states;
- protected cross-contract TargetTreasury mutation;
- a vanilla JavaScript/Vite operator and demo interface;
- repeatable local deterministic tests with mocked nondeterministic inputs; and
- real Studionet evidence, wallet, diagnostic, and protected-execution proof.

This implementation is not a general natural-language policy language, a generic
arbitrary-protocol registry, a full asset-custody treasury, a token-transfer
system, or production-ready infrastructure. Aave is only the current demo
counterparty. A broader design could use protocol-specific evidence configuration,
but that registry functionality is not implemented here.

The configured Aave sources are:

- [Aave Status](https://status.aave.com/) — the authoritative current-status
  source.
- [Aave Security](https://aave.com/security) — corroborating security context that
  may veto approval when it contains current active-incident or contradictory
  evidence.

Both must be successfully retrieved. The status source must provide affirmative
current-state evidence; absence of incident language is not treated as approval.

## Live deployment

- Network: GenLayer Studionet
- Chain ID: `61999`
- MANDATE v3: `0x7A94f7908eafC5476af0f019828C9212dBD32cE6`
- TargetTreasury: `0xc9F2f0874906b06E187F19d6bE38a21368F80E40`
- Aave V3 Ethereum Pool: `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2`

Current finalized treasury state:

- Total funds: `100`
- Current Aave allocation: `25`
- Maximum Aave exposure: `25` (`25%`)
- Remaining Aave capacity: `0`

Aave is exactly at the deterministic concentration limit. Any further positive
Aave allocation should fail before web retrieval or LLM judgment. The canonical
machine-readable record is
[`deployments/studionet.json`](deployments/studionet.json).

## Primary end-to-end proof — Stage D

Stage D proved the complete protected path through the real frontend:

`browser → MetaMask → GenLayer Wallet → Studionet`
`→ MANDATE.execute_allocation`
`→ deterministic concentration check`
`→ fresh Aave evidence retrieval`
`→ GenLayer validator consensus`
`→ APPROVE`
`→ finalized MANDATE parent`
`→ finalized TargetTreasury child`
`→ LATEST_FINAL treasury reread`

- Allocation before: `15`
- Additional allocation: `10`
- Allocation after: `25`
- Total funds: `100`
- Deterministic policy: `15 + 10 ≤ 25` — `PASS`
- `current_status_state`: `NO_ACTIVE_INCIDENT`
- `security_context_state`: `NON_CONTRADICTORY_CONTEXT`
- `combined_evidence_state`: `NO_ACTIVE_INCIDENT`
- `decision`: `APPROVE`
- `retrieval_status`: `COMPLETE`
- `sources_checked`: `2`
- Parent MANDATE transaction:
  `0xe71d375bd4304c203fd52b8f9b21b85cdd1f5c8a2a21a6fe8341c9c36c794a61`
- Finalized TargetTreasury child:
  `0x38dfcc275189a116152b4830668639aee982e398b4d82322563c338a15e79b20`

The frontend required successful parent consensus and execution, discovered the
triggered child, verified that it targeted the canonical TargetTreasury, waited
for successful child finalization, and reread
`TargetTreasury.get_allocation(Aave)` using `LATEST_FINAL`. It displayed
`TREASURY EXECUTED` only after observing the finalized transition from `15` to
`25`.

The earlier Stage C diagnostic result was not reused. `execute_allocation`
performed a fresh evidence assessment for this protected action.

## Additional verification

- **Historical live `0 → 15`:** transaction
  `0xada0299fef334577fbe73e4daab56eb33292c7109c64bcd8a2e1fc624e5545ca`
  completed with accepted consensus, `APPROVE`, retrieval `COMPLETE`, and two
  sources checked. It moved allocation from `0` to `15` and is not the current
  treasury state.
- **Deterministic rejection:** a `40/100` proposal was rejected by the 25% cap
  before web or LLM judgment, with treasury state unchanged.
- **Stage A — historical at that time:** the wallet-free frontend validated live
  schemas and read `100` total / `15` allocated / `10` remaining capacity.
- **Stage B:** the real browser flow detected MetaMask, authorized GenLayer Wallet,
  connected and reconnected to Studionet `61999`, and displayed the connected
  account.
- **Stage C — diagnostic only:** transaction
  `0x95f36feb6d63e370a274e1082c195bf2aaec678eb2c8f1959c0ad46eaebdac03`
  tracked through finalization and returned `NO_ACTIVE_INCIDENT` / `APPROVE`,
  retrieval `COMPLETE`, with two sources checked. It did not authorize execution
  or mutate TargetTreasury; its result cannot be reused for a later allocation.

## Run locally

Prerequisites:

- Python 3.12+
- Node.js 18+
- Docker 26+ only for GenLayer Localnet/Studio

Contract validation:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
genvm-lint check contracts/mandate.py
genvm-lint check contracts/target_treasury.py
pytest tests/direct -v
```

Frontend:

```powershell
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite. Use `npm run build` for a production build.
Live reads work without a wallet; live writes require explicit wallet confirmation.
See [`frontend/README.md`](frontend/README.md) for prerequisites and behavior.

## 2-minute judge walkthrough

1. Read the policy split and end-to-end architecture above.
2. Open the frontend and observe current finalized state: `100` total and `25`
   allocated to Aave.
3. Note that remaining capacity is `0`, so do not submit another positive Aave
   allocation; it is deterministically over the current limit.
4. Review Stage D as the canonical successful protected execution.
5. Inspect the parent and child transaction identifiers and the finalized
   `15 → 25` state transition.
6. Review Stage C separately as live consensus-bearing diagnostic proof that did
   not authorize or execute an allocation.

## Verification boundaries and limitations

- Local direct tests mock web and LLM responses for repeatability; they are not
  live-source evidence.
- The recorded Studionet transactions are the source of real external-evidence,
  consensus, wallet, and cross-contract proof.
- Only Aave V3 Ethereum is registered, using fixed protocol-specific sources.
- External pages can be unavailable, changed, ambiguous, or contradictory;
  MANDATE fails closed to `UNDETERMINED` when appropriate.
- TargetTreasury records allocation units only. It neither custodies nor transfers
  tokens.
- The implementation is not a general policy language or production-ready system.
- Deployment transaction hashes, deployer address, timestamps, source-verification
  links, and compiler/runtime provenance are incomplete where they were not
  recorded; this repository does not invent them.
- The frontend remains pinned to `genlayer-js@1.1.8` and Vite `7.1.4`. The stable
  `writeContract` path and public `abi.calldata.decode` decoder were used; no
  v2/RC fee API was introduced, and hosted `debugTraceTransaction` was not needed.

## Detailed live runbook

See [`LIVE_STUDIO_TEST.md`](LIVE_STUDIO_TEST.md) for the detailed deployment and
reproduction procedure, evidence boundaries, failure modes, and capture checklist.
No deployment credentials are stored in this repository.
