// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {IncomingFundsGuardAccount} from "../../src/base/IncomingFundsGuardAccount.sol";
import {BaseProtectionVault} from "../../src/base/BaseProtectionVault.sol";
import {TestERC20} from "../mocks/TestERC20.sol";

contract IncomingGuardHandler is Test {
    TestERC20 public immutable token;
    IncomingFundsGuardAccount public immutable guard;
    uint256 public totalReceived;

    constructor(TestERC20 token_, IncomingFundsGuardAccount guard_) {
        token = token_;
        guard = guard_;
    }

    function deposit(uint96 amount) external {
        amount = uint96(bound(amount, 1, type(uint96).max));
        token.mint(address(guard), amount);
        totalReceived += amount;
    }

    function process() external {
        if (token.balanceOf(address(guard)) >= guard.threshold()) guard.process();
    }
}

contract IncomingFundsGuardInvariantTest is StdInvariant, Test {
    TestERC20 internal token;
    BaseProtectionVault internal vault;
    IncomingFundsGuardAccount internal guard;
    IncomingGuardHandler internal handler;
    address internal owner = makeAddr("invariant-owner");

    function setUp() public {
        token = new TestERC20();
        vault = new BaseProtectionVault();
        guard = new IncomingFundsGuardAccount(
            owner, address(token), address(vault), 500e18, 7_000, 30 days, keccak256("invariant-rule")
        );
        handler = new IncomingGuardHandler(token, guard);
        targetContract(address(handler));
    }

    function invariantProcessedNeverExceedsReceived() public view {
        assertLe(guard.totalProcessed(), handler.totalReceived());
        assertEq(guard.totalProcessed() + token.balanceOf(address(guard)), handler.totalReceived());
    }

    function invariantPrincipalAccountingAndRecipients() public view {
        uint256 received = handler.totalReceived();
        assertEq(token.balanceOf(address(guard)) + token.balanceOf(address(vault)) + token.balanceOf(owner), received);
        assertEq(token.balanceOf(address(handler)), 0);
    }

    function invariantEveryPositionBelongsToOwner() public view {
        uint256 count = vault.positionCount();
        assertEq(count, guard.processingCount());
        assertEq(token.allowance(address(guard), address(vault)), 0);
        for (uint256 id = 1; id <= count; ++id) {
            BaseProtectionVault.Position memory position = vault.getPosition(id);
            assertEq(position.beneficiary, owner);
            assertEq(position.asset, address(token));
        }
    }
}
