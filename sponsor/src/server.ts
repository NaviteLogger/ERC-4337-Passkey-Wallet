import {Hono} from "hono";
import {serve} from "@hono/node-server";
import {getAddress, isAddress, type Hex} from "viem";
import {evaluate, loadPolicy} from "./policy";
import {buildPaymasterAndData, getSponsorHash} from "./sign";
import type {SponsorErrorBody, SponsorRequest, SponsorResponse} from "./types";

const PAYMASTER_VERIFICATION_GAS_LIMIT = 150_000n;
const PAYMASTER_POST_OP_GAS_LIMIT = 50_000n;

export function createApp(env: NodeJS.ProcessEnv = process.env) {
    const app = new Hono();
    const policy = loadPolicy(env);
    const paymaster = env.PAYMASTER_ADDRESS;
    const chainId = env.CHAIN_ID;
    const sponsorKey = env.SPONSOR_PRIVATE_KEY;
    if (!paymaster || !isAddress(paymaster)) throw new Error("PAYMASTER_ADDRESS missing/invalid");
    if (!chainId) throw new Error("CHAIN_ID missing");
    if (!sponsorKey || !sponsorKey.startsWith("0x")) {
        throw new Error("SPONSOR_PRIVATE_KEY missing/invalid");
    }
    const paymasterAddr = getAddress(paymaster);
    const chainIdBig = BigInt(chainId);

    app.get("/health", (c) => c.json({ok: true, paymaster: paymasterAddr, chainId: Number(chainIdBig)}));

    app.post("/sponsor", async (c) => {
        let body: SponsorRequest;
        try {
            body = (await c.req.json()) as SponsorRequest;
        } catch {
            return c.json<SponsorErrorBody>({error: "invalid_json"}, 400);
        }

        if (!body.userOp || !body.target) {
            return c.json<SponsorErrorBody>(
                {error: "missing_fields", detail: "userOp and target are required"},
                400,
            );
        }
        if (!isAddress(body.target)) {
            return c.json<SponsorErrorBody>({error: "invalid_target"}, 400);
        }

        const decision = evaluate(policy, body.target);
        if (!decision.ok) {
            return c.json<SponsorErrorBody>({error: "policy_denied", detail: decision.reason}, 403);
        }

        const now = Math.floor(Date.now() / 1000);
        const validAfter = now;
        const validUntil = now + policy.validityWindowSeconds;

        const digest = getSponsorHash({
            userOp: body.userOp,
            paymaster: paymasterAddr,
            chainId: chainIdBig,
            validUntil,
            validAfter,
            paymasterVerificationGasLimit: PAYMASTER_VERIFICATION_GAS_LIMIT,
            paymasterPostOpGasLimit: PAYMASTER_POST_OP_GAS_LIMIT,
        });

        const paymasterAndData = await buildPaymasterAndData({
            sponsorPrivateKey: sponsorKey as Hex,
            paymaster: paymasterAddr,
            paymasterVerificationGasLimit: PAYMASTER_VERIFICATION_GAS_LIMIT,
            paymasterPostOpGasLimit: PAYMASTER_POST_OP_GAS_LIMIT,
            validUntil,
            validAfter,
            digest,
        });

        const response: SponsorResponse = {paymasterAndData, validUntil, validAfter};
        return c.json(response);
    });

    return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const port = Number(process.env.PORT ?? 4000);
    const app = createApp();
    serve({fetch: app.fetch, port}, ({port: actualPort}) => {
        console.log(`sponsor service listening on :${actualPort}`);
    });
}
