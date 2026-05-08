# ERC-4337 Passkey Wallet

An ERC-4337 v0.7 smart wallet that accepts **either** an EOA owner (secp256k1)
**or** a WebAuthn passkey (secp256r1) as its sole signer. Gas is paid by an
off-chain-signed sponsor paymaster, never by the connected wallet. The pattern
mirrors Coinbase Smart Wallet's "either/or" signer model and demonstrates the
three things every account-abstraction codebase has to get right:

1. A custom **account** with pluggable signer types and a structured signature layout.
2. A **factory** that returns deterministic, counterfactual addresses before deployment.
3. A **paymaster** that gates sponsorship under a verifiable off-chain policy.

## What ships

| Layer       | Path                       | Highlights                                                                                  |
| ----------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| Contracts   | `contracts/`               | Foundry. Pinned to `eth-infinitism/account-abstraction@v0.7.0`. EntryPoint via canonical addr. |
| Sponsor svc | `sponsor/`                 | Hono server. Holds sponsor key, applies allowlist policy, signs `paymasterAndData`. OpenAPI 3.0. |
| Dashboard   | `dashboard/`               | Next.js 14 + wagmi + RainbowKit. Two demo pages: counterfactual EOA flow + WebAuthn enrolment. |

## Vulnerability classes covered

This isn't a security lab — but the contracts are written defensively against
the classes you'd expect in a 4337 codebase:

| Class                          | Where it lives                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| Cross-chain replay             | Paymaster digest binds `block.chainid`, `address(this)`, validity window.               |
| Cross-paymaster replay         | Digest binds the paymaster address itself.                                              |
| Signature-over-signature       | Paymaster digest excludes the sig field of `paymasterAndData` — see `getHash()`.        |
| Self-upgrade abuse             | UUPS `_authorizeUpgrade` gated to `address(this)` or the EntryPoint only.               |
| Front-run on factory deploy    | `createAccount` is idempotent — second call with same salt returns the same proxy.      |
| Forged WebAuthn challenge      | `WebAuthn.verify` checks the b64url-encoded challenge appears at `challengeIndex`.      |

## What's verified

| Suite                                 | Status                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `forge test` — `contracts/`           | **11/11 passing** (factory determinism, EOA accept/reject, passkey accept/reject via mocked precompile, challenge mismatch, paymaster sign/window/authority). |
| `vitest` — `sponsor/`                 | **4/4 passing** (signing round-trip, allowlist enforcement, fail-closed, malformed-body).                    |
| `playwright` — `dashboard/`           | **10/10 passing** (landing, demo layout, env-warning gating, real WebAuthn enrolment via virtual authenticator). |
| `redocly lint` — `sponsor/openapi.yaml` | valid                                                                                                      |
| `npm run build` — `dashboard/`        | green                                                                                                        |
| `npm run typecheck` — both Node packages | green                                                                                                     |

## Repo layout

```
contracts/                              Foundry — account, factory, paymaster
  src/PasskeyAccount.sol                ERC-4337 v0.7, EOA or P-256 signer
  src/PasskeyAccountFactory.sol         CREATE2 + ERC-1967 proxy, idempotent
  src/SponsorPaymaster.sol              Verifying paymaster signed under (validUntil, validAfter)
  src/lib/WebAuthn.sol                  P-256 signature verifier (RIP-7212 + fallback)
  test/PasskeyAccount.t.sol             7 tests
  test/SponsorPaymaster.t.sol           4 tests
  script/Deploy.s.sol                   Deployment script
  lib/account-abstraction (v0.7.0)
  lib/openzeppelin-contracts
sponsor/                                Off-chain sponsor service
  src/server.ts                         Hono app
  src/policy.ts                         Allowlist + window
  src/sign.ts                           paymasterAndData construction (mirrors getHash() in Solidity)
  test/server.test.ts                   vitest
  openapi.yaml                          OpenAPI 3.0
dashboard/                              Next.js 14 + wagmi + RainbowKit
  app/page.tsx                          Catalog
  app/demo/page.tsx                     EOA → counterfactual → sponsored UserOp
  app/passkey/page.tsx                  WebAuthn enrolment + counterfactual
  app/api/sponsor/route.ts              Server-side proxy to the sponsor service
  lib/counterfactual.ts                 factory.getAddress wrapper
  lib/passkey.ts                        navigator.credentials wrapper, exports P-256 (x, y)
  tests/                                Playwright (landing, demo, passkey)
```

## Quickstart

### 1. Foundry contracts

```bash
git clone --recurse-submodules <repo-url>
git submodule update --init --recursive
( cd contracts && forge build && forge test -vv )
```

### 2. Sponsor service

```bash
cd sponsor
cp .env.example .env
# Edit .env: set SPONSOR_PRIVATE_KEY, PAYMASTER_ADDRESS, ALLOWED_TARGETS
npm install
npm test            # vitest
npm run lint:openapi
npm run dev         # http://localhost:4000/health
```

### 3. Dashboard

```bash
cd dashboard
cp .env.example .env.local
# Edit .env.local: set NEXT_PUBLIC_FACTORY_ADDRESS, NEXT_PUBLIC_PAYMASTER_ADDRESS,
# NEXT_PUBLIC_BUNDLER_URL, NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
npm install
npm run typecheck
npm run build
npm run dev         # http://localhost:3000

# E2E:
npm run test:e2e:install
npm run test:e2e
```

### 4. Deploy on Sepolia (optional)

```bash
cd contracts
export RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<key>
export PRIVATE_KEY=0x...
export SPONSOR_SIGNER=0x...   # sponsor service's signing address
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --private-key $PRIVATE_KEY
```

The script uses the canonical EntryPoint at `0x0000000071727De22E5E9d8BAf0edAc6f37da032`
on Sepolia/mainnet, and deploys a fresh one on chains where it isn't present.

## How the sponsorship signature works

The dashboard sends a `PackedUserOperation` to `/api/sponsor`, which forwards
to the off-chain sponsor service. The service:

1. Loads the allowlist policy (env-driven). If the target address isn't allowlisted, it returns `403 policy_denied`.
2. Sets `validAfter = now`, `validUntil = now + window`.
3. Computes the digest:
   ```
   keccak256(abi.encode(
       userOp.sender,
       userOp.nonce,
       keccak256(initCode),
       keccak256(callData),
       accountGasLimits,
       gasLimitsAndPaymaster,         // bytes32 from paymasterAndData[20:52]
       preVerificationGas,
       gasFees,
       chainId,
       paymaster,
       validUntil,
       validAfter
   ))
   ```
4. Signs it as an EIP-191 message with the sponsor private key.
5. Returns `paymasterAndData` already packed in the v0.7 layout:
   `paymaster (20) ‖ verifGas (16) ‖ postOpGas (16) ‖ validUntil (6) ‖ validAfter (6) ‖ sig (65)`.

`SponsorPaymaster.getHash()` in Solidity recomputes the exact same digest at
validation time and compares the recovered signer against `sponsorSigner`.

## How Sui zkLogin compares

Account abstraction on Ethereum is a contract-level retrofit: you wrap an EOA
(or a passkey) in a smart-contract account, lean on a separate paymaster for
gas, and rely on a bundler to serialise UserOps into transactions. The
EntryPoint, the factory, the paymaster, and the WebAuthn verifier all run as
deployed Solidity.

Sui's [zkLogin](https://docs.sui.io/concepts/cryptography/zklogin) makes
"login without a seed phrase" a **protocol-level** primitive instead. A user
authenticates with an OAuth provider (Google, Twitch, Apple), generates a zk
proof that they own that JWT, and signs Sui transactions directly with an
ephemeral key whose authority is derived from the OAuth identity. There is no
separate "smart account" contract because Sui's transaction format treats the
zkLogin signature as a first-class signature scheme, alongside Ed25519.

The trade-off:

- **ERC-4337**: more flexible (any signature scheme expressible in Solidity
  works, custom paymasters, recovery flows), but pays for that flexibility in
  the form of a multi-component stack (account, factory, paymaster, bundler,
  EntryPoint) and a per-UserOp gas overhead from contract-level validation.
- **zkLogin**: a single signature scheme, no per-account contracts, gas paid
  by the user — but the set of supported "login" methods is whatever the
  protocol designers blessed, and you cannot bring your own (e.g. plug a custom
  paymaster in front of it without the protocol's cooperation).

The same observation as the Move resource model in
[Smart Contract Security Lab](https://github.com/NaviteLogger/Smart-Contract-Security-Lab):
moving a guarantee from "library on top of a general VM" to "primitive built
into the protocol" buys safety / ergonomics at the cost of expressivity.

## License

MIT.
