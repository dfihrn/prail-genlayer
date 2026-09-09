# Prail live Studionet record and reproduction runbook

This document records Prail's successful live proof using the deployed MANDATE v3
Intelligent Contract and retains the manual steps needed to reproduce it. It does
not contain private keys.

## Canonical proof at a glance

- Current finalized state: `100` total / `25` allocated / `25` maximum / `0`
  remaining Aave capacity.
- Primary end-to-end proof: [Stage D frontend protected execution](#stage-d-frontend-protected-execution-proof),
  with parent `0xe71d375bd4304c203fd52b8f9b21b85cdd1f5c8a2a21a6fe8341c9c36c794a61`
  and child `0x38dfcc275189a116152b4830668639aee982e398b4d82322563c338a15e79b20`.
- Historical proofs: the original `0 → 15` protected execution, deterministic
  `40/100` rejection, and browser Stages A–C.
- Verification boundaries and limitations are documented below; missing
  provenance metadata is not inferred.

## Canonical deployment and historical initial proof

- Network: GenLayer Studionet
- Chain ID: `61999`
- MANDATE v3: `0x7A94f7908eafC5476af0f019828C9212dBD32cE6`
- TargetTreasury: `0xc9F2f0874906b06E187F19d6bE38a21368F80E40`
- Registered protocol: Aave V3 Ethereum Pool,
  `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2`
- Treasury total: `100`

The protected `15/100` allocation completed successfully in transaction
`0xada0299fef334577fbe73e4daab56eb33292c7109c64bcd8a2e1fc624e5545ca`.
Live evidence retrieval was `COMPLETE` with two sources checked. The normalized
current and combined states were both `NO_ACTIVE_INCIDENT`, the decision was
`APPROVE`, validator consensus accepted the result, and the transaction finalized
successfully. Treasury allocation changed from `0` to `15`.

The deterministic `40/100` case was rejected by the 25% cap before web or LLM
judgment, and treasury allocation remained unchanged. The structured canonical
record is in `deployments/studionet.json`.

No deployment transaction hashes, deployer address, timestamps, separate
historical assessment transaction, or triggered treasury transaction hash are recorded
because they were not supplied as canonical metadata.

## Historical and additional browser proof: Stages A-C

These observations are distinct from both local mocked tests and the historical
protected execution above.

- **Stage A — live reads, historical at that time:** the wallet-free frontend validated the deployed
  schemas and read finalized TargetTreasury state: `100` total funds and `15`
  allocated to Aave. The deterministic preview therefore permits `10`
  additional units and rejects `11`.
- **Stage B — wallet connection:** the real browser flow detected MetaMask,
  installed/authorized GenLayer Wallet, connected to Studionet chain `61999`
  (`0xF22F`), displayed the connected account, and reconnected successfully. No
  wallet secret or unnecessary account information is recorded here.
- **Stage C — consensus diagnostic:** the user manually initiated
  `Mandate.diagnose_protocol_security(AAVE_ADDRESS)` through browser → MetaMask
  → GenLayer Wallet → stable Studionet. The diagnostic transaction was
  `0x95f36feb6d63e370a274e1082c195bf2aaec678eb2c8f1959c0ad46eaebdac03`.

The frontend persisted that transaction ID and observed:

`SUBMITTED → PROCESSING → DECIDED → FINALIZING → FINALIZED`

It required successful consensus/execution, selected the successful leader
receipt returned by `getTransaction({ hash })`, and decoded
`result.payload.raw` by converting it to `Uint8Array` and calling the public
`abi.calldata.decode` export. The rendered result was:

- `current_status_state`: `NO_ACTIVE_INCIDENT`
- `security_context_state`: `NON_CONTRADICTORY_CONTEXT`
- `combined_evidence_state`: `NO_ACTIVE_INCIDENT`
- `decision`: `APPROVE`
- `retrieval_status`: `COMPLETE`
- `sources_checked`: `2`

The configured sources independently retrieved during consensus were
[Aave Status](https://status.aave.com/) and
[Aave Security](https://aave.com/security).

Stage C was diagnostic only. It was consensus-bearing but did not authorize an
allocation or mutate TargetTreasury. `execute_allocation` performs a fresh
evidence assessment for every protected action, so this `APPROVE` is not reusable
authorization. Treasury state remained `100` total / `15` allocated, with a
maximum total exposure of `25` and `10` units of additional capacity.

The frontend remains pinned to `genlayer-js@1.1.8`. The newer v2 fee-policy APIs
are unavailable in that installed version, so no RC/v2 SDK or guessed fee
distribution was introduced. Stage C used the stable 1.1.8 `writeContract`
implementation and public calldata decoder. Hosted Studionet
`debugTraceTransaction` was not part of the successful path and was not needed.

## Stage D frontend protected-execution proof

Stage D completed the full protected path through the real browser, MetaMask,
GenLayer Wallet, stable Studionet, MANDATE consensus, and the finalized
cross-contract treasury child.

- Allocation before: `15`
- Additional requested: `10`
- Resulting and maximum allocation: `25`
- Deterministic result: `15 + 10 ≤ 25` — `PASS`
- Parent `execute_allocation` transaction:
  `0xe71d375bd4304c203fd52b8f9b21b85cdd1f5c8a2a21a6fe8341c9c36c794a61`
- Finalized TargetTreasury child transaction:
  `0x38dfcc275189a116152b4830668639aee982e398b4d82322563c338a15e79b20`

`execute_allocation` itself reran current Aave evidence. It observed
`NO_ACTIVE_INCIDENT` current and combined state,
`NON_CONTRADICTORY_CONTEXT`, decision `APPROVE`, retrieval `COMPLETE`, and two
sources checked: [Aave Status](https://status.aave.com/) and
[Aave Security](https://aave.com/security). The earlier Stage C diagnostic was
not reused as authorization.

The frontend tracked the parent, required successful parent consensus and
execution, discovered the triggered child, verified its target was the canonical
TargetTreasury, tracked it through successful finalization, and finally reread
`TargetTreasury.get_allocation(AAVE_ADDRESS)` using `LATEST_FINAL`. Only after
that read changed from `15` to `25` did the frontend display
`TREASURY EXECUTED`.

### Current canonical treasury state

- Total funds: `100`
- Current Aave allocation: `25`
- Maximum exposure: `25%` / `25` units
- Remaining additional Aave capacity: `0`

The original `0 → 15` live execution and Stage A/C observations at allocation
`15` remain historical proofs. Following Stage D, Aave is exactly at the 25%
concentration limit; any further positive Aave allocation should deterministically
fail before evidence evaluation. No additional transaction is needed to support
that consequence because the cap is covered by the deterministic tests.

## Network and demo constants

- Network: `studionet`
- RPC: `https://studio.genlayer.com/api`
- Chain ID: `61999`
- Native test token: `GEN`
- Aave identifier: `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2`
- Recommended demo treasury total: `100` bookkeeping units

The treasury total is contract bookkeeping, not a deposit of 100 GEN. This
milestone implements no token transfer.

## Deployment order and authorization

There is no actual deployment cycle. Deploy `Mandate` first: it takes no
constructor arguments and stores no treasury address. Then deploy
`TargetTreasury` with the finalized MANDATE address as `mandate_address` and
`100` as `total_funds`. Calls to MANDATE receive the target treasury address at
execution time.

`TargetTreasury.record_allocation` accepts calls only from its constructor-set
MANDATE address, which has no setter. If the wrong address is supplied, redeploy
the treasury; do not add an unrestricted update method.

## Reproducing through hosted Studio

The hosted Studio is the simplest supported route for this workspace because
the GenLayer CLI is not currently installed locally.

1. Open [GenLayer Studio](https://studio.genlayer.com).
2. Select or create an account. Use the faucet droplet in the account selector
   to obtain test GEN.
3. Confirm that the network is Studionet, not a temporary development network.
4. Load `contracts/mandate.py`, deploy with no constructor arguments, and wait
   for finalization. Record its address and deployment transaction hash.
5. Load `contracts/target_treasury.py` and deploy with the finalized MANDATE
   address as `mandate_address` and `100` as `total_funds`.
6. Wait for finalization and record the treasury address and transaction hash.
7. Copy `deployments/studionet.example.json` to a personal record for a separate
   deployment. Never overwrite the canonical record or put a private key in it.

Studio detects constructor fields. Prefer its individual form fields. If the UI
offers a JSON constructor input, follow the displayed ABI order: MANDATE address
first, then `100`.

## Optional CLI equivalent

After separately installing/configuring the current GenLayer CLI, the equivalent
PowerShell flow is:

```powershell
genlayer network set studionet
genlayer network info
genlayer account show
genlayer deploy --contract contracts/mandate.py

$MandateAddress = "0x_REPLACE_WITH_FINALIZED_MANDATE_ADDRESS"
genlayer deploy --contract contracts/target_treasury.py --args $MandateAddress 100
```

The deploy command prints a transaction hash and contract address. Do not deploy
the treasury until MANDATE is finalized. Account creation, unlocking, and funding
remain manual because they are interactive and credential-bearing.

## Live reproduction sequence

Use the Aave identifier above exactly. Read treasury allocation before and after
every write.

### 1. Baseline reads

- `Mandate.health()` -> `MANDATE_READY`
- `TargetTreasury.get_total_funds()` -> `100`
- `TargetTreasury.get_allocation(AAVE_ADDRESS)` -> `0` when freshly deployed

### 2. Deterministic short circuit

Call `Mandate.execute_allocation(TREASURY_ADDRESS, AAVE_ADDRESS, 40)`.

Observed canonical result: deterministic allocation-policy failure, no web/LLM
judgment, and unchanged treasury state. This proves `40 / 100` exceeds the 25%
cap before nondeterministic work.

### 3. Live web retrieval and consensus

Call `Mandate.assess_protocol_security(AAVE_ADDRESS)` as a write and wait for
finalization. Validators retrieve the two fixed Aave sources independently; the
caller supplies neither evidence nor URLs.

Capture `current_status_state`, `security_context_state`,
`combined_evidence_state`, `decision`, `retrieval_status`, and
`sources_checked`. The canonical run observed `NO_ACTIVE_INCIDENT` for current
and combined state, `APPROVE`, `COMPLETE`, two sources, and accepted validator
consensus. A reproduction can still safely produce `UNDETERMINED` if sources or
their content differ. Consensus is on normalized fields, not identical webpage
text or model prose.

### 4. Protected allocation

Read allocation, then call
`Mandate.execute_allocation(TREASURY_ADDRESS, AAVE_ADDRESS, 15)`.

- On fresh `APPROVE`, wait for both the finalized MANDATE transaction and its
  triggered treasury transaction; allocation should become `15`.
- On fresh `REJECT` or `UNDETERMINED`, execution rejects and allocation remains
  unchanged.

Step 3 is observational only. Protected execution performs a fresh retrieval
and judgment rather than reusing an earlier result.

The canonical protected execution followed the APPROVE branch and changed the
Aave allocation from `0` to `15` after finalization.

### 5. Direct bypass

From the Studio account, directly call
`TargetTreasury.record_allocation(AAVE_ADDRESS, 15)`.

Expected: `Only MANDATE may record allocations`, with no state change.

## Demo capture checklist

For each write, save or screenshot:

- network, account, contract addresses, transaction hash, and timestamp;
- lifecycle/final status and execution result;
- leader result, validator votes, consensus outcome, rotations, and Equivalence
  Principle output;
- structured security decision and retrieval fields;
- source success/failure metadata and bounded evidence summary;
- treasury allocation immediately before and after all triggered transactions;
- parent MANDATE and triggered treasury transaction identifiers;
- failure reason for over-cap and direct-bypass cases.

## Funds and manual work

Deployments and writes can require test GEN under current protocol-fee rules.
Use Studio's faucet droplet for the selected Studionet account and top up until
the displayed fee estimate is covered. The `total_funds=100` value is not GEN.

You must manually select/fund the account, deploy both contracts, substitute the
finalized addresses, wait for consensus and triggered transactions, and save the
transaction evidence.

## Evidence boundaries and current limitations

- Local direct tests use mocked web and LLM responses. They prove deterministic
  composition and enforcement repeatably but are not live-source evidence.
- The canonical deployment above is a real Studionet observation with successful
  retrieval and accepted validator consensus.
- Only Aave V3 Ethereum is configured.
- Source availability, source changes, or ambiguous current status remain
  fail-closed as `UNDETERMINED`.
- TargetTreasury records allocation units only; it does not custody or transfer
  tokens.
- The current implementation is not a general policy language, generic protocol
  registry, or production-ready system. Aave is the sole demo counterparty; a
  broader protocol-specific registry remains future work.
- Deployment transaction hashes, deployer identity, timestamps, source-verification
  links, and compiler/runtime provenance remain incomplete where they were not
  supplied as canonical metadata.
- The supplied record includes the historical `0 → 15` transaction and the Stage
  D parent and triggered-child transaction hashes. Deployment transaction hashes
  and the triggered child for the historical execution remain unrecorded rather
  than inferred.

## Likely failure modes

- Blocked, changed, timed-out, malformed, contradictory, or insufficient source
  data safely yields `UNDETERMINED`.
- Different validator observations may cause rotations, failed consensus, or
  `UNDETERMINED`; inspect validator details.
- Insufficient GEN requires funding the same selected account from the faucet.
- A wrong MANDATE address requires treasury redeployment.
- Treasury state may look unchanged until the triggered transaction finalizes.
- Resubmitting while pending may create a second allocation if both succeed;
  wait for finality before retrying.
- A runtime upgrade or network reset may invalidate a temporary deployment;
  record the network, chain ID, addresses, and hashes together.

## Official references

- [CLI deployment](https://docs.genlayer.com/developers/intelligent-contracts/deploying/cli-deployment)
- [Network configuration](https://docs.genlayer.com/developers/intelligent-contracts/deploying/network-configuration)
- [Studio deployment](https://docs.genlayer.com/developers/intelligent-contracts/tools/genlayer-studio/deploying-contract)
- [Studio development tips](https://docs.genlayer.com/developers/intelligent-contracts/tools/genlayer-studio/development-tips)
- [Networks and Studionet faucet](https://docs.genlayer.com/developers/networks)
- [Cross-contract interaction](https://docs.genlayer.com/developers/intelligent-contracts/features/interacting-with-intelligent-contracts)
