"use client";

import "@rainbow-me/rainbowkit/styles.css";
import {RainbowKitProvider, getDefaultConfig, darkTheme} from "@rainbow-me/rainbowkit";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {WagmiProvider} from "wagmi";
import {sepolia} from "wagmi/chains";

const wagmiConfig = getDefaultConfig({
    appName: "ERC-4337 Passkey Wallet",
    projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "00000000000000000000000000000000",
    chains: [sepolia],
    ssr: true,
});

const queryClient = new QueryClient();

export function Providers({children}: {children: React.ReactNode}) {
    return (
        <WagmiProvider config={wagmiConfig}>
            <QueryClientProvider client={queryClient}>
                <RainbowKitProvider theme={darkTheme()} modalSize="compact">
                    {children}
                </RainbowKitProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
}
