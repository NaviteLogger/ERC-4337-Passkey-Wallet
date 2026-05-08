import type {Address, Hex} from "viem";

/**
 * v0.7 PackedUserOperation — what the dashboard sends in.
 * Strings are 0x-prefixed hex; bigints are decimal strings (wire-friendly).
 */
export interface PackedUserOpJson {
    sender: Address;
    nonce: string;
    initCode: Hex;
    callData: Hex;
    accountGasLimits: Hex;
    preVerificationGas: string;
    gasFees: Hex;
    paymasterAndData: Hex;
    signature: Hex;
}

export interface SponsorRequest {
    userOp: PackedUserOpJson;
    /** The address the UserOp's callData ultimately targets — used by the policy. */
    target: Address;
}

export interface SponsorResponse {
    paymasterAndData: Hex;
    validUntil: number;
    validAfter: number;
}

export interface SponsorErrorBody {
    error: string;
    detail?: string;
}
