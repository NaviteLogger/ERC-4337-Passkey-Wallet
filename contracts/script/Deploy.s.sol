// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PasskeyAccountFactory} from "../src/PasskeyAccountFactory.sol";
import {SponsorPaymaster} from "../src/SponsorPaymaster.sol";

/// @notice Deploys factory + paymaster against the canonical v0.7 EntryPoint.
/// On Sepolia/mainnet/etc. that's 0x0000000071727De22E5E9d8BAf0edAc6f37da032.
/// On a fresh Anvil chain, deploy a local EntryPoint first.
contract Deploy is Script {
    function run() external {
        address entryPointAddr = vm.envOr(
            "ENTRY_POINT",
            address(0x0000000071727De22E5E9d8BAf0edAc6f37da032)
        );
        address sponsorSigner = vm.envAddress("SPONSOR_SIGNER");
        address fallbackVerifier = vm.envOr("P256_FALLBACK_VERIFIER", address(0));

        vm.startBroadcast();

        // If the EntryPoint isn't already at the canonical address (e.g. on
        // local Anvil), deploy a fresh one and use it.
        IEntryPoint entryPoint;
        if (entryPointAddr.code.length == 0) {
            entryPoint = new EntryPoint();
            console2.log("Deployed local EntryPoint:", address(entryPoint));
        } else {
            entryPoint = IEntryPoint(entryPointAddr);
            console2.log("Using existing EntryPoint:", entryPointAddr);
        }

        PasskeyAccountFactory factory = new PasskeyAccountFactory(entryPoint, fallbackVerifier);
        SponsorPaymaster paymaster =
            new SponsorPaymaster(entryPoint, msg.sender, sponsorSigner);

        vm.stopBroadcast();

        console2.log("PasskeyAccountFactory:", address(factory));
        console2.log("SponsorPaymaster:     ", address(paymaster));
        console2.log("Sponsor signer:       ", sponsorSigner);
    }
}
