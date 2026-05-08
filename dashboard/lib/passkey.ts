/**
 * Browser-side WebAuthn helpers. Wraps `navigator.credentials.create()` for
 * passkey enrolment and exports the resulting secp256r1 public key as the
 * (x, y) pair our PasskeyAccount stores on-chain.
 *
 * This module is "use client" only — it touches `navigator` and `crypto.subtle`.
 */

const RP_NAME = "ERC-4337 Passkey Wallet";
const RP_ID = typeof window !== "undefined" ? window.location.hostname : "localhost";

export interface EnrolledPasskey {
    credentialId: string; // base64url
    pubKeyX: bigint;
    pubKeyY: bigint;
    pubKeyHex: string; // 0x04 || X || Y, hex
}

export async function enrolPasskey(label: string): Promise<EnrolledPasskey> {
    if (!("credentials" in navigator)) {
        throw new Error("WebAuthn not supported in this browser");
    }

    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));

    const credential = (await navigator.credentials.create({
        publicKey: {
            challenge,
            rp: {name: RP_NAME, id: RP_ID},
            user: {
                id: userId,
                name: label,
                displayName: label,
            },
            pubKeyCredParams: [{type: "public-key", alg: -7}], // ES256 (secp256r1)
            authenticatorSelection: {
                authenticatorAttachment: "platform",
                userVerification: "preferred",
                residentKey: "preferred",
            },
            attestation: "none",
            timeout: 60_000,
        },
    })) as PublicKeyCredential | null;

    if (!credential) throw new Error("passkey enrolment cancelled");

    const response = credential.response as AuthenticatorAttestationResponse;
    const pubKeyDer = response.getPublicKey();
    if (!pubKeyDer) throw new Error("authenticator did not return a public key");

    const pubKey = await crypto.subtle.importKey(
        "spki",
        pubKeyDer,
        {name: "ECDSA", namedCurve: "P-256"},
        true,
        ["verify"],
    );
    const raw = await crypto.subtle.exportKey("raw", pubKey);
    const rawBytes = new Uint8Array(raw);
    if (rawBytes.length !== 65 || rawBytes[0] !== 0x04) {
        throw new Error("expected uncompressed P-256 public key");
    }

    const x = bytesToBigint(rawBytes.subarray(1, 33));
    const y = bytesToBigint(rawBytes.subarray(33, 65));
    return {
        credentialId: bytesToBase64Url(new Uint8Array(credential.rawId)),
        pubKeyX: x,
        pubKeyY: y,
        pubKeyHex: "0x" + bytesToHex(rawBytes),
    };
}

function bytesToBigint(bytes: Uint8Array): bigint {
    let out = 0n;
    for (const b of bytes) out = (out << 8n) | BigInt(b);
    return out;
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
