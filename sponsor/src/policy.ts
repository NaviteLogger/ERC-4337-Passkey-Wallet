import type {Address} from "viem";
import {getAddress} from "viem";

export interface Policy {
    allowedTargets: Set<Address>;
    validityWindowSeconds: number;
}

export function loadPolicy(env: NodeJS.ProcessEnv): Policy {
    const raw = (env.ALLOWED_TARGETS ?? "").trim();
    const targets = raw.length === 0 ? [] : raw.split(",").map((t) => getAddress(t.trim()));
    const window = Number(env.VALIDITY_WINDOW_SECONDS ?? 600);
    if (!Number.isFinite(window) || window <= 0) {
        throw new Error("VALIDITY_WINDOW_SECONDS must be a positive integer");
    }
    return {
        allowedTargets: new Set(targets),
        validityWindowSeconds: window,
    };
}

export type PolicyDecision =
    | {ok: true}
    | {ok: false; reason: string};

export function evaluate(policy: Policy, target: Address): PolicyDecision {
    if (policy.allowedTargets.size === 0) {
        return {ok: false, reason: "policy is empty (fail-closed)"};
    }
    if (!policy.allowedTargets.has(getAddress(target))) {
        return {ok: false, reason: `target ${target} not in allowlist`};
    }
    return {ok: true};
}
