// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IncomingFundsGuardAccount} from "../../src/base/IncomingFundsGuardAccount.sol";
import {IncomingFundsGuardFactory} from "../../src/base/IncomingFundsGuardFactory.sol";
import {BaseProtectionVault} from "../../src/base/BaseProtectionVault.sol";
import {GuardTypes} from "../../src/base/libraries/GuardTypes.sol";
import {TestERC20, FeeOnTransferTestERC20} from "../mocks/TestERC20.sol";

contract RevertingVault {
    function createPosition(address, address, uint256, uint64, uint64) external pure returns (uint256) {
        revert("VAULT_FAILURE");
    }
}

contract ReentrantVault {
    IERC20 internal immutable token;
    IncomingFundsGuardAccount internal guard;
    bool public reentryBlocked;

    constructor(IERC20 token_) {
        token = token_;
    }

    function setGuard(IncomingFundsGuardAccount guard_) external {
        guard = guard_;
    }

    function createPosition(address, address, uint256 amount, uint64, uint64) external returns (uint256) {
        (bool success,) = address(guard).call(abi.encodeCall(IncomingFundsGuardAccount.process, ()));
        reentryBlocked = !success;
        token.transferFrom(msg.sender, address(this), amount);
        return 77;
    }
}

contract IncomingFundsGuardTest is Test {
    IncomingFundsGuardFactory internal factory;
    BaseProtectionVault internal vault;
    TestERC20 internal token;
    IncomingFundsGuardAccount internal guard;

    address internal owner = makeAddr("owner");
    address internal processor = makeAddr("processor");
    bytes32 internal constant RULE_ID = keccak256("incoming-usdc-rule");
    uint256 internal constant THRESHOLD = 500e6;

    function setUp() public {
        vault = new BaseProtectionVault();
        token = new TestERC20();
        factory = new IncomingFundsGuardFactory(address(token), address(vault));
        guard = IncomingFundsGuardAccount(_deployGuard(_config(address(token), address(vault), RULE_ID)));
    }

    function testFactoryWiringIsImmutableAndEnforced() public {
        assertEq(factory.asset(), address(token));
        assertEq(factory.protectionVault(), address(vault));

        TestERC20 otherToken = new TestERC20();
        GuardTypes.IncomingGuardConfig memory wrongAsset =
            _config(address(otherToken), address(vault), keccak256("wrong-asset"));
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(IncomingFundsGuardFactory.InvalidAsset.selector, address(otherToken), address(token))
        );
        factory.createIncomingGuard(wrongAsset);

        BaseProtectionVault otherVault = new BaseProtectionVault();
        GuardTypes.IncomingGuardConfig memory wrongVault =
            _config(address(token), address(otherVault), keccak256("wrong-vault"));
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(IncomingFundsGuardFactory.InvalidVault.selector, address(otherVault), address(vault))
        );
        factory.createIncomingGuard(wrongVault);
    }

    function testRejectsZeroRuleId() public {
        vm.prank(owner);
        vm.expectRevert(IncomingFundsGuardAccount.ZeroRuleId.selector);
        factory.createIncomingGuard(_config(address(token), address(vault), bytes32(0)));
    }

    function testRejectsFactoryDependenciesWithoutCode() public {
        vm.expectRevert(
            abi.encodeWithSelector(IncomingFundsGuardAccount.AddressHasNoCode.selector, makeAddr("no-code-token"))
        );
        new IncomingFundsGuardFactory(makeAddr("no-code-token"), address(vault));

        vm.expectRevert(
            abi.encodeWithSelector(IncomingFundsGuardAccount.AddressHasNoCode.selector, makeAddr("no-code-vault"))
        );
        new IncomingFundsGuardFactory(address(token), makeAddr("no-code-vault"));
    }

    function testDeterministicAddressAndDiscovery() public {
        GuardTypes.IncomingGuardConfig memory config = _config(address(token), address(vault), keccak256("second-rule"));
        address predicted = factory.predictIncomingGuardAddress(config);
        address deployed = _deployGuard(config);
        assertEq(deployed, predicted);
        assertEq(factory.guardForRule(owner, config.ruleId), deployed);
        assertEq(factory.guardCountOf(owner), 2);
        assertEq(factory.guardsOf(owner)[1], deployed);
    }

    function testRejectsDuplicateOwnerRule() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IncomingFundsGuardFactory.GuardAlreadyExists.selector, owner, RULE_ID, address(guard)
            )
        );
        vm.prank(owner);
        factory.createIncomingGuard(_config(address(token), address(vault), RULE_ID));
    }

    function testOnlyConfiguredOwnerCanCreateGuard() public {
        GuardTypes.IncomingGuardConfig memory config =
            _config(address(token), address(vault), keccak256("unauthorized-create"));
        vm.prank(processor);
        vm.expectRevert(
            abi.encodeWithSelector(IncomingFundsGuardFactory.UnauthorizedCreator.selector, processor, owner)
        );
        factory.createIncomingGuard(config);
        assertEq(factory.guardForRule(owner, config.ruleId), address(0));
    }

    function testThresholdBelowEqualAndAboveBoundary() public {
        token.mint(address(guard), THRESHOLD - 1);
        vm.expectRevert(
            abi.encodeWithSelector(IncomingFundsGuardAccount.BalanceBelowThreshold.selector, THRESHOLD - 1, THRESHOLD)
        );
        guard.process();

        token.mint(address(guard), 1);
        guard.process();
        assertEq(guard.totalProcessed(), THRESHOLD);

        token.mint(address(guard), THRESHOLD + 1);
        guard.process();
        assertEq(guard.totalProcessed(), THRESHOLD * 2 + 1);
    }

    function testSeventyThirtySplitAndExactVaultDeposit() public {
        token.mint(address(guard), THRESHOLD);
        vm.prank(processor);
        uint256 positionId = guard.process();

        assertEq(token.balanceOf(owner), 150e6);
        assertEq(token.balanceOf(address(vault)), 350e6);
        BaseProtectionVault.Position memory position = vault.getPosition(positionId);
        assertEq(position.totalDeposited, 350e6);
        assertEq(position.beneficiary, owner);
        assertEq(position.endTimestamp - position.startTimestamp, 30 days);
        assertEq(token.balanceOf(address(guard)), 0);
    }

    function testOneHundredPercentProtection() public {
        IncomingFundsGuardAccount fullGuard = _createGuard(10_000, keccak256("full"), 1);
        token.mint(address(fullGuard), 501);
        fullGuard.process();
        assertEq(token.balanceOf(owner), 0);
        assertEq(vault.getPosition(1).totalDeposited, 501);
        assertEq(token.balanceOf(address(fullGuard)), 0);
    }

    function testVerySmallProtectBpsAndRoundingDown() public {
        IncomingFundsGuardAccount tinyGuard = _createGuard(1, keccak256("tiny"), 10_000);
        token.mint(address(tinyGuard), 19_999);
        tinyGuard.process();
        assertEq(vault.getPosition(1).totalDeposited, 1);
        assertEq(token.balanceOf(owner), 19_998);
    }

    function testRejectsThresholdThatRoundsProtectionToZero() public {
        GuardTypes.IncomingGuardConfig memory config = _config(address(token), address(vault), keccak256("zero-round"));
        config.threshold = 9_999;
        config.protectBps = 1;
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(IncomingFundsGuardAccount.ThresholdProducesZeroProtection.selector, 9_999, 1)
        );
        factory.createIncomingGuard(config);
    }

    function testMultipleDepositsAccumulateAndMultipleCycles() public {
        token.mint(address(guard), 200e6);
        token.mint(address(guard), 300e6);
        guard.process();
        token.mint(address(guard), 700e6);
        guard.process();

        assertEq(guard.processingCount(), 2);
        assertEq(guard.totalProcessed(), 1_200e6);
        assertEq(vault.positionCount(), 2);
        assertEq(token.balanceOf(owner), 360e6);
        assertEq(token.balanceOf(address(vault)), 840e6);
    }

    function testPermissionlessProcessorCannotRedirectFunds() public {
        token.mint(address(guard), THRESHOLD);
        vm.prank(processor);
        guard.process();
        assertEq(token.balanceOf(processor), 0);
        assertEq(token.balanceOf(owner), 150e6);
        assertEq(vault.getPosition(1).beneficiary, owner);
    }

    function testConfigurationIsFixedAndNoMutationSelectorsExist() public {
        assertEq(guard.owner(), owner);
        assertEq(address(guard.asset()), address(token));
        assertEq(address(guard.protectionVault()), address(vault));
        assertEq(guard.threshold(), THRESHOLD);
        assertEq(guard.protectBps(), 7_000);
        assertEq(guard.releaseDuration(), 30 days);
        assertEq(guard.ruleId(), RULE_ID);

        (bool ownerMutation,) = address(guard).call(abi.encodeWithSignature("setOwner(address)", processor));
        (bool ruleMutation,) = address(guard).call(abi.encodeWithSignature("setRule(uint256,uint16)", 1, 1));
        assertFalse(ownerMutation);
        assertFalse(ruleMutation);
    }

    function testAllowanceResetAndCannotProcessSameFundsTwice() public {
        token.mint(address(guard), THRESHOLD);
        guard.process();
        assertEq(token.allowance(address(guard), address(vault)), 0);
        vm.expectRevert(abi.encodeWithSelector(IncomingFundsGuardAccount.BalanceBelowThreshold.selector, 0, THRESHOLD));
        guard.process();
    }

    function testVaultFailureRollsBackEntireSplit() public {
        RevertingVault badVault = new RevertingVault();
        IncomingFundsGuardAccount badGuard = IncomingFundsGuardAccount(
            _deployIsolatedGuard(_config(address(token), address(badVault), keccak256("bad-vault")))
        );
        token.mint(address(badGuard), THRESHOLD);

        vm.expectRevert("VAULT_FAILURE");
        badGuard.process();
        assertEq(token.balanceOf(address(badGuard)), THRESHOLD);
        assertEq(token.balanceOf(owner), 0);
        assertEq(badGuard.totalProcessed(), 0);
        assertEq(token.allowance(address(badGuard), address(badVault)), 0);
    }

    function testReentrantVaultCannotProcessTwice() public {
        ReentrantVault reentrantVault = new ReentrantVault(token);
        IncomingFundsGuardAccount reentrantGuard = IncomingFundsGuardAccount(
            _deployIsolatedGuard(_config(address(token), address(reentrantVault), keccak256("reentrant")))
        );
        reentrantVault.setGuard(reentrantGuard);
        token.mint(address(reentrantGuard), THRESHOLD);
        reentrantGuard.process();
        assertTrue(reentrantVault.reentryBlocked());
        assertEq(reentrantGuard.processingCount(), 1);
        assertEq(token.balanceOf(address(reentrantGuard)), 0);
    }

    function testRejectsFeeOnTransferTokenAtomically() public {
        FeeOnTransferTestERC20 feeToken = new FeeOnTransferTestERC20();
        IncomingFundsGuardAccount feeGuard = IncomingFundsGuardAccount(
            _deployIsolatedGuard(_config(address(feeToken), address(vault), keccak256("fee")))
        );
        feeToken.mint(address(feeGuard), THRESHOLD);
        vm.expectRevert(
            abi.encodeWithSelector(IncomingFundsGuardAccount.UnexpectedOwnerReceipt.selector, 150e6, 148_500_000)
        );
        feeGuard.process();
        assertEq(feeToken.balanceOf(address(feeGuard)), THRESHOLD);
        assertEq(feeToken.balanceOf(owner), 0);
    }

    function testFuzzSplitConservesProcessedAmount(uint96 amount, uint16 bps) public {
        amount = uint96(bound(amount, 10_000, type(uint96).max));
        bps = uint16(bound(bps, 1, 10_000));
        uint256 minimumThreshold = (10_000 + bps - 1) / bps;
        IncomingFundsGuardAccount fuzzGuard = _createGuard(bps, keccak256(abi.encode(amount, bps)), minimumThreshold);
        token.mint(address(fuzzGuard), amount);
        uint256 positionId = fuzzGuard.process();
        uint256 protectedAmount = vault.getPosition(positionId).totalDeposited;
        uint256 availableAmount = token.balanceOf(owner);
        assertEq(protectedAmount + availableAmount, amount);
        assertEq(protectedAmount, uint256(amount) * bps / 10_000);
        assertEq(fuzzGuard.totalProcessed(), amount);
        assertEq(token.balanceOf(address(fuzzGuard)), 0);
    }

    function testFuzzInvalidParameters(uint256 threshold_, uint16 bps, uint64 duration) public {
        GuardTypes.IncomingGuardConfig memory config = _config(address(token), address(vault), keccak256("invalid"));
        threshold_ = bound(threshold_, 0, 20_000);
        bps = uint16(bound(bps, 0, 10_001));
        duration = uint64(bound(duration, 0, 366 days));
        config.threshold = threshold_;
        config.protectBps = bps;
        config.releaseDuration = duration;

        bool validBps = bps > 0 && bps <= 10_000;
        bool nonZeroProtected = validBps && threshold_ >= (10_000 + bps - 1) / bps;
        bool valid = threshold_ > 0 && nonZeroProtected && duration >= 1 hours && duration <= 365 days;
        if (!valid) vm.expectRevert();
        address deployed = _deployGuard(config);
        if (valid) assertTrue(deployed != address(0));
    }

    function _createGuard(uint16 bps, bytes32 ruleId, uint256 threshold_) internal returns (IncomingFundsGuardAccount) {
        GuardTypes.IncomingGuardConfig memory config = _config(address(token), address(vault), ruleId);
        config.protectBps = bps;
        config.threshold = threshold_;
        return IncomingFundsGuardAccount(_deployGuard(config));
    }

    function _deployGuard(GuardTypes.IncomingGuardConfig memory config) internal returns (address guard_) {
        vm.prank(config.owner);
        return factory.createIncomingGuard(config);
    }

    function _deployIsolatedGuard(GuardTypes.IncomingGuardConfig memory config) internal returns (address guard_) {
        IncomingFundsGuardFactory isolatedFactory = new IncomingFundsGuardFactory(config.asset, config.vault);
        vm.prank(config.owner);
        return isolatedFactory.createIncomingGuard(config);
    }

    function _config(address asset_, address vault_, bytes32 ruleId)
        internal
        view
        returns (GuardTypes.IncomingGuardConfig memory)
    {
        return GuardTypes.IncomingGuardConfig({
            owner: owner,
            asset: asset_,
            vault: vault_,
            threshold: THRESHOLD,
            protectBps: 7_000,
            releaseDuration: 30 days,
            ruleId: ruleId
        });
    }
}
