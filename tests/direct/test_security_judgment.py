"""Repeatable direct-mode tests for the security-incident judgment."""

import pytest


@pytest.mark.parametrize(
    ("evidence", "decision"),
    [
        ("No active incident is reported after a completed audit.", "APPROVE"),
        ("A confirmed exploit remains active and unresolved.", "REJECT"),
        ("Sources conflict and the current status cannot be verified.", "UNDETERMINED"),
    ],
)
def test_structured_security_decisions(direct_vm, direct_deploy, evidence, decision):
    contract = direct_deploy("contracts/mandate.py")
    direct_vm.mock_llm(
        r"capital-allocation security policy",
        '{"decision": "' + decision + '"}',
    )

    assert contract.assess_security_incident(evidence) == decision
    assert direct_vm.run_validator() is True


def test_empty_evidence_is_undetermined_without_llm(direct_vm, direct_deploy):
    contract = direct_deploy("contracts/mandate.py")
    direct_vm.strict_mocks = True

    assert contract.assess_security_incident("   ") == "UNDETERMINED"


def test_invalid_model_decision_fails_closed(direct_vm, direct_deploy):
    contract = direct_deploy("contracts/mandate.py")
    direct_vm.mock_llm(
        r"capital-allocation security policy",
        '{"decision": "MAYBE", "reasoning": "unsupported"}',
    )

    assert contract.assess_security_incident("Unclear report") == "UNDETERMINED"
