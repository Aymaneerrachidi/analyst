import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3120",
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3120",
    url: "http://127.0.0.1:3120",
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      DATA_PROVIDER: "mock",
      DATABASE_URL: "",
      PGLITE_DATA_DIR: ".data/playwright",
      MARKET_DATA_PROVIDER: "none",
      INDEXER_URL: "",
      INDEXER_SECRET: "",
      BASE44_AGENT_URL: "",
      BASE44_AGENT_KEY: "",
      ALCHEMY_RPC_URL: "",
      ALCHEMY_WS_URL: "",
      PONS_FACTORY_ADDRESS: "",
      UNISWAP_ROUTER_ADDRESS: "",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3120",
    },
  },
});
