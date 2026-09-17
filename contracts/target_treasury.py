# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

import genlayer as gl
from genlayer.types import *


class TargetTreasury(gl.contract.Contract):
    """Minimal allocation ledger protected by a single MANDATE contract."""

    mandate_address: Address
    total_funds: u256
    allocations: gl.storage.TreeMap[Address, u256]

    def __init__(self, mandate_address: str, total_funds: u256):
        if total_funds == 0:
            raise gl.vm.UserError("Treasury funds must be positive")

        self.mandate_address = Address(mandate_address)
        self.total_funds = total_funds

    @gl.public.view
    def get_total_funds(self) -> u256:
        return self.total_funds

    @gl.public.view
    def get_allocation(self, protocol: str) -> u256:
        return self.allocations.get(Address(protocol), 0)

    @gl.public.write
    def record_allocation(self, protocol: str, amount: u256) -> None:
        if gl.message.sender_address != self.mandate_address:
            raise gl.vm.UserError("Only MANDATE may allocate treasury funds")

        protocol_address = Address(protocol)
        self.allocations[protocol_address] = (
            self.allocations.get(protocol_address, 0) + amount
        )
