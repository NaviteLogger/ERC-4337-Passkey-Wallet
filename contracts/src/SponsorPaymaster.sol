// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BasePaymaster} from "account-abstraction/core/BasePaymaster.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {UserOperationLib} from "account-abstraction/core/UserOperationLib.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SponsorPaymaster
 * @notice ERC-4337 v0.7 paymaster that pays gas for any UserOp signed by an
 *         off-chain sponsor key under a (validUntil, validAfter) policy window.
 * @dev Layout of `paymasterAndData` after the 20-byte paymaster address +
 *      32-byte gas limits header:
 *          6 bytes  validUntil  (uint48, big-endian)
 *          6 bytes  validAfter  (uint48, big-endian)
 *          65 bytes signature   (sponsorSigner over getHash())
 *
 *      The signed digest binds (userOp fields, chainid, paymaster, validity
 *      window) so a sponsorship cannot be replayed across chains, paymasters,
 *      or windows.
 */
contract SponsorPaymaster is BasePaymaster {
    using UserOperationLib for PackedUserOperation;

    uint256 private constant SIGNATURE_OFFSET = 12; // 6 + 6
    // PAYMASTER_VALIDATION_GAS_OFFSET (20) and PAYMASTER_DATA_OFFSET (52) are
    // already declared on BasePaymaster.

    address public sponsorSigner;

    event SponsorSignerChanged(address indexed previous, address indexed current);

    error InvalidSponsorData();

    constructor(IEntryPoint anEntryPoint, address initialOwner, address initialSponsor)
        BasePaymaster(anEntryPoint)
    {
        _transferOwnership(initialOwner);
        sponsorSigner = initialSponsor;
        emit SponsorSignerChanged(address(0), initialSponsor);
    }

    function setSponsorSigner(address next) external onlyOwner {
        emit SponsorSignerChanged(sponsorSigner, next);
        sponsorSigner = next;
    }

    /// @notice Compute the digest the off-chain sponsor signs to authorise a UserOp.
    function getHash(PackedUserOperation calldata userOp, uint48 validUntil, uint48 validAfter)
        public
        view
        returns (bytes32)
    {
        // Slice `paymasterAndData` to the two gas limits but exclude the signature itself.
        bytes32 gasLimitsAndPaymaster = bytes32(
            userOp.paymasterAndData[PAYMASTER_VALIDATION_GAS_OFFSET:PAYMASTER_DATA_OFFSET]
        );
        return keccak256(
            abi.encode(
                userOp.sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.accountGasLimits,
                gasLimitsAndPaymaster,
                userOp.preVerificationGas,
                userOp.gasFees,
                block.chainid,
                address(this),
                validUntil,
                validAfter
            )
        );
    }

    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32, /* userOpHash */
        uint256 /* maxCost */
    ) internal view override returns (bytes memory context, uint256 validationData) {
        bytes calldata data = userOp.paymasterAndData[PAYMASTER_DATA_OFFSET:];
        if (data.length != SIGNATURE_OFFSET + 65) revert InvalidSponsorData();

        uint48 validUntil = uint48(bytes6(data[0:6]));
        uint48 validAfter = uint48(bytes6(data[6:12]));
        bytes calldata sig = data[12:77];

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(getHash(userOp, validUntil, validAfter));
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
        bool sigOk = err == ECDSA.RecoverError.NoError && recovered == sponsorSigner;

        return ("", _packValidationData(!sigOk, validUntil, validAfter));
    }

    /// @dev Pack into the EIP-4337 validationData layout: aggregator(20) | validUntil(6) | validAfter(6).
    /// Aggregator == 0 ⇒ accept; aggregator == 1 ⇒ reject.
    function _packValidationData(bool sigFailed, uint48 validUntil, uint48 validAfter)
        private
        pure
        returns (uint256)
    {
        return (sigFailed ? 1 : 0) | (uint256(validUntil) << 160) | (uint256(validAfter) << 208);
    }
}
