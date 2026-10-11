import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // These suites build and sign real covenant transactions rather than stubbing
    // them, so the tests that mint a genesis, top up collateral, or burn spend
    // several seconds each on their own. Vitest's 5s default is sized for tests
    // that do no cryptographic work, and under parallel load it expires on tests
    // that pass in a second on an idle machine. A generous ceiling keeps a real
    // failure reported as a failure rather than as a timeout.
    testTimeout: 60_000,
  },
});