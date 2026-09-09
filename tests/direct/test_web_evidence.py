"""Controlled-source web evidence tests for registered protocols."""

import pytest


AAVE_PROTOCOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2"


def deploy_with_aave_address(direct_deploy):
    contract = direct_deploy("contracts/mandate.py")
    return contract, AAVE_PROTOCOL


def mock_aave_sources(direct_vm, status_body, security_body):
    direct_vm.mock_web(
        r"status\.aave\.com",
        {"status": 200, "body": status_body},
    )
    direct_vm.mock_web(
        r"aave\.com/security",
        {"status": 200, "body": security_body},
    )


def mock_source_states(direct_vm, status_state, security_state):
    direct_vm.mock_llm(
        r"SOURCE_ID: AAVE_OPERATIONAL_STATUS",
        '{"state": "' + status_state + '"}',
    )
    direct_vm.mock_llm(
        r"SOURCE_ID: AAVE_SECURITY",
        '{"state": "' + security_state + '"}',
    )


def test_configured_safe_evidence_is_approved(direct_vm, direct_deploy):
    contract, protocol = deploy_with_aave_address(direct_deploy)
    mock_aave_sources(
        direct_vm,
        "All systems operational; no active incidents.",
        "Security response program active; no unresolved incident notice.",
    )
    mock_source_states(
        direct_vm, "NO_ACTIVE_INCIDENT", "NON_CONTRADICTORY_CONTEXT"
    )

    result = contract.assess_protocol_security(protocol)

    assert result == {
        "decision": "APPROVE",
        "evidence_state": "NO_ACTIVE_INCIDENT",
        "retrieval_status": "COMPLETE",
        "sources_checked": 2,
    }
    assert direct_vm.run_validator() is True


def test_configured_active_incident_is_rejected(direct_vm, direct_deploy):
    contract, protocol = deploy_with_aave_address(direct_deploy)
    mock_aave_sources(
        direct_vm,
        "Active exploit investigation; service impact ongoing.",
        "Incident response is active and remediation is pending.",
    )
    mock_source_states(
        direct_vm, "ACTIVE_INCIDENT", "NON_CONTRADICTORY_CONTEXT"
    )

    result = contract.assess_protocol_security(protocol)

    assert result["decision"] == "REJECT"
    assert result["evidence_state"] == "ACTIVE_INCIDENT"
    assert direct_vm.run_validator() is True


def test_unavailable_source_is_undetermined(direct_vm, direct_deploy):
    contract, protocol = deploy_with_aave_address(direct_deploy)
    direct_vm.mock_web(
        r"status\.aave\.com",
        {"status": 503, "body": "temporarily unavailable"},
    )

    result = contract.assess_protocol_security(protocol)

    assert result == {
        "decision": "UNDETERMINED",
        "evidence_state": "UNCLEAR",
        "retrieval_status": "SOURCE_UNAVAILABLE",
        "sources_checked": 0,
    }
    assert direct_vm.run_validator() is True


def test_contradictory_evidence_is_undetermined(direct_vm, direct_deploy):
    contract, protocol = deploy_with_aave_address(direct_deploy)
    mock_aave_sources(
        direct_vm,
        "All systems operational; no incidents.",
        "An active exploit remains unresolved.",
    )
    mock_source_states(
        direct_vm, "NO_ACTIVE_INCIDENT", "CONTRADICTORY_CURRENT_INFO"
    )

    result = contract.assess_protocol_security(protocol)

    assert result["decision"] == "UNDETERMINED"
    assert result["evidence_state"] == "UNCLEAR"
    assert direct_vm.run_validator() is True


def test_unknown_protocol_is_undetermined_without_web(direct_vm, direct_deploy):
    contract = direct_deploy("contracts/mandate.py")
    direct_vm.strict_mocks = True
    result = contract.assess_protocol_security("0x" + "99" * 20)

    assert result == {
        "decision": "UNDETERMINED",
        "evidence_state": "UNCLEAR",
        "retrieval_status": "UNCONFIGURED",
        "sources_checked": 0,
    }


def test_validator_independently_reruns_evidence_assessment(
    direct_vm, direct_deploy
):
    contract, protocol = deploy_with_aave_address(direct_deploy)
    mock_aave_sources(
        direct_vm,
        "Current status: no active security incident.",
        "Current status: no active or unresolved security incident.",
    )
    mock_source_states(
        direct_vm, "NO_ACTIVE_INCIDENT", "NON_CONTRADICTORY_CONTEXT"
    )

    result = contract.assess_protocol_security(protocol)
    assert result["evidence_state"] == "NO_ACTIVE_INCIDENT"

    direct_vm.clear_mocks()
    mock_aave_sources(
        direct_vm,
        "Active exploit investigation is ongoing.",
        "An active incident remains unresolved.",
    )
    mock_source_states(
        direct_vm, "ACTIVE_INCIDENT", "NON_CONTRADICTORY_CONTEXT"
    )

    assert direct_vm.run_validator() is False


def test_public_protocol_address_accepts_studio_string(direct_vm, direct_deploy):
    contract, protocol = deploy_with_aave_address(direct_deploy)
    mock_aave_sources(
        direct_vm,
        "Current status: no active incident.",
        "Current status: no unresolved incident.",
    )
    mock_source_states(
        direct_vm, "NO_ACTIVE_INCIDENT", "NON_CONTRADICTORY_CONTEXT"
    )

    assert isinstance(protocol, str)
    assert contract.assess_protocol_security(protocol)["decision"] == "APPROVE"


def test_security_context_active_incident_vetoes_clear_status(
    direct_vm, direct_deploy
):
    contract, protocol = deploy_with_aave_address(direct_deploy)
    mock_aave_sources(
        direct_vm,
        "All systems operational; no active incidents.",
        "A current exploit remains active and unresolved.",
    )
    mock_source_states(direct_vm, "NO_ACTIVE_INCIDENT", "ACTIVE_INCIDENT")

    result = contract.assess_protocol_security(protocol)

    assert result["evidence_state"] == "ACTIVE_INCIDENT"
    assert result["decision"] == "REJECT"


def test_unclear_current_status_cannot_be_rescued_by_general_context(
    direct_vm, direct_deploy
):
    contract, protocol = deploy_with_aave_address(direct_deploy)
    mock_aave_sources(
        direct_vm,
        "Welcome to the status page.",
        "General security program and audit information.",
    )
    mock_source_states(direct_vm, "UNCLEAR", "NON_CONTRADICTORY_CONTEXT")

    result = contract.assess_protocol_security(protocol)

    assert result["evidence_state"] == "UNCLEAR"
    assert result["decision"] == "UNDETERMINED"


def test_unavailable_security_context_is_undetermined(direct_vm, direct_deploy):
    contract, protocol = deploy_with_aave_address(direct_deploy)
    direct_vm.mock_web(
        r"status\.aave\.com",
        {"status": 200, "body": "All systems operational; no active incidents."},
    )
    direct_vm.mock_llm(
        r"SOURCE_ID: AAVE_OPERATIONAL_STATUS",
        '{"state": "NO_ACTIVE_INCIDENT"}',
    )
    direct_vm.mock_web(
        r"aave\.com/security",
        {"status": 503, "body": "temporarily unavailable"},
    )

    result = contract.assess_protocol_security(protocol)

    assert result == {
        "decision": "UNDETERMINED",
        "evidence_state": "UNCLEAR",
        "retrieval_status": "SOURCE_UNAVAILABLE",
        "sources_checked": 1,
    }


def test_unavailable_context_overrides_active_status_to_undetermined(
    direct_vm, direct_deploy
):
    contract, protocol = deploy_with_aave_address(direct_deploy)
    direct_vm.mock_web(
        r"status\.aave\.com",
        {"status": 200, "body": "An active incident is unresolved."},
    )
    direct_vm.mock_llm(
        r"SOURCE_ID: AAVE_OPERATIONAL_STATUS",
        '{"state": "ACTIVE_INCIDENT"}',
    )
    direct_vm.mock_web(
        r"aave\.com/security",
        {"status": 503, "body": "temporarily unavailable"},
    )

    result = contract.diagnose_protocol_security(protocol)

    assert result["current_status_state"] == "ACTIVE_INCIDENT"
    assert result["combined_evidence_state"] == "UNCLEAR"
    assert result["decision"] == "UNDETERMINED"
    assert direct_vm.run_validator() is True


@pytest.mark.parametrize(
    (
        "status_state",
        "context_state",
        "combined_state",
        "decision",
    ),
    [
        (
            "NO_ACTIVE_INCIDENT",
            "NON_CONTRADICTORY_CONTEXT",
            "NO_ACTIVE_INCIDENT",
            "APPROVE",
        ),
        (
            "ACTIVE_INCIDENT",
            "NON_CONTRADICTORY_CONTEXT",
            "ACTIVE_INCIDENT",
            "REJECT",
        ),
        (
            "NO_ACTIVE_INCIDENT",
            "CONTRADICTORY_CURRENT_INFO",
            "UNCLEAR",
            "UNDETERMINED",
        ),
        (
            "UNCLEAR",
            "NON_CONTRADICTORY_CONTEXT",
            "UNCLEAR",
            "UNDETERMINED",
        ),
    ],
)
def test_diagnostic_reports_normalized_source_states(
    direct_vm,
    direct_deploy,
    status_state,
    context_state,
    combined_state,
    decision,
):
    contract, protocol = deploy_with_aave_address(direct_deploy)
    mock_aave_sources(direct_vm, "mock current status", "mock security context")
    mock_source_states(direct_vm, status_state, context_state)

    result = contract.diagnose_protocol_security(protocol)

    assert result == {
        "current_status_state": status_state,
        "security_context_state": context_state,
        "combined_evidence_state": combined_state,
        "decision": decision,
        "retrieval_status": "COMPLETE",
        "sources_checked": 2,
    }
    assert direct_vm.run_validator() is True


def test_diagnostic_reports_unavailable_source_without_raw_evidence(
    direct_vm, direct_deploy
):
    contract, protocol = deploy_with_aave_address(direct_deploy)
    direct_vm.mock_web(
        r"status\.aave\.com",
        {"status": 503, "body": "unavailable body must not be returned"},
    )

    result = contract.diagnose_protocol_security(protocol)

    assert result == {
        "current_status_state": "UNCLEAR",
        "security_context_state": "UNCLEAR",
        "combined_evidence_state": "UNCLEAR",
        "decision": "UNDETERMINED",
        "retrieval_status": "SOURCE_UNAVAILABLE",
        "sources_checked": 0,
    }
    assert "body" not in result
    assert "evidence" not in result


def test_diagnostic_validator_independently_reruns_normalization(
    direct_vm, direct_deploy
):
    contract, protocol = deploy_with_aave_address(direct_deploy)
    mock_aave_sources(direct_vm, "current clear status", "general security context")
    mock_source_states(
        direct_vm, "NO_ACTIVE_INCIDENT", "NON_CONTRADICTORY_CONTEXT"
    )

    result = contract.diagnose_protocol_security(protocol)
    assert result["decision"] == "APPROVE"

    direct_vm.clear_mocks()
    mock_aave_sources(direct_vm, "active incident", "general security context")
    mock_source_states(
        direct_vm, "ACTIVE_INCIDENT", "NON_CONTRADICTORY_CONTEXT"
    )

    assert direct_vm.run_validator() is False


def test_current_status_explicit_all_clear_normalizes_to_no_active_incident(
    direct_vm, direct_deploy
):
    contract, protocol = deploy_with_aave_address(direct_deploy)
    mock_aave_sources(
        direct_vm,
        "Current status: all systems operational. No active incidents.",
        "General security program information.",
    )
    mock_source_states(
        direct_vm, "NO_ACTIVE_INCIDENT", "NON_CONTRADICTORY_CONTEXT"
    )

    result = contract.diagnose_protocol_security(protocol)

    assert result["current_status_state"] == "NO_ACTIVE_INCIDENT"


def test_current_status_explicit_active_incident_normalizes_to_active(
    direct_vm, direct_deploy
):
    contract, protocol = deploy_with_aave_address(direct_deploy)
    mock_aave_sources(
        direct_vm,
        "Current incident: degraded service while an exploit is investigated.",
        "General security program information.",
    )
    mock_source_states(
        direct_vm, "ACTIVE_INCIDENT", "NON_CONTRADICTORY_CONTEXT"
    )

    result = contract.diagnose_protocol_security(protocol)

    assert result["current_status_state"] == "ACTIVE_INCIDENT"


def test_historical_resolved_incident_does_not_false_positive_as_active(
    direct_vm, direct_deploy
):
    contract, protocol = deploy_with_aave_address(direct_deploy)
    mock_aave_sources(
        direct_vm,
        "Incident history: a 2024 disruption was resolved. No current status shown.",
        "General security program information.",
    )
    mock_source_states(direct_vm, "UNCLEAR", "NON_CONTRADICTORY_CONTEXT")

    result = contract.diagnose_protocol_security(protocol)

    assert result["current_status_state"] == "UNCLEAR"
    assert result["decision"] == "UNDETERMINED"


def test_generic_current_status_page_remains_unclear(direct_vm, direct_deploy):
    contract, protocol = deploy_with_aave_address(direct_deploy)
    mock_aave_sources(
        direct_vm,
        "Welcome. Learn more about our products and community.",
        "General security program information.",
    )
    mock_source_states(direct_vm, "UNCLEAR", "NON_CONTRADICTORY_CONTEXT")

    result = contract.diagnose_protocol_security(protocol)

    assert result["current_status_state"] == "UNCLEAR"


def test_noisy_status_page_extracts_relevant_current_status(
    direct_vm, direct_deploy
):
    contract, protocol = deploy_with_aave_address(direct_deploy)
    noisy_status = (
        "<nav>Products Documentation Community</nav>"
        + ("unrelated marketing content " * 500)
        + "<main><h2>Current status</h2>All systems operational. "
        + "No active incidents.</main>"
        + "<footer>Privacy Terms Subscribe</footer>"
    )
    mock_aave_sources(
        direct_vm,
        noisy_status,
        "General security program information.",
    )
    direct_vm.mock_llm(
        r"SOURCE_ID: AAVE_OPERATIONAL_STATUS[\s\S]*All systems operational",
        '{"state": "NO_ACTIVE_INCIDENT"}',
    )
    direct_vm.mock_llm(
        r"SOURCE_ID: AAVE_SECURITY",
        '{"state": "NON_CONTRADICTORY_CONTEXT"}',
    )

    result = contract.diagnose_protocol_security(protocol)

    assert result["current_status_state"] == "NO_ACTIVE_INCIDENT"
    assert result["decision"] == "APPROVE"
