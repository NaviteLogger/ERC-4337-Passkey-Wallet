import Link from "next/link";

export default function Home() {
    return (
        <main>
            <h1>ERC-4337 Passkey Wallet</h1>
            <p>
                A weekend-buildable smart wallet that demonstrates the three things every account
                abstraction codebase has to get right: a custom <em>account</em> with pluggable
                signers, a <em>factory</em> that returns counterfactual addresses, and a{" "}
                <em>paymaster</em> that sponsors gas under an off-chain policy.
            </p>

            <h2>What ships in the box</h2>
            <ul>
                <li>
                    <code>PasskeyAccount.sol</code> — accepts an EOA owner (secp256k1) <em>or</em> a
                    WebAuthn passkey (secp256r1). The Coinbase Smart Wallet pattern.
                </li>
                <li>
                    <code>PasskeyAccountFactory.sol</code> — ERC-1967 proxy via CREATE2; second
                    deployment with the same salt is a no-op (idempotent).
                </li>
                <li>
                    <code>SponsorPaymaster.sol</code> — verifying paymaster signed by an off-chain
                    sponsor key under a bound (validUntil, validAfter) window.
                </li>
                <li>
                    <code>sponsor/</code> — Hono service holding the sponsor key, allowlist policy,
                    and a hand-written OpenAPI 3.0 spec for the <code>/sponsor</code> endpoint.
                </li>
            </ul>

            <h2>Demos</h2>
            <div className="section" data-testid="link-demo">
                <h2 style={{marginTop: 0}}>
                    <Link href="/demo">/demo — counterfactual address + sponsored UserOp</Link>
                </h2>
                <p>
                    Connect MetaMask, derive the deterministic account address before deployment,
                    then send a sponsored transfer through Pimlico&apos;s bundler. Gas is paid by
                    the SponsorPaymaster — the connected EOA never holds ETH.
                </p>
            </div>

            <div className="section" data-testid="link-passkey">
                <h2 style={{marginTop: 0}}>
                    <Link href="/passkey">/passkey — WebAuthn enrolment</Link>
                </h2>
                <p>
                    Walks through <code>navigator.credentials.create()</code> with
                    secp256r1, displays the resulting public key, and shows the counterfactual
                    address for a passkey-owned account. Submitting a passkey-signed UserOp on-chain
                    requires a chain that exposes the RIP-7212 P256 precompile (or a deployed
                    verifier) — see the README.
                </p>
            </div>

            <h2>Verification gate</h2>
            <ul>
                <li>
                    <code>forge test</code> — 11 tests covering factory determinism, EOA
                    accept/reject, passkey accept/reject (RIP-7212 mocked), challenge mismatch, and
                    paymaster sign / window / authority.
                </li>
                <li>
                    <code>vitest</code> — 4 tests covering sponsor service signing, allowlist
                    enforcement, fail-closed, malformed-body handling.
                </li>
                <li>
                    <code>playwright</code> — wallet flow + counterfactual-address rendering on{" "}
                    <code>/demo</code>.
                </li>
                <li>
                    <code>redocly lint</code> — <code>sponsor/openapi.yaml</code>.
                </li>
            </ul>

            <p style={{marginTop: "2rem", fontSize: "0.85rem"}}>
                Source:{" "}
                <a href="https://github.com/NaviteLogger/ERC-4337-Passkey-Wallet">
                    github.com/NaviteLogger/ERC-4337-Passkey-Wallet
                </a>
            </p>
        </main>
    );
}
