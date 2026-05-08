"use client";

import {useState} from "react";
import Link from "next/link";
import {keccak256, stringToBytes, toHex, type Address, type Hex} from "viem";
import {createPublicClient, http} from "viem";
import {sepolia} from "viem/chains";
import {enrolPasskey, type EnrolledPasskey} from "@/lib/passkey";
import {predictAccountAddress} from "@/lib/counterfactual";

const FACTORY = process.env.NEXT_PUBLIC_FACTORY_ADDRESS as Address | undefined;

export default function PasskeyPage() {
    const [label, setLabel] = useState("portfolio-demo-key");
    const [passkey, setPasskey] = useState<EnrolledPasskey | null>(null);
    const [counterfactual, setCounterfactual] = useState<Address | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function onEnrol() {
        setError(null);
        setBusy(true);
        try {
            const result = await enrolPasskey(label);
            setPasskey(result);

            if (FACTORY && FACTORY !== "0x0000000000000000000000000000000000000000") {
                const client = createPublicClient({chain: sepolia, transport: http()});
                const salt = keccak256(stringToBytes(`passkey:${result.credentialId}`)) as Hex;
                const addr = await predictAccountAddress(client, FACTORY, salt, {
                    kind: "passkey",
                    pubKeyX: result.pubKeyX,
                    pubKeyY: result.pubKeyY,
                });
                setCounterfactual(addr);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    }

    return (
        <main>
            <p>
                <Link href="/">← back</Link>
            </p>
            <h1>Passkey enrolment</h1>
            <p>
                Creates a real WebAuthn credential on this device, exports the secp256r1 public
                key, and shows the <em>counterfactual</em> address — the deterministic on-chain
                address the PasskeyAccountFactory would deploy for it.
            </p>

            <div className="section">
                <label htmlFor="label">Credential label</label>
                <input
                    id="label"
                    data-testid="passkey-label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    disabled={busy || !!passkey}
                />
                <button
                    type="button"
                    data-testid="enrol-button"
                    onClick={onEnrol}
                    disabled={busy || !!passkey}
                >
                    {busy ? "waiting on authenticator…" : passkey ? "enrolled" : "Enrol passkey"}
                </button>
                {error && (
                    <p className="status-bad" data-testid="passkey-error">
                        {error}
                    </p>
                )}
            </div>

            {passkey && (
                <div className="section" data-testid="passkey-result">
                    <h2 style={{marginTop: 0}}>Public key</h2>
                    <dl className="kv">
                        <dt>credentialId</dt>
                        <dd data-testid="credential-id">{passkey.credentialId}</dd>
                        <dt>pubKey (uncompressed)</dt>
                        <dd data-testid="pubkey-hex">{passkey.pubKeyHex}</dd>
                        <dt>pubKey.x</dt>
                        <dd data-testid="pubkey-x">{toHex(passkey.pubKeyX, {size: 32})}</dd>
                        <dt>pubKey.y</dt>
                        <dd data-testid="pubkey-y">{toHex(passkey.pubKeyY, {size: 32})}</dd>
                    </dl>

                    <h2>Counterfactual account</h2>
                    {counterfactual ? (
                        <p data-testid="counterfactual-address">{counterfactual}</p>
                    ) : (
                        <p className="muted" data-testid="counterfactual-missing">
                            Set <code>NEXT_PUBLIC_FACTORY_ADDRESS</code> to a deployed
                            PasskeyAccountFactory to derive the address.
                        </p>
                    )}

                    <h2>What this means</h2>
                    <p>
                        Submitting a UserOperation signed by this passkey requires the chain to
                        verify a P-256 signature on-chain. Two paths:
                    </p>
                    <ul>
                        <li>
                            <strong>RIP-7212 precompile</strong> at <code>0x100</code> — live on
                            Optimism, Arbitrum, Polygon zkEVM, others. Not on Ethereum mainnet or
                            Sepolia.
                        </li>
                        <li>
                            <strong>Fallback verifier contract</strong> — pass a deployed verifier
                            address into <code>PasskeyAccount</code>&apos;s constructor; the
                            account staticcalls it when the precompile is missing.
                        </li>
                    </ul>
                </div>
            )}
        </main>
    );
}
