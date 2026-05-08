import {test, expect} from "@playwright/test";

test.describe("/demo", () => {
    test("renders the three-step layout", async ({page}) => {
        await page.goto("/demo");
        await expect(page.getByRole("heading", {name: /Sponsored UserOp demo/})).toBeVisible();
        // The page is laid out as three sections — connect / counterfactual / send.
        await expect(page.getByRole("heading", {name: /Connect EOA/})).toBeVisible();
        await expect(page.getByRole("heading", {name: /Counterfactual address/})).toBeVisible();
        await expect(page.getByRole("heading", {name: /Send sponsored transfer/})).toBeVisible();
    });

    test("shows missing-config notice when factory env unset", async ({page}) => {
        await page.goto("/demo");
        // With the default .env values (zero address) the factory-missing notice renders.
        await expect(page.getByTestId("factory-missing")).toBeVisible();
    });

    test("send button starts disabled and explains why", async ({page}) => {
        await page.goto("/demo");
        await expect(page.getByTestId("send-userop")).toBeDisabled();
        await expect(page.getByTestId("env-warning")).toBeVisible();
    });

    test("recipient + value inputs are editable", async ({page}) => {
        await page.goto("/demo");
        const recipient = page.getByTestId("recipient-input");
        const value = page.getByTestId("value-input");
        await recipient.fill("0x000000000000000000000000000000000000cafe");
        await value.fill("1000");
        await expect(recipient).toHaveValue("0x000000000000000000000000000000000000cafe");
        await expect(value).toHaveValue("1000");
    });
});
