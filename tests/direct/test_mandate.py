"""Direct-mode smoke test for the minimal MANDATE contract scaffold."""


def test_health(direct_deploy):
    contract = direct_deploy("contracts/mandate.py")

    assert contract.health() == "MANDATE_READY"


def test_fifteen_percent_allocation_is_allowed(direct_deploy):
    contract = direct_deploy("contracts/mandate.py")

    assert contract.is_allocation_allowed(100, 15) is True


def test_twenty_five_percent_allocation_is_allowed(direct_deploy):
    contract = direct_deploy("contracts/mandate.py")

    assert contract.is_allocation_allowed(100, 25) is True


def test_forty_percent_allocation_is_rejected(direct_deploy):
    contract = direct_deploy("contracts/mandate.py")

    assert contract.is_allocation_allowed(100, 40) is False


def test_zero_treasury_is_rejected(direct_deploy):
    contract = direct_deploy("contracts/mandate.py")

    assert contract.is_allocation_allowed(0, 0) is False


def test_zero_allocation_is_allowed_for_positive_treasury(direct_deploy):
    contract = direct_deploy("contracts/mandate.py")

    assert contract.is_allocation_allowed(100, 0) is True


def test_integer_unit_boundary_rounds_cap_down(direct_deploy):
    contract = direct_deploy("contracts/mandate.py")

    assert contract.is_allocation_allowed(101, 25) is True
    assert contract.is_allocation_allowed(101, 26) is False


def test_allocation_above_total_funds_is_rejected(direct_deploy):
    contract = direct_deploy("contracts/mandate.py")

    assert contract.is_allocation_allowed(100, 101) is False
