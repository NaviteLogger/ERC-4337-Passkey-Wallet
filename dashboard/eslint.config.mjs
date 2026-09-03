import next from "eslint-config-next/core-web-vitals";

/**
 * Flat config, required by ESLint 9's default resolution. `next lint` used to
 * synthesise this from an .eslintrc that never existed here, which is why
 * linting only ever offered to set itself up. The rules come from
 * eslint-config-next; core-web-vitals is the same base set with the Core Web
 * Vitals rules raised to errors.
 *
 * @type {import("eslint").Linter.Config[]}
 */
const config = [
    {
        // Build output and the generated ambient types are not ours to lint.
        ignores: [".next/**", "out/**", "next-env.d.ts"],
    },
    ...next,
];

export default config;
