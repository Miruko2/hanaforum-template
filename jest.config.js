/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Jest configuration for the music-fisheye-canvas feature spec.
 *
 * Uses the dual-project pattern so pure-function tests run in `node` (faster,
 * no jsdom overhead) while React hook/component tests run in `jsdom`.
 *
 *  - node project   : lib/**\/*.test.ts
 *  - jsdom project  : hooks/**\/*.test.{ts,tsx}, components/**\/*.test.tsx
 *
 * `ts-jest` transforms `.ts` / `.tsx` directly so we don't need a separate
 * Babel config. The Next.js path alias `@/*` is mirrored via `moduleNameMapper`.
 */

/** @type {import('@jest/types').Config.InitialOptions} */
const tsJestTransform = {
  "^.+\\.(ts|tsx)$": [
    "ts-jest",
    {
      // Next.js sets `jsx: "preserve"` for the dev server build; for Jest we
      // need a runnable JSX transform.
      tsconfig: {
        jsx: "react-jsx",
      },
      isolatedModules: true,
      diagnostics: false,
    },
  ],
}

const moduleNameMapper = {
  "^@/(.*)$": "<rootDir>/$1",
}

const moduleFileExtensions = ["ts", "tsx", "js", "jsx", "json"]

/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  projects: [
    {
      displayName: "node",
      testEnvironment: "node",
      rootDir: __dirname,
      testMatch: [
        "<rootDir>/lib/**/*.test.ts",
        "<rootDir>/__tests__/lib/**/*.test.ts",
      ],
      transform: tsJestTransform,
      moduleNameMapper,
      moduleFileExtensions,
    },
    {
      displayName: "jsdom",
      testEnvironment: "jsdom",
      rootDir: __dirname,
      testMatch: [
        "<rootDir>/hooks/**/*.test.ts",
        "<rootDir>/hooks/**/*.test.tsx",
        "<rootDir>/components/**/*.test.tsx",
        "<rootDir>/__tests__/hooks/**/*.test.ts",
        "<rootDir>/__tests__/hooks/**/*.test.tsx",
        "<rootDir>/__tests__/components/**/*.test.tsx",
        "<rootDir>/__tests__/integration/**/*.test.tsx",
      ],
      setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
      transform: tsJestTransform,
      moduleNameMapper,
      moduleFileExtensions,
    },
  ],
}
