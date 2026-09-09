import { abi, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionHashVariant } from "genlayer-js/types";

import { DEMO_CONFIG } from "./config.js";

const client = createClient({ chain: studionet });
const STUDIONET_CHAIN_ID = "0xf22f";
const DIAGNOSTIC_STORAGE_KEY = "mandate:studionet:security-diagnostic:v1";
const DIAGNOSTIC_POLL_INTERVAL_MS = 5_000;
const DIAGNOSTIC_MAX_POLLS = 120;
const ALLOCATION_STORAGE_KEY = "mandate:studionet:protected-allocation:v1";
const walletListeners = new Set();
let walletClient = null;
let walletProvider = null;
let walletEventsAttached = false;
let walletState = Object.freeze({ status: "WALLET_NOT_CONNECTED", account: null, chainId: null });

const EXPECTED_METHODS = Object.freeze({
  mandate: Object.freeze({
    health: Object.freeze({ readonly: true, params: [], ret: "string" }),
    is_allocation_allowed: Object.freeze({ readonly: true, params: ["int", "int"], ret: "bool" }),
    diagnose_protocol_security: Object.freeze({ readonly: false, params: ["string"], ret: "dict" }),
    execute_allocation: Object.freeze({ readonly: false, params: ["string", "string", "int"], ret: "null" }),
  }),
  treasury: Object.freeze({
    get_total_funds: Object.freeze({ readonly: true, params: [], ret: "int" }),
    get_allocation: Object.freeze({ readonly: true, params: ["string"], ret: "int" }),
    record_allocation: Object.freeze({ readonly: false, params: ["string", "int"], ret: "null" }),
  }),
});

function validateSchema(label, schema, expectedMethods) {
  if (!schema || typeof schema !== "object" || !schema.methods) {
    throw new Error(`${label} returned an invalid contract schema`);
  }

  for (const [name, expected] of Object.entries(expectedMethods)) {
    const actual = schema.methods[name];
    const actualParams = actual?.params?.map(([, type]) => type);
    if (
      !actual ||
      actual.readonly !== expected.readonly ||
      actual.ret !== expected.ret ||
      JSON.stringify(actualParams) !== JSON.stringify(expected.params)
    ) {
      throw new Error(`${label} schema does not match the expected ${name} signature`);
    }
  }
}

function getInjectedProvider() {
  return typeof window === "undefined" ? null : window.ethereum ?? null;
}

function isEvmAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function normalizeChainId(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  return `0x${BigInt(value).toString(16)}`;
}

function setWalletState(status, account = null, chainId = null, error = null) {
  walletState = Object.freeze({ status, account, chainId, error });
  walletListeners.forEach((listener) => listener(walletState));
  return walletState;
}

function createWalletClient(provider, account) {
  return createClient({ chain: studionet, account, provider });
}

async function validateChangedWallet(account) {
  const chainId = normalizeChainId(await walletProvider.request({ method: "eth_chainId" }));
  if (chainId !== STUDIONET_CHAIN_ID) {
    walletClient = null;
    return setWalletState("WRONG_NETWORK", account, chainId);
  }
  walletClient = createWalletClient(walletProvider, account);
  return setWalletState("CONNECTED", account, chainId);
}

async function handleAccountsChanged(accounts) {
  walletClient = null;
  if (!Array.isArray(accounts) || accounts.length === 0) {
    setWalletState("WALLET_NOT_CONNECTED");
    return;
  }
  const account = accounts[0];
  if (!isEvmAddress(account)) {
    setWalletState("CONNECTION_ERROR", null, null, "Wallet returned an invalid account address.");
    return;
  }
  setWalletState("CONNECTING", account);
  try {
    await validateChangedWallet(account);
  } catch (error) {
    setWalletState("CONNECTION_ERROR", null, null, error instanceof Error ? error.message : String(error));
  }
}

function handleChainChanged(chainIdValue) {
  const chainId = normalizeChainId(chainIdValue);
  walletClient = null;
  if (chainId !== STUDIONET_CHAIN_ID) {
    setWalletState("WRONG_NETWORK", walletState.account, chainId);
    return;
  }
  if (!walletState.account || !walletProvider) {
    setWalletState("WALLET_NOT_CONNECTED", null, chainId);
    return;
  }
  walletClient = createWalletClient(walletProvider, walletState.account);
  setWalletState("CONNECTED", walletState.account, chainId);
}

function attachWalletEvents(provider) {
  if (walletEventsAttached || typeof provider.on !== "function") return;
  provider.on("accountsChanged", handleAccountsChanged);
  provider.on("chainChanged", handleChainChanged);
  walletEventsAttached = true;
}

function readStoredDiagnostic() {
  if (typeof window === "undefined") return null;
  try {
    const stored = JSON.parse(window.localStorage.getItem(DIAGNOSTIC_STORAGE_KEY));
    return stored && /^0x[0-9a-fA-F]{64}$/.test(stored.transactionId) ? stored : null;
  } catch {
    return null;
  }
}

function storeDiagnostic(transactionId, lifecycle, result = null) {
  const stored = { transactionId, lifecycle, result };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(DIAGNOSTIC_STORAGE_KEY, JSON.stringify(stored));
  }
  return stored;
}

function readStoredAllocation() {
  if (typeof window === "undefined") return null;
  try {
    const stored = JSON.parse(window.localStorage.getItem(ALLOCATION_STORAGE_KEY));
    return stored && /^0x[0-9a-fA-F]{64}$/.test(stored.parentTransactionId) ? stored : null;
  } catch {
    return null;
  }
}

function storeAllocation(stored, patch = {}) {
  const next = { ...stored, ...patch };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(ALLOCATION_STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function lifecycleForTransaction(transaction) {
  const status = transaction?.statusName;
  if (status === "FINALIZED") return "FINALIZED";
  if (status === "CANCELED") return "CANCELED";
  if (status === "ACCEPTED" || status === "UNDETERMINED" || status === "READY_TO_FINALIZE") {
    return "DECIDED";
  }
  return "PROCESSING";
}

function successfulLeaderReceipt(transaction) {
  const receipts = transaction?.consensus_data?.leader_receipt;
  if (!Array.isArray(receipts)) return null;
  return [...receipts].reverse().find(
    (receipt) =>
      receipt?.mode === "leader" &&
      receipt?.execution_result === "SUCCESS" &&
      receipt?.result?.status === "return",
  );
}

function mapToObject(value) {
  if (value instanceof Map) {
    return Object.fromEntries([...value].map(([key, item]) => [key, mapToObject(item)]));
  }
  if (Array.isArray(value)) return value.map(mapToObject);
  if (typeof value === "bigint") return value.toString();
  return value;
}

function decodeDiagnosticResult(transaction) {
  if (transaction?.statusName !== "FINALIZED") {
    throw new Error(`Diagnostic is not finalized (${transaction?.statusName ?? "unknown status"}).`);
  }
  const consensusResult = transaction.resultName ?? transaction.result_name;
  if (consensusResult !== "MAJORITY_AGREE" && transaction.result !== 6) {
    throw new Error(`The finalized diagnostic was not accepted by consensus (${consensusResult ?? "unknown result"}).`);
  }

  const receipt = successfulLeaderReceipt(transaction);
  if (!receipt) throw new Error("The finalized diagnostic has no successful leader receipt.");

  const raw = receipt.result?.payload?.raw;
  if (!Array.isArray(raw)) throw new Error("The successful leader receipt has no decodable return payload.");

  const decoded = mapToObject(abi.calldata.decode(Uint8Array.from(raw)));
  const required = [
    "current_status_state",
    "security_context_state",
    "combined_evidence_state",
    "decision",
    "retrieval_status",
    "sources_checked",
  ];
  if (!decoded || typeof decoded !== "object" || required.some((field) => !(field in decoded))) {
    throw new Error("The finalized diagnostic return does not match the deployed schema.");
  }
  return Object.freeze(decoded);
}

function hasAcceptedConsensus(transaction) {
  const consensusResult = transaction?.resultName ?? transaction?.result_name;
  return consensusResult === "MAJORITY_AGREE" || transaction?.result === 6;
}

function transactionErrorMessage(transaction) {
  const receipts = transaction?.consensus_data?.leader_receipt;
  if (!Array.isArray(receipts)) return "The transaction did not return a successful leader receipt.";
  const failed = [...receipts].reverse().find(
    (receipt) => receipt?.mode === "leader" && receipt?.execution_result !== "SUCCESS",
  ) ?? [...receipts].reverse().find((receipt) => receipt?.mode === "leader");
  const payload = failed?.result?.payload;
  if (typeof payload === "string" && payload.trim()) return payload;
  if (typeof failed?.error === "string" && failed.error.trim()) return failed.error;
  return "The protected allocation failed during contract execution.";
}

function decodeEvidenceFromEquivalenceOutput(transaction) {
  const receipt = successfulLeaderReceipt(transaction);
  if (!receipt?.eq_outputs || typeof receipt.eq_outputs !== "object") return null;
  for (const output of Object.values(receipt.eq_outputs)) {
    const raw = output?.payload?.raw;
    if (!Array.isArray(raw)) continue;
    try {
      const decoded = mapToObject(abi.calldata.decode(Uint8Array.from(raw)));
      if (decoded?.decision && decoded?.combined_evidence_state) return Object.freeze(decoded);
    } catch {
      // Ignore non-assessment equivalence outputs.
    }
  }
  return null;
}

async function readFinalizedAllocation() {
  const value = await client.readContract({
    address: DEMO_CONFIG.contracts.treasury,
    functionName: "get_allocation",
    args: [DEMO_CONFIG.protocol.address],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  return BigInt(value);
}

async function trackProtectedAllocation(stored, onLifecycle = () => {}) {
  let current = stored;
  let parent = null;

  for (let poll = 0; poll < DIAGNOSTIC_MAX_POLLS; poll += 1) {
    parent = await client.getTransaction({ hash: current.parentTransactionId });
    const lifecycle = lifecycleForTransaction(parent);
    onLifecycle(Object.freeze({ ...current, lifecycle, transaction: parent }));
    if (lifecycle === "CANCELED") {
      current = storeAllocation(current, { lifecycle: "CANCELED" });
      return Object.freeze(current);
    }
    if (lifecycle === "DECIDED") {
      current = storeAllocation(current, { lifecycle: "FINALIZING" });
      onLifecycle(Object.freeze({ ...current, transaction: parent }));
    } else {
      current = storeAllocation(current, { lifecycle });
    }
    if (lifecycle === "FINALIZED") break;
    await delay(DIAGNOSTIC_POLL_INTERVAL_MS);
  }

  if (!parent || parent.statusName !== "FINALIZED") {
    current = storeAllocation(current, { lifecycle: "PENDING_RESUME" });
    onLifecycle(Object.freeze(current));
    return Object.freeze(current);
  }

  if (!hasAcceptedConsensus(parent) || !successfulLeaderReceipt(parent)) {
    const message = transactionErrorMessage(parent);
    const childIds = await client.getTriggeredTransactionIds({ hash: current.parentTransactionId });
    const lifecycle = childIds.length > 0
      ? "EXECUTION_ERROR"
      : message.includes("Allocation rejected by MANDATE policy")
      ? "DETERMINISTIC_REJECT"
      : message.includes("UNDETERMINED")
        ? "UNDETERMINED"
        : hasAcceptedConsensus(parent)
          ? "EXECUTION_ERROR"
          : "CONSENSUS_REJECT";
    const error = childIds.length > 0
      ? `Failed parent unexpectedly produced ${childIds.length} child transaction(s).`
      : message;
    current = storeAllocation(current, { lifecycle, error, childTransactionIds: childIds });
    onLifecycle(Object.freeze(current));
    return Object.freeze(current);
  }

  const evidence = decodeEvidenceFromEquivalenceOutput(parent);
  current = storeAllocation(current, { lifecycle: "PARENT_FINALIZED", evidence });
  onLifecycle(Object.freeze(current));

  let childTransactionId = current.childTransactionId ?? null;
  let child = null;
  for (let poll = 0; poll < DIAGNOSTIC_MAX_POLLS && !childTransactionId; poll += 1) {
    const childIds = await client.getTriggeredTransactionIds({ hash: current.parentTransactionId });
    for (const candidateId of childIds) {
      const candidate = await client.getTransaction({ hash: candidateId });
      const target = candidate.to_address ?? candidate.recipient;
      if (typeof target === "string" && target.toLowerCase() === current.treasuryAddress.toLowerCase()) {
        childTransactionId = candidateId;
        child = candidate;
        break;
      }
    }
    if (!childTransactionId) await delay(DIAGNOSTIC_POLL_INTERVAL_MS);
  }
  if (!childTransactionId) {
    current = storeAllocation(current, { lifecycle: "PENDING_RESUME" });
    onLifecycle(Object.freeze(current));
    return Object.freeze(current);
  }

  current = storeAllocation(current, { childTransactionId, lifecycle: "CHILD_PROCESSING" });
  onLifecycle(Object.freeze(current));
  for (let poll = 0; poll < DIAGNOSTIC_MAX_POLLS; poll += 1) {
    child ??= await client.getTransaction({ hash: childTransactionId });
    const childLifecycle = lifecycleForTransaction(child);
    if (childLifecycle === "CANCELED") {
      current = storeAllocation(current, { lifecycle: "CANCELED" });
      onLifecycle(Object.freeze(current));
      return Object.freeze(current);
    }
    if (childLifecycle === "DECIDED") {
      current = storeAllocation(current, { lifecycle: "CHILD_FINALIZING" });
    } else if (childLifecycle !== "FINALIZED") {
      current = storeAllocation(current, { lifecycle: "CHILD_PROCESSING" });
    }
    onLifecycle(Object.freeze({ ...current, childTransaction: child }));
    if (childLifecycle === "FINALIZED") break;
    child = null;
    await delay(DIAGNOSTIC_POLL_INTERVAL_MS);
  }

  if (!child || child.statusName !== "FINALIZED") {
    current = storeAllocation(current, { lifecycle: "PENDING_RESUME" });
    onLifecycle(Object.freeze(current));
    return Object.freeze(current);
  }
  if (!hasAcceptedConsensus(child) || !successfulLeaderReceipt(child)) {
    current = storeAllocation(current, {
      lifecycle: "EXECUTION_ERROR",
      error: transactionErrorMessage(child),
    });
    onLifecycle(Object.freeze(current));
    return Object.freeze(current);
  }

  current = storeAllocation(current, { lifecycle: "AWAITING_FINALIZED_STATE" });
  onLifecycle(Object.freeze(current));
  for (let poll = 0; poll < DIAGNOSTIC_MAX_POLLS; poll += 1) {
    const finalAllocation = await readFinalizedAllocation();
    if (finalAllocation >= BigInt(current.expectedAllocation)) {
      current = storeAllocation(current, {
        lifecycle: "TREASURY_EXECUTED",
        finalAllocation: finalAllocation.toString(),
      });
      onLifecycle(Object.freeze(current));
      return Object.freeze(current);
    }
    await delay(DIAGNOSTIC_POLL_INTERVAL_MS);
  }

  current = storeAllocation(current, { lifecycle: "PENDING_RESUME" });
  onLifecycle(Object.freeze(current));
  return Object.freeze(current);
}

async function trackDiagnostic(transactionId, onLifecycle = () => {}) {
  for (let poll = 0; poll < DIAGNOSTIC_MAX_POLLS; poll += 1) {
    const transaction = await client.getTransaction({ hash: transactionId });
    const lifecycle = lifecycleForTransaction(transaction);
    onLifecycle(Object.freeze({ lifecycle, transactionId, transaction }));

    if (lifecycle === "CANCELED") {
      storeDiagnostic(transactionId, lifecycle);
      throw new Error("The diagnostic transaction was canceled.");
    }
    if (lifecycle === "FINALIZED") {
      const result = decodeDiagnosticResult(transaction);
      storeDiagnostic(transactionId, lifecycle, result);
      onLifecycle(Object.freeze({ lifecycle, transactionId, transaction, result }));
      return Object.freeze({ transactionId, transaction, result });
    }

    if (lifecycle === "DECIDED") {
      storeDiagnostic(transactionId, "FINALIZING");
      onLifecycle(Object.freeze({ lifecycle: "FINALIZING", transactionId, transaction }));
    } else {
      storeDiagnostic(transactionId, lifecycle);
    }
    await delay(DIAGNOSTIC_POLL_INTERVAL_MS);
  }

  storeDiagnostic(transactionId, "PENDING_RESUME");
  onLifecycle(Object.freeze({ lifecycle: "PENDING_RESUME", transactionId }));
  return Object.freeze({ transactionId, pending: true });
}

export const contractGateway = Object.freeze({
  mode: "live-wallet-protected-execution-ready",

  async readTreasuryState() {
    const { mandate, treasury } = DEMO_CONFIG.contracts;
    const [mandateSchema, treasurySchema] = await Promise.all([
      client.getContractSchema(mandate),
      client.getContractSchema(treasury),
    ]);

    validateSchema("MANDATE", mandateSchema, EXPECTED_METHODS.mandate);
    validateSchema("TargetTreasury", treasurySchema, EXPECTED_METHODS.treasury);

    const [totalFunds, currentAllocation] = await Promise.all([
      client.readContract({
        address: treasury,
        functionName: "get_total_funds",
        args: [],
        transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
      }),
      client.readContract({
        address: treasury,
        functionName: "get_allocation",
        args: [DEMO_CONFIG.protocol.address],
        transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
      }),
    ]);

    return Object.freeze({
      totalFunds: BigInt(totalFunds),
      currentAllocation: BigInt(currentAllocation),
      schemasValidated: true,
      state: "finalized",
    });
  },

  getWalletState() {
    return walletState;
  },

  subscribeWallet(listener) {
    if (typeof listener !== "function") throw new TypeError("Wallet listener must be a function");
    walletListeners.add(listener);
    listener(walletState);
    return () => walletListeners.delete(listener);
  },

  async connectWallet() {
    const provider = getInjectedProvider();
    if (!provider || typeof provider.request !== "function") {
      walletClient = null;
      walletProvider = null;
      return setWalletState("WALLET_UNAVAILABLE");
    }

    walletProvider = provider;
    attachWalletEvents(provider);
    setWalletState("CONNECTING");

    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const account = Array.isArray(accounts) ? accounts[0] : null;
      if (!isEvmAddress(account)) {
        throw new Error("Wallet returned an invalid account address.");
      }

      const candidate = createWalletClient(provider, account);
      await candidate.connect("studionet");
      const chainId = normalizeChainId(await provider.request({ method: "eth_chainId" }));
      if (chainId !== STUDIONET_CHAIN_ID) {
        walletClient = null;
        return setWalletState("WRONG_NETWORK", account, chainId);
      }

      walletClient = candidate;
      return setWalletState("CONNECTED", account, chainId);
    } catch (error) {
      walletClient = null;
      const message = error instanceof Error ? error.message : String(error);
      if (error?.code === 4001) return setWalletState("USER_REJECTED", null, null, message);
      return setWalletState("CONNECTION_ERROR", null, null, message);
    }
  },

  getStoredDiagnostic() {
    return readStoredDiagnostic();
  },

  async diagnoseProtocolSecurity(onLifecycle) {
    if (!walletClient || walletState.status !== "CONNECTED") {
      throw new Error("Connect a wallet on Studionet before starting a live diagnostic.");
    }
    const stored = readStoredDiagnostic();
    if (stored && stored.lifecycle !== "FINALIZED" && stored.lifecycle !== "CANCELED") {
      throw new Error(`Diagnostic ${stored.transactionId} is already pending and must be resumed.`);
    }

    const schema = await client.getContractSchema(DEMO_CONFIG.contracts.mandate);
    validateSchema("MANDATE", schema, EXPECTED_METHODS.mandate);

    const transactionId = await walletClient.writeContract({
      address: DEMO_CONFIG.contracts.mandate,
      functionName: "diagnose_protocol_security",
      args: [DEMO_CONFIG.protocol.address],
    });

    storeDiagnostic(transactionId, "SUBMITTED");
    onLifecycle?.(Object.freeze({ lifecycle: "SUBMITTED", transactionId }));
    return trackDiagnostic(transactionId, onLifecycle);
  },

  async resumeProtocolSecurityDiagnostic(onLifecycle) {
    const stored = readStoredDiagnostic();
    if (!stored) return null;
    if (stored.lifecycle === "FINALIZED" && stored.result) {
      onLifecycle?.(Object.freeze(stored));
      return Object.freeze(stored);
    }
    if (stored.lifecycle === "CANCELED") {
      onLifecycle?.(Object.freeze(stored));
      return Object.freeze(stored);
    }
    return trackDiagnostic(stored.transactionId, onLifecycle);
  },

  getStoredProtectedAllocation() {
    return readStoredAllocation();
  },

  async executeProtectedAllocation(amount, confirmedCurrentAllocation, onLifecycle) {
    if (!walletClient || walletState.status !== "CONNECTED" || walletState.chainId !== STUDIONET_CHAIN_ID) {
      throw new Error("Connect a wallet on Studionet before executing an allocation.");
    }
    if (typeof amount !== "bigint" || amount <= 0n) {
      throw new Error("Additional allocation must be a positive whole number.");
    }
    const prior = readStoredAllocation();
    const terminal = new Set([
      "TREASURY_EXECUTED",
      "DETERMINISTIC_REJECT",
      "CONSENSUS_REJECT",
      "UNDETERMINED",
      "EXECUTION_ERROR",
      "CANCELED",
    ]);
    if (prior && !terminal.has(prior.lifecycle)) {
      throw new Error(`Protected allocation ${prior.parentTransactionId} is already pending and must be resumed.`);
    }

    const state = await this.readTreasuryState();
    if (state.currentAllocation !== confirmedCurrentAllocation) {
      throw new Error("Finalized treasury state changed after confirmation. Review the updated allocation and confirm again.");
    }
    const resultingAllocation = state.currentAllocation + amount;
    if (resultingAllocation * 100n > state.totalFunds * BigInt(DEMO_CONFIG.policy.maxPercent)) {
      throw new Error("Allocation rejected locally by the deterministic 25% cap.");
    }

    const parentTransactionId = await walletClient.writeContract({
      address: DEMO_CONFIG.contracts.mandate,
      functionName: "execute_allocation",
      args: [
        DEMO_CONFIG.contracts.treasury,
        DEMO_CONFIG.protocol.address,
        amount,
      ],
    });

    const stored = storeAllocation({
      parentTransactionId,
      childTransactionId: null,
      requestedAmount: amount.toString(),
      beforeAllocation: state.currentAllocation.toString(),
      expectedAllocation: resultingAllocation.toString(),
      protocolAddress: DEMO_CONFIG.protocol.address,
      treasuryAddress: DEMO_CONFIG.contracts.treasury,
      submittedAt: new Date().toISOString(),
      lifecycle: "SUBMITTED",
    });
    onLifecycle?.(Object.freeze(stored));
    return trackProtectedAllocation(stored, onLifecycle);
  },

  async resumeProtectedAllocation(onLifecycle) {
    const stored = readStoredAllocation();
    if (!stored) return null;
    const terminal = new Set([
      "TREASURY_EXECUTED",
      "DETERMINISTIC_REJECT",
      "CONSENSUS_REJECT",
      "UNDETERMINED",
      "EXECUTION_ERROR",
      "CANCELED",
    ]);
    if (terminal.has(stored.lifecycle)) {
      onLifecycle?.(Object.freeze(stored));
      return Object.freeze(stored);
    }
    return trackProtectedAllocation(stored, onLifecycle);
  },
});
