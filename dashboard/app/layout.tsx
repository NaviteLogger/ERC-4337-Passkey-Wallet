import type {Metadata} from "next";
import "./globals.css";
import {Providers} from "./providers";

export const metadata: Metadata = {
    title: "ERC-4337 Passkey Wallet",
    description:
        "ERC-4337 v0.7 smart wallet that accepts an EOA owner or a WebAuthn passkey. Gas paid by an off-chain-signed sponsor paymaster.",
};

export default function RootLayout({children}: {children: React.ReactNode}) {
    return (
        <html lang="en">
            <body>
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
