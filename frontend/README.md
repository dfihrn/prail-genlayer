# Prail operator/demo interface

This vanilla JavaScript/Vite interface exposes Prail's execution-control flow to
human operators and hackathon judges. Prail is protocol infrastructure; the
frontend is not the core product. Prail is powered by the deployed MANDATE v3
Intelligent Contract on GenLayer Studionet. The interface supports live finalized
treasury reads, wallet connection, a consensus-bearing diagnostic, and the
verified protected allocation path implemented across Stages A–D.

## Run locally

From the frontend directory:

```powershell
npm install
npm run dev
```

Open the local URL printed by Vite, normally `http://127.0.0.1:5173`.

Production build:

```powershell
npm run build
```

## Live-path prerequisites

- a modern browser;
- MetaMask;
- authorization of the GenLayer Wallet/Snap flow;
- GenLayer Studionet, chain `61999` (`0xF22F`); and
- test GEN when explicitly submitting a write.

Live treasury reads do not require a wallet. Wallet access is requested only after
the user clicks **Connect Wallet**, and every write requires explicit confirmation.
No private key or seed phrase belongs in frontend code or configuration.

## Data and execution boundaries

- `src/config.js` contains canonical public deployment addresses, policy values,
  and recorded proof metadata.
- `src/contract-gateway.js` contains all GenLayer SDK interaction. It validates the
  live MANDATE and TargetTreasury schemas and reads `get_total_funds` and
  `get_allocation` from finalized state.
- The 25% preview is calculated locally from current finalized total and allocation.
  The entered amount is an additional allocation, not a replacement total.
- Clicking **Evaluate** performs only the local deterministic preview. It does not
  submit a transaction or simulate web, LLM, or validator output.
- **Run Live Diagnostic** submits the non-mutating
  `diagnose_protocol_security` call after wallet confirmation. Its transaction ID
  is persisted at `mandate:studionet:security-diagnostic:v1`; reload resumes rather
  than resubmits unfinished work.
- The protected allocation action calls MANDATE's `execute_allocation` only. It
  never exposes `TargetTreasury.record_allocation` as a direct caller path.
- Parent inputs and the transaction ID are persisted at
  `mandate:studionet:protected-allocation:v1`. The frontend discovers the triggered
  treasury child, validates its target, tracks it separately, and rereads finalized
  allocation state before reporting execution.
- Failed schema or state reads remain unavailable. Recorded historical values are
  never substituted as current live state.

The frontend uses `genlayer-js@1.1.8` and Vite `7.1.4`. It uses the stable
`writeContract` path without invented v2 fee-policy fields. Final diagnostic values
are decoded from the successful finalized leader receipt using the public
`abi.calldata.decode` export.

## Verified live browser flow

### Stage A — finalized reads, historical at that time

The wallet-free frontend validated deployed schemas and read `100` total funds and
`15` allocated to Aave. At that time, the deterministic preview allowed `10`
additional units and rejected `11`. These are historical Stage A observations, not
the current canonical allocation.

### Stage B — wallet connection

The real browser flow detected MetaMask, authorized GenLayer Wallet, connected to
Studionet `61999` (`0xF22F`), displayed the connected account, and reconnected
successfully.

### Stage C — diagnostic-only consensus

Transaction
`0x95f36feb6d63e370a274e1082c195bf2aaec678eb2c8f1959c0ad46eaebdac03`
was persisted and tracked from submission through finalization. The frontend
required successful consensus and execution, decoded the successful leader return,
and rendered:

- `current_status_state`: `NO_ACTIVE_INCIDENT`
- `security_context_state`: `NON_CONTRADICTORY_CONTEXT`
- `combined_evidence_state`: `NO_ACTIVE_INCIDENT`
- `decision`: `APPROVE`
- `retrieval_status`: `COMPLETE`
- `sources_checked`: `2`

This was diagnostic only. It did not authorize an allocation or mutate
TargetTreasury. `execute_allocation` independently retrieves and judges fresh
evidence, so the diagnostic result cannot be reused as authorization.

### Stage D — verified protected execution

The frontend submitted an additional `10` through the real browser, MetaMask,
GenLayer Wallet, and Studionet flow. The deterministic boundary passed at
`15 + 10 = 25`; MANDATE reran current evidence and reached `APPROVE`.

- Parent MANDATE transaction:
  `0xe71d375bd4304c203fd52b8f9b21b85cdd1f5c8a2a21a6fe8341c9c36c794a61`
- Finalized TargetTreasury child:
  `0x38dfcc275189a116152b4830668639aee982e398b4d82322563c338a15e79b20`
- Finalized allocation transition: `15 → 25`

The frontend required successful parent consensus/execution, discovered the child
with `getTriggeredTransactionIds`, verified that it targeted the canonical
TargetTreasury, waited for successful child finalization, and confirmed allocation
`25` through a `LATEST_FINAL` read before displaying `TREASURY EXECUTED`.

## Current canonical state

- Total funds: `100`
- Current Aave allocation: `25`
- Maximum allocation under the policy: `25`
- Remaining additional Aave capacity: `0`

Aave is now exactly at the deterministic limit. The earlier `0 → 15` execution,
Stage A values, and Stage C diagnostic remain historical, separate proofs. Do not
submit another positive Aave allocation when demonstrating the current deployment.

For judging, use a small positive proposal such as `1` to demonstrate the local
deterministic short circuit: `25 + 1 > 25`, so evidence, consensus, and wallet
signing are not invoked. The recorded Stage D panel is the canonical successful
execution proof (`15 + 10 = 25`); another live transaction is not required.
