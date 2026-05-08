// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {PasskeyAccount} from "../src/PasskeyAccount.sol";
import {PasskeyAccountFactory} from "../src/PasskeyAccountFactory.sol";
import {WebAuthn} from "../src/lib/WebAuthn.sol";

/// @notice Targets validation paths via real `EntryPoint.handleOps` calls.
/// A failed signature surfaces as `FailedOp(0, "AA24 signature error")`.
contract PasskeyAccountTest is Test {
    EntryPoint internal entryPoint;
    PasskeyAccountFactory internal factory;
    address payable internal beneficiary = payable(address(0xBEEF));
    address internal recipient = address(0xCAFE);

    uint256 internal ownerKey = 0xA11CE;
    address internal owner;

    function setUp() public {
        entryPoint = new EntryPoint();
        factory = new PasskeyAccountFactory(IEntryPoint(address(entryPoint)), address(0));
        owner = vm.addr(ownerKey);
    }

    // --- Factory ---

    function test_Factory_DeploysAtCounterfactualAddress() public {
        PasskeyAccount.Signer memory s = _eoaSigner(owner);
        bytes32 salt = bytes32(uint256(1));
        address predicted = factory.getAddress(salt, s);

        PasskeyAccount account = factory.createAccount(salt, s);

        assertEq(address(account), predicted, "deployed != predicted");

        (PasskeyAccount.SignerKind kind, address eoa, , ) = account.signer();
        assertEq(uint8(kind), uint8(PasskeyAccount.SignerKind.Eoa));
        assertEq(eoa, owner);
    }

    function test_Factory_IsIdempotent() public {
        PasskeyAccount.Signer memory s = _eoaSigner(owner);
        bytes32 salt = bytes32(uint256(2));

        PasskeyAccount first = factory.createAccount(salt, s);
        PasskeyAccount second = factory.createAccount(salt, s);

        assertEq(address(first), address(second), "second call deployed a different account");
    }

    // --- ECDSA signer path ---

    function test_HandleOps_AcceptsValidEoaSignature() public {
        PasskeyAccount account = factory.createAccount(bytes32(uint256(3)), _eoaSigner(owner));
        vm.deal(address(account), 1 ether);

        PackedUserOperation memory op = _opTransferring(address(account), 0.1 ether);
        op.signature = _signEthHash(entryPoint.getUserOpHash(op), ownerKey);

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        entryPoint.handleOps(ops, beneficiary);

        assertEq(recipient.balance, 0.1 ether, "transfer didn't land");
    }

    function test_HandleOps_RejectsInvalidEoaSignature() public {
        PasskeyAccount account = factory.createAccount(bytes32(uint256(4)), _eoaSigner(owner));
        vm.deal(address(account), 1 ether);

        PackedUserOperation memory op = _opTransferring(address(account), 0.1 ether);
        op.signature = _signEthHash(entryPoint.getUserOpHash(op), 0xBADBAD);

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.expectRevert(
            abi.encodeWithSelector(
                IEntryPoint.FailedOp.selector,
                uint256(0),
                "AA24 signature error"
            )
        );
        entryPoint.handleOps(ops, beneficiary);

        assertEq(recipient.balance, 0, "transfer should not have occurred");
    }

    // --- Passkey signer path (RIP-7212 precompile mocked) ---

    function test_HandleOps_AcceptsPasskeyWhenPrecompileReturnsOne() public {
        PasskeyAccount account = factory.createAccount(bytes32(uint256(5)), _passkeySigner());
        vm.deal(address(account), 1 ether);

        PackedUserOperation memory op = _opTransferring(address(account), 0.1 ether);
        op.signature = _passkeySignature(entryPoint.getUserOpHash(op));

        // Mock the RIP-7212 precompile to accept any (hash, r, s, x, y).
        vm.mockCall(address(0x100), bytes(""), abi.encode(uint256(1)));

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        entryPoint.handleOps(ops, beneficiary);

        assertEq(recipient.balance, 0.1 ether, "passkey-signed transfer didn't land");
    }

    function test_HandleOps_RejectsPasskeyWhenPrecompileReturnsZero() public {
        PasskeyAccount account = factory.createAccount(bytes32(uint256(6)), _passkeySigner());
        vm.deal(address(account), 1 ether);

        PackedUserOperation memory op = _opTransferring(address(account), 0.1 ether);
        op.signature = _passkeySignature(entryPoint.getUserOpHash(op));

        vm.mockCall(address(0x100), bytes(""), abi.encode(uint256(0)));

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.expectRevert(
            abi.encodeWithSelector(
                IEntryPoint.FailedOp.selector,
                uint256(0),
                "AA24 signature error"
            )
        );
        entryPoint.handleOps(ops, beneficiary);
    }

    function test_HandleOps_RejectsPasskeyOnChallengeMismatch() public {
        PasskeyAccount account = factory.createAccount(bytes32(uint256(7)), _passkeySigner());
        vm.deal(address(account), 1 ether);

        PackedUserOperation memory op = _opTransferring(address(account), 0.1 ether);
        // Sign over a *different* hash than the actual userOp hash.
        op.signature = _passkeySignature(keccak256("not-the-real-op"));

        // Even if the precompile would accept, the challenge mismatch must
        // reject first.
        vm.mockCall(address(0x100), bytes(""), abi.encode(uint256(1)));

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.expectRevert(
            abi.encodeWithSelector(
                IEntryPoint.FailedOp.selector,
                uint256(0),
                "AA24 signature error"
            )
        );
        entryPoint.handleOps(ops, beneficiary);
    }

    // --- helpers ---

    function _eoaSigner(address eoa) private pure returns (PasskeyAccount.Signer memory) {
        return PasskeyAccount.Signer({
            kind: PasskeyAccount.SignerKind.Eoa,
            eoa: eoa,
            pubKeyX: 0,
            pubKeyY: 0
        });
    }

    function _passkeySigner() private pure returns (PasskeyAccount.Signer memory) {
        return PasskeyAccount.Signer({
            kind: PasskeyAccount.SignerKind.Passkey,
            eoa: address(0),
            pubKeyX: 1,
            pubKeyY: 2
        });
    }

    function _opTransferring(address sender, uint256 value)
        private
        view
        returns (PackedUserOperation memory op)
    {
        op.sender = sender;
        op.nonce = entryPoint.getNonce(sender, 0);
        op.callData = abi.encodeCall(PasskeyAccount.execute, (recipient, value, ""));
        op.accountGasLimits = bytes32((uint256(500_000) << 128) | uint256(500_000));
        op.preVerificationGas = 50_000;
        op.gasFees = bytes32((uint256(1 gwei) << 128) | uint256(1 gwei));
    }

    function _signEthHash(bytes32 hash, uint256 key) private pure returns (bytes memory) {
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(hash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, ethHash);
        return abi.encodePacked(r, s, v);
    }

    function _passkeySignature(bytes32 challenge) private pure returns (bytes memory) {
        bytes memory authenticatorData = new bytes(37);
        authenticatorData[32] = 0x01; // user-presence bit set

        string memory prefix = '{"type":"webauthn.get","challenge":"';
        string memory suffix = '","origin":"https://example.test"}';
        string memory cd = string.concat(prefix, _b64url(challenge), suffix);
        // challengeIndex points at the start of  "challenge":"  inside cd.
        // prefix is `{"type":"webauthn.get","challenge":"` (length 36),
        // and  "challenge":"  itself is 13 bytes — so the index is 36 - 13 = 23.
        uint256 idx = bytes(prefix).length - bytes('"challenge":"').length;

        WebAuthn.Signature memory sig = WebAuthn.Signature({
            authenticatorData: authenticatorData,
            clientDataJSON: cd,
            challengeIndex: idx,
            r: 0xAABB,
            s: 0xCCDD
        });
        return abi.encode(sig);
    }

    function _b64url(bytes32 input) private pure returns (string memory) {
        bytes memory ALPHA =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        bytes memory out = new bytes(43);
        uint256 idx;
        for (uint256 i = 0; i < 30; i += 3) {
            uint256 packed = (uint256(uint8(input[i])) << 16) |
                (uint256(uint8(input[i + 1])) << 8) |
                uint256(uint8(input[i + 2]));
            out[idx++] = ALPHA[(packed >> 18) & 0x3f];
            out[idx++] = ALPHA[(packed >> 12) & 0x3f];
            out[idx++] = ALPHA[(packed >> 6) & 0x3f];
            out[idx++] = ALPHA[packed & 0x3f];
        }
        uint256 packed2 = (uint256(uint8(input[30])) << 8) | uint256(uint8(input[31]));
        out[idx++] = ALPHA[(packed2 >> 10) & 0x3f];
        out[idx++] = ALPHA[(packed2 >> 4) & 0x3f];
        out[idx++] = ALPHA[(packed2 << 2) & 0x3f];
        return string(out);
    }
}
