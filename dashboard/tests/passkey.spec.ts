import {test, expect, type CDPSession, type Page} from "@playwright/test";

/**
 * Drives the WebAuthn enrolment flow end-to-end using Chromium's virtual
 * authenticator. Asserts that:
 *   - the resulting public key is rendered (uncompressed 0x04 || X || Y)
 *   - the X / Y coordinates are 32-byte hex strings parseable as bigints
 *   - the button transitions to its post-enrolment state
 */
test.describe("/passkey", () => {
    let cdp: CDPSession;
    let authenticatorId: string;

    test.beforeEach(async ({page}) => {
        cdp = await page.context().newCDPSession(page);
        await cdp.send("WebAuthn.enable");
        const {authenticatorId: id} = await cdp.send("WebAuthn.addVirtualAuthenticator", {
            options: {
                protocol: "ctap2",
                transport: "internal",
                hasResidentKey: true,
                hasUserVerification: true,
                isUserVerified: true,
                automaticPresenceSimulation: true,
            },
        });
        authenticatorId = id;
    });

    test.afterEach(async () => {
        if (authenticatorId) {
            await cdp.send("WebAuthn.removeVirtualAuthenticator", {authenticatorId});
        }
    });

    test("enrols a passkey and renders the P-256 public key", async ({page}) => {
        await page.goto("/passkey");
        await expect(page.getByRole("heading", {name: /Passkey enrolment/})).toBeVisible();

        await page.getByTestId("enrol-button").click();

        // Wait for the result card to appear (authenticator round-trip).
        await expect(page.getByTestId("passkey-result")).toBeVisible({timeout: 15_000});

        const pubKeyHex = await page.getByTestId("pubkey-hex").innerText();
        expect(pubKeyHex.startsWith("0x04")).toBe(true);
        // 0x + 04 + 32-byte X + 32-byte Y = 2 + 130 = 132 chars
        expect(pubKeyHex.length).toBe(132);

        const x = await page.getByTestId("pubkey-x").innerText();
        const y = await page.getByTestId("pubkey-y").innerText();
        expect(x).toMatch(/^0x[0-9a-fA-F]{64}$/);
        expect(y).toMatch(/^0x[0-9a-fA-F]{64}$/);
        expect(BigInt(x)).toBeGreaterThan(0n);
        expect(BigInt(y)).toBeGreaterThan(0n);

        // After enrolment the button is disabled (the page takes one passkey).
        await expect(page.getByTestId("enrol-button")).toBeDisabled();
    });

    test("shows the credentialId when the authenticator returns one", async ({page}) => {
        await page.goto("/passkey");
        await page.getByTestId("enrol-button").click();
        await expect(page.getByTestId("passkey-result")).toBeVisible({timeout: 15_000});

        const credId = await page.getByTestId("credential-id").innerText();
        // base64url, no padding
        expect(credId).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(credId.length).toBeGreaterThan(8);
    });

    test("explains the missing factory env without crashing", async ({page}) => {
        await page.goto("/passkey");
        await page.getByTestId("enrol-button").click();
        await expect(page.getByTestId("passkey-result")).toBeVisible({timeout: 15_000});
        // Default env has the zero factory address → counterfactual fallback notice.
        await expect(page.getByTestId("counterfactual-missing")).toBeVisible();
    });
});

async function _silenceUnusedImport(_p: Page) {
    void _p;
}
void _silenceUnusedImport;
