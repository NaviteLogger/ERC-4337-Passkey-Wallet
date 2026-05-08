// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {PasskeyAccount} from "./PasskeyAccount.sol";

/**
 * @title PasskeyAccountFactory
 * @notice CREATE2 factory for `PasskeyAccount`. Bundlers / clients call
 *         `createAccount` from a UserOperation's initCode; off-chain code uses
 *         `getAddress` to derive the counterfactual address before deploy.
 */
contract PasskeyAccountFactory {
    PasskeyAccount public immutable accountImplementation;

    constructor(IEntryPoint entryPoint, address p256FallbackVerifier) {
        accountImplementation = new PasskeyAccount(entryPoint, p256FallbackVerifier);
    }

    /// @notice Deploy a new account if one doesn't exist at the counterfactual
    /// address. Idempotent — second call with the same args returns the same
    /// address without reverting.
    function createAccount(
        bytes32 salt,
        PasskeyAccount.Signer calldata initial
    ) external returns (PasskeyAccount account) {
        address predicted = getAddress(salt, initial);
        if (predicted.code.length > 0) {
            return PasskeyAccount(payable(predicted));
        }
        account = PasskeyAccount(
            payable(
                new ERC1967Proxy{salt: salt}(
                    address(accountImplementation),
                    abi.encodeCall(PasskeyAccount.initialize, (initial))
                )
            )
        );
    }

    /// @notice Counterfactual address for the proxy that `createAccount` would deploy.
    function getAddress(
        bytes32 salt,
        PasskeyAccount.Signer calldata initial
    ) public view returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(ERC1967Proxy).creationCode,
            abi.encode(
                address(accountImplementation),
                abi.encodeCall(PasskeyAccount.initialize, (initial))
            )
        );
        return Create2.computeAddress(salt, keccak256(bytecode));
    }
}
