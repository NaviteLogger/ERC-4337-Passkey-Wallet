import {describe, expect, test} from "vitest";
import {pad, toHex, type Address} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {createApp} from "../src/server";
import type {PackedUserOpJson, SponsorResponse} from "../src/types";

const SPONSOR_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const PAYMASTER = "0x0000000000000000000000000000000000000aaa" as Address;
const TARGET = "0x000000000000000000000000000000000000beef" as Address;
const NON_TARGET = "0x000000000000000000000000000000000000bad1" as Address;

const ENV = {
    SPONSOR_PRIVATE_KEY: SPONSOR_KEY,
    PAYMASTER_ADDRESS: PAYMASTER,
    CHAIN_ID: "11155111",
    ALLOWED_TARGETS: TARGET,
    VALIDITY_WINDOW_SECONDS: "600",
} as unknown as NodeJS.ProcessEnv;

function fakeUserOp(): PackedUserOpJson {
    return {
        sender: "0x000000000000000000000000000000000000000a",
        nonce: "0",
        initCode: "0x",
        callData: "0x",
        accountGasLimits: pad(toHex(500_000n), {size: 32}),
        preVerificationGas: "50000",
        gasFees: pad(toHex(1_000_000_000n), {size: 32}),
        paymasterAndData: "0x",
        signature: "0x",
    };
}

describe("POST /sponsor", () => {
    test("signs paymasterAndData when target is in allowlist", async () => {
        const app = createApp(ENV);
        const res = await app.request("/sponsor", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({userOp: fakeUserOp(), target: TARGET}),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as SponsorResponse;

        expect(body.paymasterAndData.toLowerCase().startsWith(PAYMASTER)).toBe(true);
        // 20 + 16 + 16 + 6 + 6 + 65 = 129 bytes = 258 hex chars + "0x"
        expect(body.paymasterAndData.length).toBe(2 + 129 * 2);
        expect(body.validUntil).toBeGreaterThan(body.validAfter);

        // Sanity: the configured sponsor key resolves to the well-known Anvil account #1.
        expect(privateKeyToAccount(SPONSOR_KEY).address).toBe(
            "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        );
    });

    test("rejects target not in allowlist", async () => {
        const app = createApp(ENV);
        const res = await app.request("/sponsor", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({userOp: fakeUserOp(), target: NON_TARGET}),
        });
        expect(res.status).toBe(403);
    });

    test("fails closed when allowlist is empty", async () => {
        const app = createApp({...ENV, ALLOWED_TARGETS: ""});
        const res = await app.request("/sponsor", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({userOp: fakeUserOp(), target: TARGET}),
        });
        expect(res.status).toBe(403);
    });

    test("rejects malformed body", async () => {
        const app = createApp(ENV);
        const res = await app.request("/sponsor", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: "not-json",
        });
        expect(res.status).toBe(400);
    });
});
