export const NEXT_CONFIG = Object.freeze({
  network: Object.freeze({
    name: "GenLayer Studio Next",
    chainId: 61997,
    chainIdHex: "0xf22d",
    rpcUrl: "https://studio-dev.genlayer.com/api",
    explorerUrl: "https://explorer-studio-dev.genlayer.com",
  }),
  contracts: Object.freeze({
    mandate: "0x5839b040a1cDfc26dDe8f3b5b00c309451cff26A",
    treasuryReference: "0xa4B490C4b3D6d72a43BB4368757Dd405F49477c4",
  }),
  protocol: Object.freeze({
    name: "Aave V3 Ethereum",
    address: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
  }),
  policy: Object.freeze({ maxPercent: 25 }),
  verifiedWorkflow: Object.freeze({
    amount: 15,
    currentStatusState: "NO_ACTIVE_INCIDENT",
    securityContextState: "NON_CONTRADICTORY_CONTEXT",
    decision: "APPROVE",
    retrievalStatus: "COMPLETE",
    sourcesChecked: 2,
    finalAllocation: 15,
  }),
});
