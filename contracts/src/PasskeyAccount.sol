// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseAccount} from "account-abstraction/core/BaseAccount.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {WebAuthn} from "./lib/WebAuthn.sol";

/**
 * @title PasskeyAccount
 * @notice ERC-4337 v0.7 account that accepts EITHER an EOA owner (secp256k1)
 *         OR a WebAuthn passkey (secp256r1) as its sole signer.
 * @dev Mirrors Coinbase Smart Wallet's "either/or" pattern. The signer kind is
 *      decided at initialise time; switching kinds requires a deliberate
 *      `replaceSigner` call (also gated by `onlyEntryPointOrSelf`).
 */
contract PasskeyAccount is BaseAccount, Initializable, UUPSUpgradeable {
    /// @dev Signature validation success / failure constants from EIP-4337.
    uint256 internal constant SIG_VALIDATION_SUCCESS = 0;
    uint256 internal constant SIG_VALIDATION_FAILED = 1;

    enum SignerKind {
        None,
        Eoa,
        Passkey
    }

    struct Signer {
        SignerKind kind;
        address eoa;
        uint256 pubKeyX;
        uint256 pubKeyY;
    }

    IEntryPoint private immutable _entryPoint;
    address public immutable p256FallbackVerifier;

    Signer public signer;

    event SignerReplaced(SignerKind kind);

    error NotFromSelfOrEntryPoint();

    constructor(IEntryPoint anEntryPoint, address fallbackVerifier) {
        _entryPoint = anEntryPoint;
        p256FallbackVerifier = fallbackVerifier;
        _disableInitializers();
    }

    function initialize(Signer calldata initial) external initializer {
        _setSigner(initial);
    }

    function entryPoint() public view override returns (IEntryPoint) {
        return _entryPoint;
    }

    /// @notice Replace the active signer. Must be invoked by the account itself
    /// (i.e. via a UserOperation) or by the EntryPoint on its behalf.
    function replaceSigner(Signer calldata next) external {
        _onlySelfOrEntryPoint();
        _setSigner(next);
    }

    /// @notice Execute a single call. Must come through the EntryPoint.
    function execute(address dest, uint256 value, bytes calldata data) external {
        _requireFromEntryPoint();
        (bool ok, bytes memory ret) = dest.call{value: value}(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    /// @notice Validate a UserOperation signature. Implements BaseAccount.
    /// @dev Reverts only if the signer kind is uninitialised; otherwise returns
    ///      a 4337 status word.
    function _validateSignature(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal view override returns (uint256) {
        if (signer.kind == SignerKind.Eoa) {
            return _validateEoa(userOp.signature, userOpHash);
        }
        if (signer.kind == SignerKind.Passkey) {
            return _validatePasskey(userOp.signature, userOpHash);
        }
        return SIG_VALIDATION_FAILED;
    }

    function _validateEoa(bytes calldata sig, bytes32 userOpHash) private view returns (uint256) {
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(userOpHash);
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(ethHash, sig);
        if (err != ECDSA.RecoverError.NoError || recovered != signer.eoa) {
            return SIG_VALIDATION_FAILED;
        }
        return SIG_VALIDATION_SUCCESS;
    }

    function _validatePasskey(
        bytes calldata sig,
        bytes32 userOpHash
    ) private view returns (uint256) {
        WebAuthn.Signature memory wa = abi.decode(sig, (WebAuthn.Signature));
        bool ok = WebAuthn.verify(
            userOpHash,
            wa,
            signer.pubKeyX,
            signer.pubKeyY,
            p256FallbackVerifier
        );
        return ok ? SIG_VALIDATION_SUCCESS : SIG_VALIDATION_FAILED;
    }

    function _setSigner(Signer memory next) private {
        if (next.kind == SignerKind.None) revert NotFromSelfOrEntryPoint(); // misuse
        if (next.kind == SignerKind.Eoa) {
            require(next.eoa != address(0), "PasskeyAccount: zero EOA");
        } else if (next.kind == SignerKind.Passkey) {
            require(next.pubKeyX != 0 && next.pubKeyY != 0, "PasskeyAccount: zero pubkey");
        }
        signer = next;
        emit SignerReplaced(next.kind);
    }

    function _onlySelfOrEntryPoint() private view {
        if (msg.sender != address(this) && msg.sender != address(_entryPoint)) {
            revert NotFromSelfOrEntryPoint();
        }
    }

    function _authorizeUpgrade(address) internal view override {
        _onlySelfOrEntryPoint();
    }

    receive() external payable {}
}
