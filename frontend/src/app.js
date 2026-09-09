import { DEMO_CONFIG } from "./config.js";
import { contractGateway } from "./contract-gateway.js";

const amountInput = document.querySelector("#amount");
const evaluateButton = document.querySelector("#evaluate");
const walletButton = document.querySelector("#wallet-control");
const diagnoseButton = document.querySelector("#diagnose");
const executeButton = document.querySelector("#execute-protected");
const executionDialog = document.querySelector("#execution-confirmation");
const confirmExecutionButton = document.querySelector("#confirm-execution");
const quickButtons = [...document.querySelectorAll("[data-amount]")];
const treasuryFields = {
  total: document.querySelector("#treasury-total"),
  allocation: document.querySelector("#treasury-allocation"),
  maximum: document.querySelector("#treasury-maximum"),
  remaining: document.querySelector("#treasury-remaining"),
  inputTotal: document.querySelector("#amount-total"),
  status: document.querySelector("#treasury-read-status"),
};
const executionExplanation = document.querySelector("#execution-explanation");
let liveTreasuryState = null;
let diagnosticBusy = false;
let executionBusy = false;
const stages = Object.fromEntries(
  [...document.querySelectorAll("[data-stage]")].map((stage) => [stage.dataset.stage, stage]),
);

const fields = {
  summary: document.querySelector("#result-summary"),
  title: document.querySelector("#decision-title"),
  chip: document.querySelector("#decision-chip"),
  cap: document.querySelector("#cap-result"),
  current: document.querySelector("#current-state"),
  context: document.querySelector("#context-state"),
  combined: document.querySelector("#combined-state"),
  consensus: document.querySelector("#consensus-state"),
  retrieval: document.querySelector("#retrieval-state"),
  sources: document.querySelector("#sources-state"),
  execution: document.querySelector("#execution-state"),
  transaction: document.querySelector("#diagnostic-transaction"),
  allocationTransactions: document.querySelector("#allocation-transactions"),
  disclosure: document.querySelector("#result-disclosure"),
};
const confirmationFields = {
  current: document.querySelector("#confirm-current"),
  additional: document.querySelector("#confirm-additional"),
  resulting: document.querySelector("#confirm-resulting"),
  maximum: document.querySelector("#confirm-maximum"),
};

const ALLOCATION_TERMINAL_STATES = new Set([
  "TREASURY_EXECUTED",
  "DETERMINISTIC_REJECT",
  "CONSENSUS_REJECT",
  "UNDETERMINED",
  "EXECUTION_ERROR",
  "CANCELED",
]);

function allocationPreview() {
  const raw = amountInput.value.trim();
  if (!liveTreasuryState || !/^(0|[1-9]\d*)$/.test(raw)) return null;
  const amount = BigInt(raw);
  const resulting = liveTreasuryState.currentAllocation + amount;
  const maximum =
    (liveTreasuryState.totalFunds * BigInt(DEMO_CONFIG.policy.maxPercent)) / 100n;
  return { amount, resulting, maximum, allowed: amount > 0n && resulting <= maximum };
}

function updateExecutionAvailability() {
  const preview = allocationPreview();
  const walletConnected = contractGateway.getWalletState().status === "CONNECTED";
  const stored = contractGateway.getStoredProtectedAllocation();
  const pending = stored && !ALLOCATION_TERMINAL_STATES.has(stored.lifecycle);
  executeButton.disabled = executionBusy || !walletConnected || pending || !preview?.allowed;
  executeButton.title = pending
    ? `Resume pending protected allocation ${stored.parentTransactionId}`
    : !walletConnected
      ? "Connect a wallet on Studionet first"
      : !preview?.allowed
        ? "Enter a positive additional amount within the live 25% cap"
        : "Review and confirm a protected MANDATE allocation";

  if (!liveTreasuryState) {
    executionExplanation.textContent = "Waiting for finalized treasury state.";
    executionExplanation.classList.remove("blocked");
    return;
  }
  const maximum =
    (liveTreasuryState.totalFunds * BigInt(DEMO_CONFIG.policy.maxPercent)) / 100n;
  const remaining = maximum > liveTreasuryState.currentAllocation
    ? maximum - liveTreasuryState.currentAllocation
    : 0n;
  if (remaining === 0n) {
    executionExplanation.textContent =
      "Current Aave exposure is already at the 25% mandate limit. Any positive additional allocation is blocked before evidence evaluation.";
    executionExplanation.classList.add("blocked");
  } else if (preview && preview.amount > remaining) {
    executionExplanation.textContent =
      `This proposal exceeds the ${remaining}-unit remaining capacity and is blocked before evidence evaluation.`;
    executionExplanation.classList.add("blocked");
  } else {
    executionExplanation.textContent = `${remaining} additional units remain available under the deterministic cap.`;
    executionExplanation.classList.remove("blocked");
  }
}

function setStage(name, status, state) {
  const stage = stages[name];
  stage.classList.remove("pass", "reject", "skipped");
  if (state) stage.classList.add(state);
  stage.querySelector(".stage-status").textContent = status;
}

function resetStages() {
  setStage("deterministic", "Ready", "");
  setStage("evidence", "Waiting", "");
  setStage("consensus", "Waiting", "");
  setStage("execution", "Waiting", "");
}

function showDeterministicRejection(amount, resultingAllocation, maximum) {
  setStage("deterministic", "Rejected", "reject");
  setStage("evidence", "Not invoked", "skipped");
  setStage("consensus", "Not invoked", "skipped");
  setStage("execution", "Blocked", "skipped");

  fields.title.textContent = "Rejected before AI judgment";
  fields.chip.textContent = "REJECT";
  fields.chip.className = "decision-chip reject";
  fields.cap.textContent = `${resultingAllocation} > ${maximum} · REJECT`;
  fields.current.textContent = "NOT INVOKED";
  fields.context.textContent = "NOT INVOKED";
  fields.combined.textContent = "NOT INVOKED";
  fields.consensus.textContent = "NOT INVOKED";
  fields.retrieval.textContent = "NOT INVOKED";
  fields.sources.textContent = "NOT INVOKED";
  fields.execution.textContent = "BLOCKED";
  fields.summary.textContent = "The deterministic cap blocks this proposal before web retrieval or consensus.";
  fields.disclosure.textContent =
    "This result is calculated locally from the public 25% rule. No network, web, LLM, or validator request was made.";
}

function showEligiblePreview(amount, resultingAllocation, maximum) {
  setStage("deterministic", "Pass", "pass");
  setStage("evidence", "Live call needed", "");
  setStage("consensus", "Live call needed", "");
  setStage("execution", "Not submitted", "");

  fields.title.textContent = "Eligible for evidence judgment";
  fields.chip.textContent = "PENDING LIVE";
  fields.chip.className = "decision-chip neutral";
  fields.cap.textContent = `${resultingAllocation} ≤ ${maximum} · PASS`;
  fields.current.textContent = "NOT REQUESTED";
  fields.context.textContent = "NOT REQUESTED";
  fields.combined.textContent = "NOT REQUESTED";
  fields.consensus.textContent = "LIVE CALL NEEDED";
  fields.retrieval.textContent = "NOT REQUESTED";
  fields.sources.textContent = "NOT REQUESTED";
  fields.execution.textContent = "NOT SUBMITTED";
  fields.summary.textContent = "The deterministic gate passes; a real write transaction is required for the remaining stages.";
  fields.disclosure.textContent =
    "This is a local policy preview only. It does not simulate evidence, validator consensus, or treasury execution.";
}

function showInvalidProposal() {
  setStage("deterministic", "Invalid", "reject");
  setStage("evidence", "Not invoked", "skipped");
  setStage("consensus", "Not invoked", "skipped");
  setStage("execution", "Not executable", "skipped");
  fields.title.textContent = "Invalid allocation amount";
  fields.chip.textContent = "INVALID";
  fields.chip.className = "decision-chip reject";
  fields.cap.textContent = "POSITIVE WHOLE NUMBER REQUIRED";
  fields.current.textContent = "NOT INVOKED";
  fields.context.textContent = "NOT INVOKED";
  fields.combined.textContent = "NOT INVOKED";
  fields.consensus.textContent = "NOT INVOKED";
  fields.retrieval.textContent = "NOT INVOKED";
  fields.sources.textContent = "NOT INVOKED";
  fields.execution.textContent = "NOT EXECUTABLE";
  fields.summary.textContent = "Enter a positive whole-number additional allocation.";
  fields.disclosure.textContent =
    "No evidence, consensus, wallet signature, or treasury execution was requested.";
}

function evaluate() {
  resetStages();
  const rawAmount = amountInput.value.trim();

  if (!liveTreasuryState) {
    amountInput.setCustomValidity("Wait for the finalized treasury state to load.");
    amountInput.reportValidity();
    return;
  }

  if (!/^\d+$/.test(rawAmount)) {
    amountInput.setCustomValidity("Enter a non-negative whole allocation amount.");
    amountInput.reportValidity();
    return;
  }

  amountInput.setCustomValidity("");
  const amount = BigInt(rawAmount);
  if (amount <= 0n) {
    showInvalidProposal();
    updateExecutionAvailability();
    return;
  }
  const resultingAllocation = liveTreasuryState.currentAllocation + amount;
  const allowed =
    resultingAllocation * 100n <=
    liveTreasuryState.totalFunds * BigInt(DEMO_CONFIG.policy.maxPercent);
  const maximum =
    (liveTreasuryState.totalFunds * BigInt(DEMO_CONFIG.policy.maxPercent)) / 100n;

  if (!allowed) {
    showDeterministicRejection(amount, resultingAllocation, maximum);
  } else {
    showEligiblePreview(amount, resultingAllocation, maximum);
  }
  updateExecutionAvailability();
}

quickButtons.forEach((button) => {
  button.addEventListener("click", () => {
    amountInput.value = button.dataset.amount;
    quickButtons.forEach((candidate) => candidate.classList.toggle("active", candidate === button));
    evaluate();
  });
});

amountInput.addEventListener("input", () => {
  quickButtons.forEach((button) => button.classList.toggle("active", button.dataset.amount === amountInput.value));
  updateExecutionAvailability();
});

function updateQuickValueLabels(remaining) {
  quickButtons.forEach((button) => {
    const amount = BigInt(button.dataset.amount);
    button.textContent = `${amount} · ${amount <= remaining ? "within capacity" : "rejection demo"}`;
  });
}

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    await navigator.clipboard?.writeText(button.dataset.copy);
    const label = button.querySelector("span");
    const original = label.textContent;
    label.textContent = "Copied";
    window.setTimeout(() => { label.textContent = original; }, 1100);
  });
});

evaluateButton.addEventListener("click", evaluate);

function shortenAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function renderWalletState(state) {
  const labels = {
    WALLET_NOT_CONNECTED: "Connect Wallet",
    CONNECTING: "Connecting…",
    CONNECTED: state.account ? shortenAddress(state.account) : "Connected",
    WRONG_NETWORK: "Wrong Network",
    WALLET_UNAVAILABLE: "Wallet Unavailable",
    USER_REJECTED: "Connection Rejected",
    CONNECTION_ERROR: "Connection Error",
  };
  walletButton.textContent = labels[state.status] ?? "Connect Wallet";
  walletButton.dataset.walletStatus = state.status;
  walletButton.disabled = state.status === "CONNECTING";
  walletButton.title = state.error ?? (state.chainId ? `Wallet chain ${state.chainId}` : "Connect MetaMask");
  const storedDiagnostic = contractGateway.getStoredDiagnostic();
  const hasPendingDiagnostic =
    storedDiagnostic && storedDiagnostic.lifecycle !== "FINALIZED" && storedDiagnostic.lifecycle !== "CANCELED";
  diagnoseButton.disabled = diagnosticBusy || hasPendingDiagnostic || state.status !== "CONNECTED";
  diagnoseButton.title = hasPendingDiagnostic
    ? `Resume pending diagnostic ${storedDiagnostic.transactionId}`
    : state.status === "CONNECTED"
      ? "Submit a live security diagnostic to Studionet"
      : "Connect a wallet on Studionet to run the diagnostic";
  updateExecutionAvailability();
}

function showDiagnosticTransaction(transactionId) {
  if (!transactionId) return;
  fields.transaction.hidden = false;
  fields.transaction.textContent = `DIAGNOSTIC TRANSACTION · ${transactionId}`;
}

function showDiagnosticLifecycle(update) {
  showDiagnosticTransaction(update.transactionId);
  fields.cap.textContent = "NOT APPLICABLE · DIAGNOSTIC";
  fields.execution.textContent = update.lifecycle;
  fields.disclosure.textContent =
    "LIVE · STUDIONET CONSENSUS. This diagnostic does not authorize or execute an allocation. execute_allocation independently reruns current evidence before any treasury action.";

  const stateCopy = {
    SUBMITTED: ["Diagnostic submitted", "SUBMITTED"],
    PROCESSING: ["Validators are assessing evidence", "PROCESSING"],
    DECIDED: ["Consensus decision reached", "DECIDED"],
    FINALIZING: ["Diagnostic is finalizing", "FINALIZING"],
    PENDING_RESUME: ["Diagnostic remains pending", "RESUMABLE"],
  };
  if (stateCopy[update.lifecycle]) {
    fields.title.textContent = stateCopy[update.lifecycle][0];
    fields.chip.textContent = stateCopy[update.lifecycle][1];
    fields.chip.className = "decision-chip neutral";
    fields.current.textContent = "PENDING";
    fields.context.textContent = "PENDING";
    fields.combined.textContent = "PENDING";
    fields.consensus.textContent = "PENDING";
    fields.retrieval.textContent = "PENDING";
    fields.sources.textContent = "PENDING";
    setStage("evidence", update.lifecycle, "");
    setStage("consensus", update.lifecycle, "");
    setStage("execution", "Not invoked", "skipped");
    return;
  }

  if (update.lifecycle === "CANCELED") {
    showDiagnosticFailure("The diagnostic transaction was canceled.", update.transactionId);
    return;
  }

  if (update.lifecycle === "FINALIZED" && update.result) {
    const result = update.result;
    const isApproval = result.decision === "APPROVE" && result.retrieval_status === "COMPLETE";
    fields.title.textContent = "Live security diagnostic";
    fields.chip.textContent = isApproval ? "APPROVE" : result.decision;
    fields.chip.className = `decision-chip ${isApproval ? "approve" : "reject"}`;
    fields.current.textContent = result.current_status_state;
    fields.context.textContent = result.security_context_state;
    fields.combined.textContent = result.combined_evidence_state;
    fields.consensus.textContent = result.decision;
    fields.retrieval.textContent = result.retrieval_status;
    fields.sources.textContent = String(result.sources_checked);
    fields.execution.textContent = "FINALIZED · DIAGNOSTIC ONLY";
    fields.summary.textContent = "Live Studionet validators returned a normalized security assessment.";
    setStage("evidence", result.retrieval_status, result.retrieval_status === "COMPLETE" ? "pass" : "reject");
    setStage("consensus", result.decision, isApproval ? "pass" : "reject");
    setStage("execution", "Not invoked", "skipped");
  }
}

function showDiagnosticFailure(message, transactionId = null) {
  showDiagnosticTransaction(transactionId);
  fields.title.textContent = "Live diagnostic unavailable";
  fields.chip.textContent = "BLOCKED";
  fields.chip.className = "decision-chip reject";
  fields.current.textContent = "UNAVAILABLE";
  fields.context.textContent = "UNAVAILABLE";
  fields.combined.textContent = "UNDETERMINED";
  fields.consensus.textContent = "NO APPROVAL";
  fields.retrieval.textContent = "FAILED OR INCOMPLETE";
  fields.sources.textContent = "—";
  fields.execution.textContent = "NOT INVOKED";
  fields.summary.textContent = message;
  fields.disclosure.textContent =
    "The diagnostic failed closed. No approval was inferred and no treasury execution was requested.";
  setStage("evidence", "Blocked", "reject");
  setStage("consensus", "No approval", "reject");
  setStage("execution", "Not invoked", "skipped");
}

contractGateway.subscribeWallet(renderWalletState);
walletButton.addEventListener("click", () => contractGateway.connectWallet());

diagnoseButton.addEventListener("click", async () => {
  diagnosticBusy = true;
  renderWalletState(contractGateway.getWalletState());
  try {
    await contractGateway.diagnoseProtocolSecurity(showDiagnosticLifecycle);
  } catch (error) {
    console.error("Live Studionet diagnostic failed", error);
    showDiagnosticFailure(error instanceof Error ? error.message : String(error));
  } finally {
    diagnosticBusy = false;
    renderWalletState(contractGateway.getWalletState());
  }
});

async function resumeStoredDiagnostic() {
  const stored = contractGateway.getStoredDiagnostic();
  if (!stored) return;
  diagnosticBusy = stored.lifecycle !== "FINALIZED" && stored.lifecycle !== "CANCELED";
  renderWalletState(contractGateway.getWalletState());
  try {
    await contractGateway.resumeProtocolSecurityDiagnostic(showDiagnosticLifecycle);
  } catch (error) {
    console.error("Unable to resume the Studionet diagnostic", error);
    showDiagnosticFailure(error instanceof Error ? error.message : String(error), stored.transactionId);
  } finally {
    diagnosticBusy = false;
    renderWalletState(contractGateway.getWalletState());
  }
}

function showAllocationTransactions(update) {
  if (!update.parentTransactionId) return;
  fields.transaction.hidden = true;
  fields.allocationTransactions.hidden = false;
  fields.allocationTransactions.textContent = update.childTransactionId
    ? `PARENT · ${update.parentTransactionId} · CHILD · ${update.childTransactionId}`
    : `PARENT TRANSACTION · ${update.parentTransactionId}`;
}

function showProtectedAllocationLifecycle(update) {
  showAllocationTransactions(update);
  fields.execution.textContent = update.lifecycle;
  fields.cap.textContent = `${update.beforeAllocation ?? "—"} + ${update.requestedAmount ?? "—"} ≤ ${update.expectedAllocation ?? "—"}`;
  fields.disclosure.textContent =
    "LIVE · PROTECTED EXECUTION. MANDATE reruns current evidence for this allocation; no earlier diagnostic result is reused.";

  const pendingStates = new Set([
    "SUBMITTED",
    "PROCESSING",
    "DECIDED",
    "FINALIZING",
    "PARENT_FINALIZED",
    "CHILD_PROCESSING",
    "CHILD_FINALIZING",
    "AWAITING_FINALIZED_STATE",
    "PENDING_RESUME",
  ]);
  if (pendingStates.has(update.lifecycle)) {
    const titles = {
      SUBMITTED: "Protected allocation submitted",
      PROCESSING: "MANDATE is evaluating the allocation",
      DECIDED: "Parent consensus decision reached",
      FINALIZING: "Parent transaction is finalizing",
      PARENT_FINALIZED: "Parent finalized · locating treasury child",
      CHILD_PROCESSING: "Treasury child is processing",
      CHILD_FINALIZING: "Treasury child is finalizing",
      AWAITING_FINALIZED_STATE: "Awaiting finalized treasury state",
      PENDING_RESUME: "Protected allocation remains resumable",
    };
    fields.title.textContent = titles[update.lifecycle];
    fields.chip.textContent = update.lifecycle === "PENDING_RESUME" ? "RESUMABLE" : update.lifecycle;
    fields.chip.className = "decision-chip neutral";
    fields.current.textContent = update.evidence?.current_status_state ?? "PENDING";
    fields.context.textContent = update.evidence?.security_context_state ?? "PENDING";
    fields.combined.textContent = update.evidence?.combined_evidence_state ?? "PENDING";
    fields.consensus.textContent = update.evidence?.decision ?? "PENDING";
    fields.retrieval.textContent = update.evidence?.retrieval_status ?? "PENDING";
    fields.sources.textContent = update.evidence?.sources_checked ?? "PENDING";
    setStage("deterministic", "Pass", "pass");
    setStage("evidence", update.evidence?.retrieval_status ?? "Processing", update.evidence ? "pass" : "");
    setStage("consensus", update.evidence?.decision ?? "Processing", update.evidence?.decision === "APPROVE" ? "pass" : "");
    setStage("execution", update.lifecycle, "");
    return;
  }

  if (update.lifecycle === "TREASURY_EXECUTED") {
    fields.title.textContent = "Protected allocation executed";
    fields.chip.textContent = "TREASURY EXECUTED";
    fields.chip.className = "decision-chip approve";
    fields.execution.textContent = `FINALIZED · ${update.finalAllocation}`;
    fields.summary.textContent = `Finalized Aave allocation is now ${update.finalAllocation}.`;
    setStage("deterministic", "Pass", "pass");
    setStage("evidence", "Complete", "pass");
    setStage("consensus", "Approve", "pass");
    setStage("execution", "Finalized", "pass");
    if (liveTreasuryState) {
      liveTreasuryState = Object.freeze({
        ...liveTreasuryState,
        currentAllocation: BigInt(update.finalAllocation),
      });
      treasuryFields.allocation.textContent = update.finalAllocation;
    }
    return;
  }

  const labels = {
    DETERMINISTIC_REJECT: "DETERMINISTIC REJECT",
    CONSENSUS_REJECT: "CONSENSUS REJECT",
    UNDETERMINED: "UNDETERMINED",
    EXECUTION_ERROR: "EXECUTION ERROR",
    CANCELED: "CANCELED",
  };
  fields.title.textContent = "Protected allocation blocked";
  fields.chip.textContent = labels[update.lifecycle] ?? "BLOCKED";
  fields.chip.className = "decision-chip reject";
  fields.execution.textContent = "NOT EXECUTED";
  fields.summary.textContent = update.error ?? "The protected allocation did not execute.";
  fields.disclosure.textContent =
    "The protected path failed closed. No finalized treasury mutation is reported.";
  setStage("execution", "Blocked", "reject");
  if (update.lifecycle === "DETERMINISTIC_REJECT") {
    setStage("deterministic", "Rejected", "reject");
    setStage("evidence", "Not invoked", "skipped");
    setStage("consensus", "Not invoked", "skipped");
  } else {
    setStage("consensus", labels[update.lifecycle] ?? "Rejected", "reject");
  }
}

executeButton.addEventListener("click", () => {
  const preview = (() => {
    const candidate = amountInput.value.trim();
    if (!/^\d+$/.test(candidate) || candidate === "0") return null;
    return liveTreasuryState ? {
      amount: BigInt(candidate),
      current: liveTreasuryState.currentAllocation,
      resulting: liveTreasuryState.currentAllocation + BigInt(candidate),
      maximum: (liveTreasuryState.totalFunds * BigInt(DEMO_CONFIG.policy.maxPercent)) / 100n,
    } : null;
  })();
  if (!preview || preview.resulting > preview.maximum || contractGateway.getWalletState().status !== "CONNECTED") {
    updateExecutionAvailability();
    return;
  }
  confirmationFields.current.textContent = String(preview.current);
  confirmationFields.additional.textContent = String(preview.amount);
  confirmationFields.resulting.textContent = String(preview.resulting);
  confirmationFields.maximum.textContent = String(preview.maximum);
  executionConfirmationAmount = preview.amount;
  executionConfirmationCurrent = preview.current;
  executionDialog.showModal();
});

let executionConfirmationAmount = null;
let executionConfirmationCurrent = null;

confirmExecutionButton.addEventListener("click", async (event) => {
  event.preventDefault();
  const amount = executionConfirmationAmount;
  const confirmedCurrent = executionConfirmationCurrent;
  executionDialog.close();
  executionConfirmationAmount = null;
  executionConfirmationCurrent = null;
  if (typeof amount !== "bigint" || typeof confirmedCurrent !== "bigint") return;

  executionBusy = true;
  renderWalletState(contractGateway.getWalletState());
  try {
    await contractGateway.executeProtectedAllocation(amount, confirmedCurrent, showProtectedAllocationLifecycle);
  } catch (error) {
    console.error("Protected Studionet allocation failed", error);
    showProtectedAllocationLifecycle({
      lifecycle: "EXECUTION_ERROR",
      requestedAmount: amount.toString(),
      beforeAllocation: liveTreasuryState?.currentAllocation.toString(),
      expectedAllocation: liveTreasuryState
        ? (liveTreasuryState.currentAllocation + amount).toString()
        : null,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    executionBusy = false;
    renderWalletState(contractGateway.getWalletState());
  }
});

async function resumeStoredProtectedAllocation() {
  const stored = contractGateway.getStoredProtectedAllocation();
  if (!stored) return;
  const terminal = new Set([
    "TREASURY_EXECUTED",
    "DETERMINISTIC_REJECT",
    "CONSENSUS_REJECT",
    "UNDETERMINED",
    "EXECUTION_ERROR",
    "CANCELED",
  ]);
  executionBusy = !terminal.has(stored.lifecycle);
  renderWalletState(contractGateway.getWalletState());
  try {
    await contractGateway.resumeProtectedAllocation(showProtectedAllocationLifecycle);
  } catch (error) {
    console.error("Unable to resume protected allocation", error);
    showProtectedAllocationLifecycle({
      ...stored,
      lifecycle: "PENDING_RESUME",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    executionBusy = false;
    renderWalletState(contractGateway.getWalletState());
  }
}

async function loadLiveTreasuryState() {
  try {
    liveTreasuryState = await contractGateway.readTreasuryState();
    const maximum =
      (liveTreasuryState.totalFunds * BigInt(DEMO_CONFIG.policy.maxPercent)) / 100n;
    treasuryFields.total.textContent = String(liveTreasuryState.totalFunds);
    treasuryFields.allocation.textContent = String(liveTreasuryState.currentAllocation);
    treasuryFields.maximum.textContent = `${maximum} units`;
    const remaining = maximum > liveTreasuryState.currentAllocation
      ? maximum - liveTreasuryState.currentAllocation
      : 0n;
    treasuryFields.remaining.textContent = `${remaining} units`;
    treasuryFields.inputTotal.textContent = `OF ${liveTreasuryState.totalFunds}`;
    treasuryFields.status.textContent = "LIVE · FINALIZED";
    updateQuickValueLabels(remaining);
    fields.summary.textContent = remaining === 0n
      ? "Aave is at the 25% limit. Evaluate a positive amount to demonstrate deterministic rejection."
      : `${remaining} additional units remain under the deterministic cap.`;
    evaluateButton.disabled = false;
    updateExecutionAvailability();
  } catch (error) {
    console.error("Unable to load finalized Studionet treasury state", error);
    treasuryFields.status.textContent = "LIVE READ ERROR";
    treasuryFields.remaining.textContent = "— units";
    fields.summary.textContent = "Finalized Studionet treasury state is unavailable.";
    fields.disclosure.textContent =
      "The interface will not substitute recorded values for a failed live schema or state read.";
  }
}

evaluateButton.disabled = true;
loadLiveTreasuryState();
resumeStoredDiagnostic();
resumeStoredProtectedAllocation();
