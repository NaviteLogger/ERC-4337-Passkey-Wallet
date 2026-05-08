import {
    concatHex,
    encodeAbiParameters,
    keccak256,
    pad,
    toBytes,
    toHex,
    type Address,
    type Hex,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import type {PackedUserOpJson} from "./types";

/**
 * Build the digest a SponsorPaymaster signs to authorise a UserOp.
 * Mirrors `SponsorPaymaster.getHash()` in Solidity exactly — keep them in sync.
 */
export function getSponsorHash(args: {
    userOp: PackedUserOpJson;
    paymaster: Address;
    chainId: bigint;
    validUntil: number;
    validAfter: number;
    paymasterVerificationGasLimit: bigint;
    paymasterPostOpGasLimit: bigint;
}): Hex {
    const {
        userOp,
        paymaster,
        chainId,
        validUntil,
        validAfter,
        paymasterVerificationGasLimit,
        paymasterPostOpGasLimit,
    } = args;

    // gasLimitsAndPaymaster = bytes32(paymasterAndData[20:52])
    // = uint128(paymasterVerificationGasLimit) | uint128(paymasterPostOpGasLimit)
    const gasLimitsAndPaymaster = concatHex([
        pad(toHex(paymasterVerificationGasLimit), {size: 16}),
        pad(toHex(paymasterPostOpGasLimit), {size: 16}),
    ]);

    return keccak256(
        encodeAbiParameters(
            [
                {type: "address"},
                {type: "uint256"},
                {type: "bytes32"},
                {type: "bytes32"},
                {type: "bytes32"},
                {type: "bytes32"},
                {type: "uint256"},
                {type: "bytes32"},
                {type: "uint256"},
                {type: "address"},
                {type: "uint48"},
                {type: "uint48"},
            ],
            [
                userOp.sender,
                BigInt(userOp.nonce),
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.accountGasLimits,
                gasLimitsAndPaymaster,
                BigInt(userOp.preVerificationGas),
                userOp.gasFees,
                chainId,
                paymaster,
                validUntil,
                validAfter,
            ],
        ),
    );
}

/**
 * Sign the digest as an EIP-191 ("personal_sign") message and pack the result
 * into the v0.7 paymasterAndData layout the SponsorPaymaster expects.
 */
export async function buildPaymasterAndData(args: {
    sponsorPrivateKey: Hex;
    paymaster: Address;
    paymasterVerificationGasLimit: bigint;
    paymasterPostOpGasLimit: bigint;
    validUntil: number;
    validAfter: number;
    digest: Hex;
}): Promise<Hex> {
    const account = privateKeyToAccount(args.sponsorPrivateKey);
    const signature = await account.signMessage({
        message: {raw: toBytes(args.digest)},
    });

    return concatHex([
        args.paymaster,
        pad(toHex(args.paymasterVerificationGasLimit), {size: 16}),
        pad(toHex(args.paymasterPostOpGasLimit), {size: 16}),
        pad(toHex(args.validUntil), {size: 6}),
        pad(toHex(args.validAfter), {size: 6}),
        signature,
    ]);
}
