import { NEXT_CONFIG } from "./next-config.js";
import { nextGateway } from "./next-gateway.js";

const ui = Object.freeze({
  wallet: document.querySelector("#wallet-control"),
  amount: document.querySelector("#amount"),
  amountTotal: document.querySelector("#amount-total"),
  evaluate: document.querySelector("#evaluate"),
  execute: document.querySelector("#execute-protected"),
  explanation: document.querySelector("#execution-explanation"),
  summary: document.querySelector("#result-summary"),
  total: document.querySelector("#treasury-total"),
  allocation: document.querySelector("#treasury-allocation"),
  maximum: document.querySelector("#treasury-maximum"),
  remaining: document.querySelector("#treasury-remaining"),
  readStatus: document.querySelector("#treasury-read-status"),
  capResult: document.querySelector("#cap-result"),
  currentState: document.querySelector("#current-state"),
  contextState: document.querySelector("#context-state"),
  combinedState: document.querySelector("#combined-state"),
  consensusState: document.querySelector("#consensus-state"),
  retrievalState: document.querySelector("#retrieval-state"),
  sourcesState: document.querySelector("#sources-state"),
  executionState: document.querySelector("#execution-state"),
  transaction: document.querySelector("#allocation-transactions"),
  confirmation: document.querySelector("#execution-confirmation"),
  confirmExecution: document.querySelector("#confirm-execution"),
  confirmCurrent: document.querySelector("#confirm-current"),
  confirmAdditional: document.querySelector("#confirm-additional"),
  confirmResulting: document.querySelector("#confirm-resulting"),
  confirmMaximum: document.querySelector("#confirm-maximum"),
});

let state = null;
let preview = null;

function shortAddress(value) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "Connect Wallet";
}

function maxAllocation() {
  return state ? (state.totalFunds * BigInt(NEXT_CONFIG.policy.maxPercent)) / 100n : 0n;
}

function renderWallet(wallet) {
  const labels = {
    WALLET_NOT_CONNECTED: "Connect Wallet",
    WALLET_UNAVAILABLE: "Wallet unavailable",
    CONNECTING: "Connecting…",
    WRONG_NETWORK: "Switch to Studio Next",
    CONNECTION_ERROR: "Retry Wallet",
  };
  ui.wallet.textContent = wallet.status === "CONNECTED" ? shortAddress(wallet.account) : (labels[wallet.status] ?? "Connect Wallet");
  ui.wallet.title = wallet.error ?? "";
  renderExecutionAvailability();
}

function renderState() {
  const maximum = maxAllocation();
  const remaining = maximum > state.currentAllocation ? maximum - state.currentAllocation : 0n;
  ui.total.textContent = state.totalFunds.toString();
  ui.allocation.textContent = state.currentAllocation.toString();
  ui.maximum.textContent = `${maximum} units`;
  ui.remaining.textContent = `${remaining} units`;
  ui.amountTotal.textContent = `OF ${state.totalFunds}`;
  ui.readStatus.textContent = "LIVE · LATEST_FINAL";
  ui.readStatus.classList.add("recorded");
  evaluateLocally();
}

function renderExecutionAvailability() {
  const connected = nextGateway.getWalletState().status === "CONNECTED";
  ui.execute.disabled = !preview?.allowed || !connected;
  if (!state) ui.explanation.textContent = "Waiting for finalized Studio Next state.";
  else if (!preview?.allowed) ui.explanation.textContent = "A passing deterministic preview is required before live execution.";
  else if (!connected) ui.explanation.textContent = "Connect MetaMask and GenLayer Wallet on Studio Next to execute.";
  else ui.explanation.textContent = "Ready to estimate fees and request one wallet-confirmed Studio Next transaction.";
}

function evaluateLocally() {
  if (!state) return;
  const raw = ui.amount.value.trim();
  const amount = /^\d+$/.test(raw) ? BigInt(raw) : -1n;
  const maximum = maxAllocation();
  const resulting = amount >= 0n ? state.currentAllocation + amount : state.currentAllocation;
  const allowed = amount > 0n && resulting <= maximum;
  preview = Object.freeze({ amount, resulting, maximum, allowed });
  ui.capResult.textContent = amount <= 0n ? "INVALID" : allowed ? "PASS" : "REJECT";
  ui.summary.textContent = amount <= 0n
    ? "Enter a positive whole-unit allocation."
    : allowed
      ? `${state.currentAllocation} + ${amount} = ${resulting} ≤ ${maximum}. Evidence consensus is required.`
      : `${state.currentAllocation} + ${amount} = ${resulting} > ${maximum}. Deterministic rejection.`;
  renderExecutionAvailability();
}

function renderLifecycle(update) {
  const lifecycle = update.lifecycle ?? "PROCESSING";
  ui.executionState.textContent = lifecycle.replaceAll("_", " ");
  if (update.transactionId) {
    ui.transaction.hidden = false;
    ui.transaction.replaceChildren(document.createTextNode("STUDIO NEXT TRANSACTION · "));
    const link = document.createElement("a");
    link.href = `${NEXT_CONFIG.network.explorerUrl}/transactions/${update.transactionId}`;
    link.target = "_blank";
    link.rel = "noreferrer";
    const code = document.createElement("code");
    code.textContent = update.transactionId;
    link.append(code);
    ui.transaction.append(link);
  }
  const evidence = update.evidence;
  if (evidence) {
    ui.currentState.textContent = evidence.current_status_state ?? "—";
    ui.contextState.textContent = evidence.security_context_state ?? "—";
    ui.combinedState.textContent = evidence.combined_evidence_state ?? "—";
    ui.consensusState.textContent = evidence.decision ?? "—";
    ui.retrievalState.textContent = evidence.retrieval_status ?? "—";
    ui.sourcesState.textContent = evidence.sources_checked ?? "—";
  }
  if (lifecycle === "ALLOCATION_FINALIZED") {
    ui.explanation.textContent = `Finalized Studio Next allocation: ${update.finalAllocation}.`;
    loadState();
  } else if (["CANCELED", "EXECUTION_REJECTED"].includes(lifecycle)) {
    ui.explanation.textContent = "The Studio Next transaction did not produce an approved allocation.";
  } else if (lifecycle === "PENDING_RESUME") {
    ui.explanation.textContent = "Tracking paused; reload this page to resume the saved transaction.";
  } else {
    ui.explanation.textContent = `Studio Next transaction: ${lifecycle.replaceAll("_", " ")}.`;
  }
  ui.execute.disabled = true;
}

async function loadState() {
  ui.readStatus.textContent = "LOADING LIVE";
  try {
    state = await nextGateway.readState();
    renderState();
  } catch (error) {
    ui.readStatus.textContent = "LIVE READ FAILED";
    ui.explanation.textContent = error instanceof Error ? error.message : String(error);
  }
}

ui.wallet.addEventListener("click", async () => renderWallet(await nextGateway.connectWallet()));
ui.evaluate.addEventListener("click", evaluateLocally);
ui.amount.addEventListener("input", evaluateLocally);
ui.execute.addEventListener("click", () => {
  if (!preview?.allowed || !state) return;
  ui.confirmCurrent.textContent = state.currentAllocation.toString();
  ui.confirmAdditional.textContent = preview.amount.toString();
  ui.confirmResulting.textContent = preview.resulting.toString();
  ui.confirmMaximum.textContent = preview.maximum.toString();
  ui.confirmation.showModal();
});
ui.confirmExecution.addEventListener("click", async (event) => {
  event.preventDefault();
  ui.confirmation.close();
  try {
    await nextGateway.executeAllocation(preview.amount, state.currentAllocation, renderLifecycle);
  } catch (error) {
    ui.executionState.textContent = "ERROR";
    ui.explanation.textContent = error instanceof Error ? error.message : String(error);
    renderExecutionAvailability();
  }
});

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(button.dataset.copy);
    const previous = button.querySelector("span").textContent;
    button.querySelector("span").textContent = "COPIED";
    window.setTimeout(() => { button.querySelector("span").textContent = previous; }, 1_200);
  });
});

nextGateway.subscribeWallet(renderWallet);
renderWallet(nextGateway.getWalletState());
loadState();
nextGateway.resumeExecution(renderLifecycle).catch((error) => {
  ui.explanation.textContent = `Saved transaction could not be resumed: ${error instanceof Error ? error.message : String(error)}`;
});
