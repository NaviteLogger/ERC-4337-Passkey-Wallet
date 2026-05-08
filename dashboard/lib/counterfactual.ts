import type {Address, Hex, PublicClient} from "viem";

export const PASSKEY_ACCOUNT_FACTORY_ABI = [
    {
        type: "function",
        name: "getAddress",
        stateMutability: "view",
        inputs: [
            {name: "salt", type: "bytes32"},
            {
                name: "initial",
                type: "tuple",
                components: [
                    {name: "kind", type: "uint8"},
                    {name: "eoa", type: "address"},
                    {name: "pubKeyX", type: "uint256"},
                    {name: "pubKeyY", type: "uint256"},
                ],
            },
        ],
        outputs: [{type: "address"}],
    },
    {
        type: "function",
        name: "createAccount",
        stateMutability: "nonpayable",
        inputs: [
            {name: "salt", type: "bytes32"},
            {
                name: "initial",
                type: "tuple",
                components: [
                    {name: "kind", type: "uint8"},
                    {name: "eoa", type: "address"},
                    {name: "pubKeyX", type: "uint256"},
                    {name: "pubKeyY", type: "uint256"},
                ],
            },
        ],
        outputs: [{type: "address"}],
    },
    {
        type: "function",
        name: "accountImplementation",
        stateMutability: "view",
        inputs: [],
        outputs: [{type: "address"}],
    },
] as const;

export type SignerKind = "eoa" | "passkey";

export interface SignerInput {
    kind: SignerKind;
    eoa?: Address;
    pubKeyX?: bigint;
    pubKeyY?: bigint;
}

export function toContractTuple(s: SignerInput) {
    return {
        kind: s.kind === "eoa" ? 1 : 2,
        eoa: s.eoa ?? ("0x0000000000000000000000000000000000000000" as Address),
        pubKeyX: s.pubKeyX ?? 0n,
        pubKeyY: s.pubKeyY ?? 0n,
    } as const;
}

/**
 * Ask the factory for the deterministic address it would deploy.
 * Pure view call — works even if no account exists at that address yet.
 */
export async function predictAccountAddress(
    client: PublicClient,
    factory: Address,
    salt: Hex,
    signer: SignerInput,
): Promise<Address> {
    return client.readContract({
        address: factory,
        abi: PASSKEY_ACCOUNT_FACTORY_ABI,
        functionName: "getAddress",
        args: [salt, toContractTuple(signer)],
    });
}
