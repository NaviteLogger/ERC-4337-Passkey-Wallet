"use client";

import {useEffect, useState} from "react";
import Link from "next/link";
import {ConnectButton} from "@rainbow-me/rainbowkit";
import {useAccount, usePublicClient} from "wagmi";
import {keccak256, stringToBytes, type Address, type Hex} from "viem";
import {predictAccountAddress} from "@/lib/counterfactual";

const FACTORY = process.env.NEXT_PUBLIC_FACTORY_ADDRESS as Address | undefined;
const PAYMASTER = process.env.NEXT_PUBLIC_PAYMASTER_ADDRESS as Address | undefined;
const BUNDLER_URL = process.env.NEXT_PUBLIC_BUNDLER_URL ?? "";

const FACTORY_OK = FACTORY && FACTORY !== "0x0000000000000000000000000000000000000000";
const PAYMASTER_OK = PAYMASTER && PAYMASTER !== "0x0000000000000000000000000000000000000000";
const BUNDLER_OK = BUNDLER_URL && !BUNDLER_URL.includes("YOUR_KEY");

export default function DemoPage() {
    const {address, isConnected} = useAccount();
    const publicClient = usePublicClient();
    const [counterfactual, setCounterfactual] = useState<Address | null>(null);
    const [recipient, setRecipient] = useState<string>("0x000000000000000000000000000000000000beef");
    const [value, setValue] = useState<string>("0");
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        async function compute() {
            if (!isConnected || !address || !publicClient || !FACTORY_OK || !FACTORY) {
                setCounterfactual(null);
                return;
            }
            try {
                const salt = keccak256(stringToBytes(`eoa:${address}`)) as Hex;
                const addr = await predictAccountAddress(publicClient, FACTORY, salt, {
                    kind: "eoa",
                    eoa: address,
                });
                if (!cancelled) setCounterfactual(addr);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : String(err));
            }
        }
        compute();
        return () => {
            cancelled = true;
        };
    }, [address, isConnected, publicClient]);

    return (
        <main>
            <p>
                <Link href="/">← back</Link>
            </p>
            <h1>Sponsored UserOp demo</h1>

            <div className="section">
                <h2 style={{marginTop: 0}}>1. Connect EOA</h2>
                <p>
                    The connected EOA acts as the <em>signer</em> of the smart account — it never
                    holds ETH and never pays gas.
                </p>
                <ConnectButton />
                {isConnected && (
                    <dl className="kv" style={{marginTop: "0.75rem"}}>
                        <dt>signer EOA</dt>
                        <dd data-testid="signer-eoa">{address}</dd>
                    </dl>
                )}
            </div>

            <div className="section">
                <h2 style={{marginTop: 0}}>2. Counterfactual address</h2>
                {!FACTORY_OK ? (
                    <p className="muted" data-testid="factory-missing">
                        Set <code>NEXT_PUBLIC_FACTORY_ADDRESS</code> in <code>.env.local</code> to
                        a deployed PasskeyAccountFactory.
                    </p>
                ) : !isConnected ? (
                    <p className="muted">Connect a wallet first.</p>
                ) : counterfactual ? (
                    <div>
                        <p>
                            Address derived deterministically from{" "}
                            <code>(factory, salt, signer)</code>. The smart account does not yet
                            exist on-chain — the bundler will deploy it via the UserOperation&apos;s{" "}
                            <code>initCode</code> on first send.
                        </p>
                        <dl className="kv">
                            <dt>smart account</dt>
                            <dd data-testid="counterfactual-address">{counterfactual}</dd>
                            <dt>factory</dt>
                            <dd>{FACTORY}</dd>
                        </dl>
                    </div>
                ) : (
                    <p className="muted">deriving…</p>
                )}
                {error && <p className="status-bad">{error}</p>}
            </div>

            <div className="section">
                <h2 style={{marginTop: 0}}>3. Send sponsored transfer</h2>
                <p>
                    Build a UserOperation that transfers <code>value</code> wei to{" "}
                    <code>recipient</code>. The dashboard server proxies <code>/api/sponsor</code>{" "}
                    to the off-chain sponsor service, which signs <code>paymasterAndData</code>.
                    The bundler picks the op up; the EntryPoint pays the bundler from the
                    SponsorPaymaster&apos;s deposit.
                </p>
                <label htmlFor="recipient">recipient</label>
                <input
                    id="recipient"
                    data-testid="recipient-input"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                />
                <label htmlFor="value">value (wei)</label>
                <input
                    id="value"
                    data-testid="value-input"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                />
                <div className="row">
                    <button
                        type="button"
                        data-testid="send-userop"
                        disabled={!isConnected || !counterfactual || !PAYMASTER_OK || !BUNDLER_OK}
                    >
                        Send sponsored UserOp
                    </button>
                    {(!PAYMASTER_OK || !BUNDLER_OK) && (
                        <span className="muted" data-testid="env-warning">
                            (configure paymaster + bundler in <code>.env.local</code> to enable)
                        </span>
                    )}
                </div>
            </div>

            <div className="section">
                <h2 style={{marginTop: 0}}>What just happened</h2>
                <ol>
                    <li>
                        Predicting the counterfactual address calls{" "}
                        <code>factory.getAddress(salt, signer)</code> — a pure view, free.
                    </li>
                    <li>
                        Signing wallet-side and pushing to the bundler hands the EntryPoint a{" "}
                        <code>PackedUserOperation</code>; the EntryPoint validates the
                        account&apos;s signature, then the paymaster&apos;s.
                    </li>
                    <li>
                        Paymaster validation reads the off-chain-signed{" "}
                        <code>paymasterAndData</code> tail, recovers the signer, and accepts iff
                        it matches the configured <code>sponsorSigner</code>.
                    </li>
                </ol>
            </div>
        </main>
    );
}
