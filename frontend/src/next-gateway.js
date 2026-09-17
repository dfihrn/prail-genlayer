import { abi, createClient } from "genlayer-js-next";
import { studioDevnet } from "genlayer-js-next/chains";
import { TransactionHashVariant } from "genlayer-js-next/types";

import { NEXT_CONFIG } from "./next-config.js";

const NEXT_CHAIN = Object.freeze({
  ...studioDevnet,
  name: NEXT_CONFIG.network.name,
  blockExplorers: {
    default: {
      name: "GenLayer Studio Next Explorer",
      url: NEXT_CONFIG.network.explorerUrl,
    },
  },
});
const readClient = createClient({ chain: NEXT_CHAIN });
const STORAGE_KEY = "prail:studio-next:protected-allocation:v1";
const SNAP_ID = "npm:genlayer-wallet-plugin";
const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 120;
const listeners = new Set();
let walletClient = null;
let walletProvider = null;
let eventsAttached = false;
let walletState = Object.freeze({ status: "WALLET_NOT_CONNECTED", account: null, chainId: null });

const EXPECTED_MANDATE_METHODS = Object.freeze({
  execute_allocation: Object.freeze({ readonly: false, params: ["string", "string", "int"], ret: "null" }),
  get_allocation: Object.freeze({ readonly: true, params: ["string"], ret: "int" }),
  get_total_funds: Object.freeze({ readonly: true, params: [], ret: "int" }),
});

function validateMandateSchema(schema) {
  if (!schema?.methods) throw new Error("Studio Next MANDATE returned an invalid schema.");
  for (const [name, expected] of Object.entries(EXPECTED_MANDATE_METHODS)) {
    const actual = schema.methods[name];
    const params = actual?.params?.map(([, type]) => type);
    if (
      !actual ||
      actual.readonly !== expected.readonly ||
      actual.ret !== expected.ret ||
      JSON.stringify(params) !== JSON.stringify(expected.params)
    ) {
      throw new Error(`Studio Next MANDATE schema does not match ${name}.`);
    }
  }
}

function normalizeChainId(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  return `0x${BigInt(value).toString(16)}`;
}

function isAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function setWalletState(status, account = null, chainId = null, error = null) {
  walletState = Object.freeze({ status, account, chainId, error });
  listeners.forEach((listener) => listener(walletState));
  return walletState;
}

function createNextWalletClient(provider, account) {
  return createClient({ chain: NEXT_CHAIN, account, provider });
}

async function validateWallet(account) {
  const chainId = normalizeChainId(await walletProvider.request({ method: "eth_chainId" }));
  if (chainId !== NEXT_CONFIG.network.chainIdHex) {
    walletClient = null;
    return setWalletState("WRONG_NETWORK", account, chainId);
  }
  walletClient = createNextWalletClient(walletProvider, account);
  return setWalletState("CONNECTED", account, chainId);
}

async function handleAccountsChanged(accounts) {
  walletClient = null;
  if (!Array.isArray(accounts) || accounts.length === 0) {
    setWalletState("WALLET_NOT_CONNECTED");
    return;
  }
  const account = accounts[0];
  if (!isAddress(account)) {
    setWalletState("CONNECTION_ERROR", null, null, "Wallet returned an invalid account.");
    return;
  }
  try {
    await validateWallet(account);
  } catch (error) {
    setWalletState("CONNECTION_ERROR", null, null, error instanceof Error ? error.message : String(error));
  }
}

function handleChainChanged(value) {
  const chainId = normalizeChainId(value);
  walletClient = null;
  if (chainId !== NEXT_CONFIG.network.chainIdHex) {
    setWalletState("WRONG_NETWORK", walletState.account, chainId);
  } else if (walletState.account && walletProvider) {
    walletClient = createNextWalletClient(walletProvider, walletState.account);
    setWalletState("CONNECTED", walletState.account, chainId);
  } else {
    setWalletState("WALLET_NOT_CONNECTED", null, chainId);
  }
}

function attachWalletEvents(provider) {
  if (eventsAttached || typeof provider.on !== "function") return;
  provider.on("accountsChanged", handleAccountsChanged);
  provider.on("chainChanged", handleChainChanged);
  eventsAttached = true;
}

async function switchToStudioNext(provider) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: NEXT_CONFIG.network.chainIdHex }],
    });
  } catch (error) {
    if (error?.code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: NEXT_CONFIG.network.chainIdHex,
        chainName: NEXT_CONFIG.network.name,
        rpcUrls: [NEXT_CONFIG.network.rpcUrl],
        nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
        blockExplorerUrls: [NEXT_CONFIG.network.explorerUrl],
      }],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: NEXT_CONFIG.network.chainIdHex }],
    });
  }
}

async function ensureGenLayerWallet(provider) {
  const installed = await provider.request({ method: "wallet_getSnaps" });
  if (!Object.values(installed ?? {}).some((snap) => snap?.id === SNAP_ID)) {
    await provider.request({ method: "wallet_requestSnaps", params: { [SNAP_ID]: {} } });
  }
}

function readStoredExecution() {
  if (typeof window === "undefined") return null;
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    return stored && /^0x[0-9a-fA-F]{64}$/.test(stored.transactionId) ? stored : null;
  } catch {
    return null;
  }
}

function storeExecution(stored, patch = {}) {
  const next = { ...stored, ...patch };
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function transactionLifecycle(transaction) {
  const status = transaction?.statusName;
  if (status === "FINALIZED") return "FINALIZED";
  if (status === "CANCELED") return "CANCELED";
  if (["ACCEPTED", "UNDETERMINED", "READY_TO_FINALIZE"].includes(status)) return "DECIDED";
  return "PROCESSING";
}

function acceptedConsensus(transaction) {
  const result = transaction?.resultName ?? transaction?.result_name;
  return result === "MAJORITY_AGREE" || transaction?.result === 6;
}

function successfulLeaderReceipt(transaction) {
  const receipts = transaction?.consensus_data?.leader_receipt;
  if (!Array.isArray(receipts)) return null;
  return [...receipts].reverse().find(
    (receipt) => receipt?.mode === "leader" && receipt?.execution_result === "SUCCESS" && receipt?.result?.status === "return",
  );
}

function mapDecoded(value) {
  if (value instanceof Map) return Object.fromEntries([...value].map(([key, item]) => [key, mapDecoded(item)]));
  if (Array.isArray(value)) return value.map(mapDecoded);
  if (typeof value === "bigint") return value.toString();
  return value;
}

function decodeEvidence(transaction) {
  const receipt = successfulLeaderReceipt(transaction);
  if (!receipt?.eq_outputs || typeof receipt.eq_outputs !== "object") return null;
  for (const output of Object.values(receipt.eq_outputs)) {
    const raw = output?.payload?.raw;
    if (!Array.isArray(raw)) continue;
    try {
      const decoded = mapDecoded(abi.calldata.decode(Uint8Array.from(raw)));
      if (decoded?.decision && decoded?.retrieval_status) return Object.freeze(decoded);
    } catch {
      // Other equivalence outputs are not evidence assessment objects.
    }
  }
  return null;
}

async function readAllocation() {
  const value = await readClient.readContract({
    address: NEXT_CONFIG.contracts.mandate,
    functionName: "get_allocation",
    args: [NEXT_CONFIG.protocol.address],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  return BigInt(value);
}

async function trackExecution(stored, onLifecycle = () => {}) {
  let current = stored;
  let transaction = null;
  for (let poll = 0; poll < MAX_POLLS; poll += 1) {
    transaction = await readClient.getTransaction({ hash: current.transactionId });
    const lifecycle = transactionLifecycle(transaction);
    current = storeExecution(current, { lifecycle });
    onLifecycle(Object.freeze({ ...current, transaction }));
    if (lifecycle === "CANCELED") return Object.freeze(current);
    if (lifecycle === "DECIDED") {
      current = storeExecution(current, { lifecycle: "FINALIZING" });
      onLifecycle(Object.freeze({ ...current, transaction }));
    }
    if (lifecycle === "FINALIZED") break;
    await delay(POLL_INTERVAL_MS);
  }

  if (!transaction || transaction.statusName !== "FINALIZED") {
    current = storeExecution(current, { lifecycle: "PENDING_RESUME" });
    onLifecycle(Object.freeze(current));
    return Object.freeze(current);
  }
  if (!acceptedConsensus(transaction) || !successfulLeaderReceipt(transaction)) {
    current = storeExecution(current, { lifecycle: "EXECUTION_REJECTED" });
    onLifecycle(Object.freeze({ ...current, transaction }));
    return Object.freeze(current);
  }

  const evidence = decodeEvidence(transaction);
  current = storeExecution(current, { lifecycle: "AWAITING_FINALIZED_STATE", evidence });
  onLifecycle(Object.freeze({ ...current, transaction }));
  for (let poll = 0; poll < MAX_POLLS; poll += 1) {
    const allocation = await readAllocation();
    if (allocation >= BigInt(current.expectedAllocation)) {
      current = storeExecution(current, {
        lifecycle: "ALLOCATION_FINALIZED",
        finalAllocation: allocation.toString(),
      });
      onLifecycle(Object.freeze({ ...current, transaction }));
      return Object.freeze(current);
    }
    await delay(POLL_INTERVAL_MS);
  }
  current = storeExecution(current, { lifecycle: "PENDING_RESUME" });
  onLifecycle(Object.freeze(current));
  return Object.freeze(current);
}

export const nextGateway = Object.freeze({
  mode: "studio-next-reviewer-path",

  async readState() {
    const schema = await readClient.getContractSchema(NEXT_CONFIG.contracts.mandate);
    validateMandateSchema(schema);
    const [totalFunds, currentAllocation] = await Promise.all([
      readClient.readContract({
        address: NEXT_CONFIG.contracts.mandate,
        functionName: "get_total_funds",
        args: [],
        transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
      }),
      readAllocation(),
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
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  async connectWallet() {
    const provider = typeof window === "undefined" ? null : window.ethereum;
    if (!provider) return setWalletState("WALLET_UNAVAILABLE", null, null, "MetaMask was not detected.");
    walletProvider = provider;
    attachWalletEvents(provider);
    setWalletState("CONNECTING");
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const account = accounts?.[0];
      if (!isAddress(account)) throw new Error("Wallet returned an invalid account.");
      await switchToStudioNext(provider);
      await ensureGenLayerWallet(provider);
      return await validateWallet(account);
    } catch (error) {
      return setWalletState("CONNECTION_ERROR", null, null, error instanceof Error ? error.message : String(error));
    }
  },

  async executeAllocation(amount, currentAllocation, onLifecycle = () => {}) {
    if (!walletClient || walletState.status !== "CONNECTED") throw new Error("Connect a wallet on Studio Next first.");
    if (normalizeChainId(await walletProvider.request({ method: "eth_chainId" })) !== NEXT_CONFIG.network.chainIdHex) {
      walletClient = null;
      setWalletState("WRONG_NETWORK", walletState.account);
      throw new Error("Wallet is not connected to Studio Next chain 61997.");
    }
    if (readStoredExecution()?.lifecycle && !["ALLOCATION_FINALIZED", "CANCELED", "EXECUTION_REJECTED"].includes(readStoredExecution().lifecycle)) {
      throw new Error("A Studio Next allocation is already pending. Resume it before submitting another.");
    }

    const write = {
      address: NEXT_CONFIG.contracts.mandate,
      functionName: "execute_allocation",
      args: [NEXT_CONFIG.contracts.treasuryReference, NEXT_CONFIG.protocol.address, BigInt(amount)],
    };
    onLifecycle(Object.freeze({ lifecycle: "ESTIMATING_FEES" }));
    const estimate = await walletClient.estimateTransactionFeesForWrite(write);
    const transactionId = await walletClient.writeContract({
      ...write,
      fees: {
        distribution: estimate.distribution,
        messageAllocations: estimate.messageAllocations,
        feeValue: estimate.feeValue,
      },
    });
    const stored = storeExecution({
      transactionId,
      lifecycle: "SUBMITTED",
      amount: BigInt(amount).toString(),
      allocationBefore: BigInt(currentAllocation).toString(),
      expectedAllocation: (BigInt(currentAllocation) + BigInt(amount)).toString(),
    });
    onLifecycle(Object.freeze(stored));
    return trackExecution(stored, onLifecycle);
  },

  async resumeExecution(onLifecycle = () => {}) {
    const stored = readStoredExecution();
    if (!stored || ["ALLOCATION_FINALIZED", "CANCELED", "EXECUTION_REJECTED"].includes(stored.lifecycle)) return stored;
    return trackExecution(stored, onLifecycle);
  },
});
