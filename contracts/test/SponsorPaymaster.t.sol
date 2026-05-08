// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {PasskeyAccount} from "../src/PasskeyAccount.sol";
import {PasskeyAccountFactory} from "../src/PasskeyAccountFactory.sol";
import {SponsorPaymaster} from "../src/SponsorPaymaster.sol";

contract SponsorPaymasterTest is Test {
    EntryPoint internal entryPoint;
    PasskeyAccountFactory internal factory;
    SponsorPaymaster internal paymaster;
    PasskeyAccount internal account;

    address payable internal beneficiary = payable(address(0xBEEF));
    address internal recipient = address(0xCAFE);

    uint256 internal ownerKey = 0xA11CE;
    uint256 internal sponsorKey = 0x5A7E;
    address internal owner;
    address internal sponsor;

    function setUp() public {
        entryPoint = new EntryPoint();
        factory = new PasskeyAccountFactory(IEntryPoint(address(entryPoint)), address(0));
        owner = vm.addr(ownerKey);
        sponsor = vm.addr(sponsorKey);

        paymaster = new SponsorPaymaster(IEntryPoint(address(entryPoint)), address(this), sponsor);
        // Stake & deposit so the EntryPoint accepts paymaster usage.
        paymaster.deposit{value: 1 ether}();
        paymaster.addStake{value: 1 ether}(uint32(1 days));

        account = factory.createAccount(
            bytes32(uint256(1)),
            PasskeyAccount.Signer({
                kind: PasskeyAccount.SignerKind.Eoa,
                eoa: owner,
                pubKeyX: 0,
                pubKeyY: 0
            })
        );
    }

    function test_HandleOps_PaymasterSponsorsValidSignedOp() public {
        // Account holds zero ETH — every wei comes from paymaster.
        PackedUserOperation memory op = _opTransferring(0); // value transfer = 0; tx itself costs gas
        op.callData = abi.encodeCall(PasskeyAccount.execute, (recipient, 0, ""));

        uint48 validUntil = uint48(block.timestamp + 1 hours);
        uint48 validAfter = uint48(block.timestamp);
        op = _attachPaymasterAndData(op, validUntil, validAfter);
        op.signature = _signEthHash(entryPoint.getUserOpHash(op), ownerKey);

        uint256 paymasterDepositBefore = entryPoint.balanceOf(address(paymaster));

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        entryPoint.handleOps(ops, beneficiary);

        // Account never received gas funding — paymaster paid.
        assertEq(address(account).balance, 0, "account balance must remain zero");
        assertGt(
            paymasterDepositBefore,
            entryPoint.balanceOf(address(paymaster)),
            "paymaster deposit must have decreased"
        );
    }

    function test_HandleOps_PaymasterRejectsBadSponsorSignature() public {
        PackedUserOperation memory op = _opTransferring(0);
        op.callData = abi.encodeCall(PasskeyAccount.execute, (recipient, 0, ""));

        uint48 validUntil = uint48(block.timestamp + 1 hours);
        uint48 validAfter = uint48(block.timestamp);

        // Use the *wrong* key for the paymaster signature.
        op = _attachPaymasterAndDataSignedBy(op, validUntil, validAfter, 0xBADBAD);
        op.signature = _signEthHash(entryPoint.getUserOpHash(op), ownerKey);

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        // EntryPoint reports paymaster validation failure as AA34.
        vm.expectRevert(
            abi.encodeWithSelector(
                IEntryPoint.FailedOp.selector,
                uint256(0),
                "AA34 signature error"
            )
        );
        entryPoint.handleOps(ops, beneficiary);
    }

    function test_HandleOps_PaymasterRejectsExpiredSponsorship() public {
        vm.warp(2 hours);
        PackedUserOperation memory op = _opTransferring(0);
        op.callData = abi.encodeCall(PasskeyAccount.execute, (recipient, 0, ""));

        uint48 validUntil = uint48(block.timestamp - 1); // already expired
        uint48 validAfter = uint48(block.timestamp - 1 hours);
        op = _attachPaymasterAndData(op, validUntil, validAfter);
        op.signature = _signEthHash(entryPoint.getUserOpHash(op), ownerKey);

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        // EntryPoint surfaces expired validity as AA32.
        vm.expectRevert(
            abi.encodeWithSelector(
                IEntryPoint.FailedOp.selector,
                uint256(0),
                "AA32 paymaster expired or not due"
            )
        );
        entryPoint.handleOps(ops, beneficiary);
    }

    function test_SetSponsorSigner_OnlyOwner() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert();
        paymaster.setSponsorSigner(address(0xCAFE));

        paymaster.setSponsorSigner(address(0xCAFE));
        assertEq(paymaster.sponsorSigner(), address(0xCAFE));
    }

    // --- helpers ---

    function _opTransferring(uint256 /* value */)
        private
        view
        returns (PackedUserOperation memory op)
    {
        op.sender = address(account);
        op.nonce = entryPoint.getNonce(address(account), 0);
        op.accountGasLimits = bytes32((uint256(500_000) << 128) | uint256(500_000));
        op.preVerificationGas = 50_000;
        op.gasFees = bytes32((uint256(1 gwei) << 128) | uint256(1 gwei));
    }

    function _attachPaymasterAndData(
        PackedUserOperation memory op,
        uint48 validUntil,
        uint48 validAfter
    ) private view returns (PackedUserOperation memory) {
        return _attachPaymasterAndDataSignedBy(op, validUntil, validAfter, sponsorKey);
    }

    function _attachPaymasterAndDataSignedBy(
        PackedUserOperation memory op,
        uint48 validUntil,
        uint48 validAfter,
        uint256 signerKey
    ) private view returns (PackedUserOperation memory) {
        // Pre-fill paymasterAndData with the gas limits + a zero-byte signature
        // so getHash() can read the validation gas limits without committing to
        // the eventual signature.
        bytes memory header = abi.encodePacked(
            address(paymaster),
            uint128(150_000), // paymasterVerificationGasLimit
            uint128(50_000), // paymasterPostOpGasLimit
            bytes6(uint48ToBytes6(validUntil)),
            bytes6(uint48ToBytes6(validAfter))
        );
        op.paymasterAndData = abi.encodePacked(header, new bytes(65));

        bytes32 digest = paymaster.getHash(op, validUntil, validAfter);
        bytes32 ethDigest = MessageHashUtils.toEthSignedMessageHash(digest);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, ethDigest);

        op.paymasterAndData = abi.encodePacked(header, r, s, v);
        return op;
    }

    function _signEthHash(bytes32 hash, uint256 key) private pure returns (bytes memory) {
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(hash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, ethHash);
        return abi.encodePacked(r, s, v);
    }

    function uint48ToBytes6(uint48 x) private pure returns (bytes6) {
        return bytes6(uint48(x));
    }

    receive() external payable {}
}
