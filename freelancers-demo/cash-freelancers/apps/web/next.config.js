/** @type {import('next').NextConfig} */

const path = require("path");
const { loadEnvConfig } = require("@next/env");

// Next.js only reads .env* files from its own directory, which in this
// monorepo is apps/web — but the single .env lives at the root, next to the
// one the API and the contracts scripts load with an explicit
// `--env-file-if-exists=../../.env`. Without this, `process.env.NEXT_PUBLIC_*`
// is left un-inlined and the browser gets `projectId: ""`, which makes
// WalletConnect fail deep inside the SDK with an error that carries no
// message at all. Loading the root env here puts those values into process.env
// before Next builds the client bundle, and before API_INTERNAL_URL is read
// further down.
//
// `loadEnvConfig` never overwrites a variable that is already set, so Next's
// own pass over apps/web afterwards cannot clobber these values.
const rootEnv = loadEnvConfig(
  path.join(__dirname, "../../"),
  process.env.NODE_ENV !== "production"
);
if (rootEnv.loadedEnvFiles.length === 0) {
  console.warn(
    "[config] no .env found at the monorepo root — WalletConnect will have no project ID " +
      "and API_INTERNAL_URL will fall back to its default"
  );
}

// The API is a separate Fastify process on its own port with no CORS headers.
// Rather than registering @fastify/cors on the API (a new runtime dependency
// and a second place to keep an origin allow-list in sync), the browser only
// ever talks to its own origin and Next proxies /api/* through to Fastify.
// Same-origin means no preflight and no Access-Control-* handling at all.
//
// API_INTERNAL_URL is read server-side, so it does not need the NEXT_PUBLIC_
// prefix and is never shipped to the browser.
const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@cash-freelancers/shared", "@cash-freelancers/wallet-connect"],
  // The workspace packages are written for Node's ESM resolver, so their
  // relative imports carry the `.js` extension the emitted JavaScript will have
  // (`./net.js` in source, `net.ts` on disk). `tsc` understands that, webpack
  // does not, so the alias is declared here instead of stripping the extensions
  // from the packages — which would break the API and the contracts package
  // that run directly on Node.
  //
  // Done through the webpack hook because the Next 15 config schema in this
  // version does not expose resolveExtensionAlias at all.
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"]
    };
    return config;
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiInternalUrl}/:path*` }];
  }
};

module.exports = nextConfig;
