"""Cross-contract direct tests for MANDATE's treasury enforcement gate."""

import pytest

from glsim.engine import SimEngine
from glsim.state import StateStore


AAVE_PROTOCOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2"


def mock_security_decision(engine, decision):
    engine.vm.mock_web(
        r"status\.aave\.com",
        {"status": 200, "body": "All systems operational. No active incidents."},
    )
    engine.vm.mock_web(
        r"aave\.com/security",
        {"status": 200, "body": "Official security and incident-response information."},
    )
    status_state, context_state = {
        "APPROVE": ("NO_ACTIVE_INCIDENT", "NON_CONTRADICTORY_CONTEXT"),
        "REJECT": ("ACTIVE_INCIDENT", "NON_CONTRADICTORY_CONTEXT"),
        "UNDETERMINED": ("UNCLEAR", "NON_CONTRADICTORY_CONTEXT"),
    }[decision]
    engine.vm.mock_llm(
        r"SOURCE_ID: AAVE_OPERATIONAL_STATUS",
        '{"state": "' + status_state + '"}',
    )
    engine.vm.mock_llm(
        r"SOURCE_ID: AAVE_SECURITY",
        '{"state": "' + context_state + '"}',
    )


@pytest.fixture
def mandate_treasury():
    engine = SimEngine(StateStore())
    engine.activate()
    try:
        mandate_address, _ = engine.deploy("contracts/mandate.py")

        treasury_address, _ = engine.deploy(
            "contracts/target_treasury.py",
            args=[mandate_address, 100],
        )
        treasury_ref = treasury_address
        protocol = AAVE_PROTOCOL
        yield engine, mandate_address, treasury_address, treasury_ref, protocol
    finally:
        engine.deactivate()


def test_allowed_allocation_executes_through_mandate(mandate_treasury):
    engine, mandate_address, treasury_address, treasury_ref, protocol = mandate_treasury
    mock_security_decision(engine, "APPROVE")

    engine.call_method(
        mandate_address,
        "execute_allocation",
        [treasury_ref, protocol, 15],
    )

    assert engine.call_method(
        treasury_address, "get_allocation", [protocol]
    ) == 15


def test_rejected_allocation_does_not_change_treasury(mandate_treasury):
    engine, mandate_address, treasury_address, treasury_ref, protocol = mandate_treasury
    engine.vm.strict_mocks = True

    with pytest.raises(Exception, match="Allocation rejected by MANDATE policy"):
        engine.call_method(
            mandate_address,
            "execute_allocation",
            [treasury_ref, protocol, 40],
        )

    assert engine.call_method(
        treasury_address, "get_allocation", [protocol]
    ) == 0


def test_direct_treasury_bypass_is_rejected(mandate_treasury):
    engine, _, treasury_address, _, protocol = mandate_treasury

    with pytest.raises(Exception, match="Only MANDATE may allocate treasury funds"):
        engine.call_method(
            treasury_address,
            "record_allocation",
            [protocol, 15],
            sender="0x" + "11" * 20,
        )

    assert engine.call_method(
        treasury_address, "get_allocation", [protocol]
    ) == 0


def test_public_allocation_addresses_accept_studio_strings(mandate_treasury):
    engine, mandate_address, treasury_address, treasury_ref, protocol = mandate_treasury
    mock_security_decision(engine, "APPROVE")

    assert isinstance(treasury_ref, str)
    assert isinstance(protocol, str)
    engine.call_method(
        mandate_address,
        "execute_allocation",
        [treasury_ref, protocol, 15],
    )

    assert engine.call_method(treasury_address, "get_allocation", [protocol]) == 15


def test_incremental_allocations_cannot_bypass_cumulative_cap(mandate_treasury):
    engine, mandate_address, treasury_address, treasury_ref, protocol = mandate_treasury
    mock_security_decision(engine, "APPROVE")

    engine.call_method(
        mandate_address,
        "execute_allocation",
        [treasury_ref, protocol, 15],
    )
    with pytest.raises(Exception, match="Allocation rejected by MANDATE policy"):
        engine.call_method(
            mandate_address,
            "execute_allocation",
            [treasury_ref, protocol, 11],
        )

    assert engine.call_method(
        treasury_address, "get_allocation", [protocol]
    ) == 15


def test_active_incident_rejects_without_treasury_change(mandate_treasury):
    engine, mandate_address, treasury_address, treasury_ref, protocol = mandate_treasury
    mock_security_decision(engine, "REJECT")

    with pytest.raises(Exception, match="Security decision: REJECT"):
        engine.call_method(
            mandate_address,
            "execute_allocation",
            [treasury_ref, protocol, 15],
        )

    assert engine.call_method(treasury_address, "get_allocation", [protocol]) == 0


def test_undetermined_incident_blocks_treasury_change(mandate_treasury):
    engine, mandate_address, treasury_address, treasury_ref, protocol = mandate_treasury
    mock_security_decision(engine, "UNDETERMINED")

    with pytest.raises(Exception, match="Security decision: UNDETERMINED"):
        engine.call_method(
            mandate_address,
            "execute_allocation",
            [treasury_ref, protocol, 15],
        )

    assert engine.call_method(treasury_address, "get_allocation", [protocol]) == 0


def test_diagnostic_does_not_mutate_treasury(mandate_treasury):
    engine, mandate_address, treasury_address, _, protocol = mandate_treasury
    mock_security_decision(engine, "APPROVE")

    result = engine.call_method(
        mandate_address,
        "diagnose_protocol_security",
        [protocol],
    )

    assert result["decision"] == "APPROVE"
    assert engine.call_method(treasury_address, "get_allocation", [protocol]) == 0
