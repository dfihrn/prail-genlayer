export const DEMO_CONFIG = Object.freeze({
  network: Object.freeze({ name: "GenLayer Studionet", chainId: 61999 }),
  contracts: Object.freeze({
    mandate: "0x7A94f7908eafC5476af0f019828C9212dBD32cE6",
    treasury: "0xc9F2f0874906b06E187F19d6bE38a21368F80E40",
  }),
  protocol: Object.freeze({
    name: "Aave V3 Ethereum Pool",
    address: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
  }),
  policy: Object.freeze({ maxPercent: 25 }),
  primaryProof: Object.freeze({
    stage: "D",
    allocationBefore: 15,
    amount: 10,
    allocationAfter: 25,
    currentStatusState: "NO_ACTIVE_INCIDENT",
    securityContextState: "NON_CONTRADICTORY_CONTEXT",
    combinedEvidenceState: "NO_ACTIVE_INCIDENT",
    decision: "APPROVE",
    retrievalStatus: "COMPLETE",
    sourcesChecked: 2,
    parentTransaction:
      "0xe71d375bd4304c203fd52b8f9b21b85cdd1f5c8a2a21a6fe8341c9c36c794a61",
    childTransaction:
      "0x38dfcc275189a116152b4830668639aee982e398b4d82322563c338a15e79b20",
    finalAllocation: 25,
    executionStatus: "TREASURY EXECUTED",
    historical: true,
  }),
  canonicalProof: Object.freeze({
    historical: true,
    proposalBaseline: 0,
    amount: 15,
    currentStatusState: "NO_ACTIVE_INCIDENT",
    securityContextState: null,
    combinedEvidenceState: "NO_ACTIVE_INCIDENT",
    decision: "APPROVE",
    retrievalStatus: "COMPLETE · 2 SOURCES",
    executionStatus: "FINALIZED · SUCCESS",
    transaction:
      "0xada0299fef334577fbe73e4daab56eb33292c7109c64bcd8a2e1fc624e5545ca",
  }),
});
