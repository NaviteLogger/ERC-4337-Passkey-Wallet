import {test, expect} from "@playwright/test";

test.describe("Landing", () => {
    test("renders hero + links to demo and passkey", async ({page}) => {
        await page.goto("/");
        await expect(page.getByRole("heading", {name: /ERC-4337 Passkey Wallet/})).toBeVisible();
        await expect(page.getByTestId("link-demo")).toBeVisible();
        await expect(page.getByTestId("link-passkey")).toBeVisible();
        // Source link present.
        await expect(
            page.getByRole("link", {name: /github\.com\/NaviteLogger\/ERC-4337-Passkey-Wallet/}),
        ).toBeVisible();
    });

    test("clicking the demo link opens /demo", async ({page}) => {
        await page.goto("/");
        await page.getByTestId("link-demo").getByRole("link").click();
        await page.waitForURL(/\/demo$/, {timeout: 30_000});
        await expect(page.getByRole("heading", {name: /Sponsored UserOp demo/})).toBeVisible();
    });

    test("clicking the passkey link opens /passkey", async ({page}) => {
        await page.goto("/");
        await page.getByTestId("link-passkey").getByRole("link").click();
        await page.waitForURL(/\/passkey$/, {timeout: 30_000});
        await expect(page.getByRole("heading", {name: /Passkey enrolment/})).toBeVisible();
    });
});
