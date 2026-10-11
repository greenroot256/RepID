import SignClient from "@walletconnect/sign-client";
import type { SessionTypes } from "@walletconnect/types";
import { serializeWcValue } from "@cash-freelancers/shared";
import { bchChainId, bchRequiredNamespaces, type BchNetwork } from "./namespaces.js";
import type {
  WalletSession,
  WcSignMessageRequest,
  WcSignMessageResponse,
  WcSignTransactionResponse,
  WcTransactionObjectLike
} from "./types.js";

export interface WalletConnectConfig {
  /** Project ID from https://cloud.walletconnect.com */
  projectId: string;
  /**
   * Required. This used to default to "mainnet", which meant a caller that
   * forgot to pass it would silently talk to a mainnet relay namespace. The
   * network now has to be stated explicitly, and it is taken from
   * `BCH_NETWORK` — never inferred from the session.
   */
  network: BchNetwork;
  metadata: {
    name: string;
    description: string;
    url: string;
    icons: string[];
  };
}

let clientPromise: Promise<SignClient> | undefined;

function getClient(config: WalletConnectConfig): Promise<SignClient> {
  // Checked here rather than in the web app so every consumer of this package
  // is protected. An empty project ID is not rejected by `SignClient.init` —
  // it only fails later, when the pairing has to be created, and it fails
  // there with an object that has no message, which is why this used to
  // surface as a bare `{}` in the browser console with nothing pointing at the
  // actual cause.
  if (!config.projectId?.trim()) {
    throw new Error(
      "WalletConnect projectId is empty. Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID in the " +
        ".env at the monorepo root — Next.js only reads .env files from apps/web, so the " +
        "value has to be inlined there explicitly."
    );
  }

  if (!clientPromise) {
    clientPromise = SignClient.init({
      projectId: config.projectId,
      metadata: config.metadata
    });
  }
  return clientPromise;
}

/**
 * Starts pairing with the user's wallet. Returns the `uri` (to show as a
 * QR code or deep link) and `approval()`, which resolves once the user
 * approves the connection from Cashonize, Paytaca or Zapit.
 */
export async function connectWallet(
  config: WalletConnectConfig
): Promise<{ uri: string; approval: () => Promise<WalletSession> }> {
  const client = await getClient(config);
  const network = config.network;

  const { uri, approval } = await client.connect({
    requiredNamespaces: bchRequiredNamespaces(network)
  });

  if (!uri) {
    throw new Error("WalletConnect did not return a pairing URI");
  }

  return {
    uri,
    approval: async () => {
      const session = await approval();
      const address = await requestAddress(client, session, network);
      return { topic: session.topic, address, network };
    }
  };
}

/**
 * Restores a previously approved session (by a topic saved on the client
 * side), without asking the user to scan the QR code again.
 */
export async function restoreSession(
  config: WalletConnectConfig,
  topic: string
): Promise<WalletSession | undefined> {
  const client = await getClient(config);
  const session = client.session.values.find((s) => s.topic === topic);
  if (!session) return undefined;

  const network = config.network;
  const address = await requestAddress(client, session, network);
  return { topic, address, network };
}

export async function disconnectWallet(config: WalletConnectConfig, topic: string): Promise<void> {
  const client = await getClient(config);
  await client.disconnect({
    topic,
    reason: { code: 6000, message: "User disconnected" }
  });
}

/**
 * Asks the connected wallet to sign an escrow transaction (`release` or
 * `reclaim`). `wcTransactionObject` is the object built by
 * `buildReleaseWcTransaction`/`buildReclaimWcTransaction` from
 * `@cash-freelancers/contracts` (under the hood, CashScript SDK's
 * `generateWcTransactionObject()`) — it already carries the pubkey/
 * signature placeholders that the wallet replaces when signing.
 *
 * `transaction` and `sourceOutputs` carry `Uint8Array`/`BigInt`, which are not
 * JSON, so they are encoded with `serializeWcValue` (bytes as hex strings,
 * amounts as decimal strings) before being sent as the WalletConnect `params`.
 * `JSON.stringify` would throw outright on the bigints, and libauth's
 * `stringify` would render them as the placeholder text `"<bigint: 31000n>"`
 * rather than as numbers — neither of which a wallet can sign.
 */
export async function signTransaction(
  config: WalletConnectConfig,
  session: WalletSession,
  wcTransactionObject: WcTransactionObjectLike
): Promise<WcSignTransactionResponse> {
  const client = await getClient(config);
  const params = serializeWcValue(wcTransactionObject);

  return client.request<WcSignTransactionResponse>({
    topic: session.topic,
    chainId: bchChainId(session.network),
    request: { method: "bch_signTransaction", params }
  });
}

/**
 * Step 1 of a two-party co-signing flow — needed for
 * `EscrowArbitrated.spend` in `@cash-freelancers/contracts`, where two
 * different people (e.g. the freelancer and the arbiter), each with
 * their own wallet and their own WalletConnect session, have to sign the
 * same transaction.
 *
 * Sends the placeholder transaction (both signer slots still empty,
 * from `buildSpendWcTransaction`) to the FIRST co-signer's wallet. A
 * WC2-BCH-compliant wallet is expected to fill in only the one
 * placeholder slot that matches a key it holds, and leave the other
 * slot's placeholder untouched — this project's own contract makes the
 * two slots interchangeable on purpose (`pk1`/`pk2` are checked against
 * the same three parties), so it doesn't matter which of the two the
 * wallet picks.
 *
 * The result's `signedTransaction` (a hex string) is what
 * `completeTwoPartySignature` needs later — the caller has to persist
 * it (e.g. on the escrow/dispute record) until the second co-signer is
 * ready.
 */
export async function startTwoPartySignature(
  config: WalletConnectConfig,
  firstSignerSession: WalletSession,
  wcTransactionObject: WcTransactionObjectLike
): Promise<WcSignTransactionResponse> {
  return signTransaction(config, firstSignerSession, wcTransactionObject);
}

/**
 * Step 2: takes the partially-signed transaction from
 * `startTwoPartySignature` and asks the SECOND co-signer's wallet to
 * complete it. Per the WC2-BCH spec, `transaction` accepts a hex-encoded
 * raw transaction directly — no need to turn it back into an object —
 * so `partiallySignedTransactionHex` is exactly the previous step's
 * `signedTransaction`.
 *
 * `sourceOutputs` has to describe the same contract UTXO used to build
 * the original placeholder object. In practice, the caller doesn't need
 * to persist it separately: since the UTXO is still unspent at this
 * point, calling `buildSpendWcTransaction` again (from
 * `@cash-freelancers/contracts`) regenerates an equivalent
 * `sourceOutputs` — only its freshly-generated `transaction` field gets
 * discarded in favor of the stored hex.
 */
export async function completeTwoPartySignature(
  config: WalletConnectConfig,
  secondSignerSession: WalletSession,
  partiallySignedTransactionHex: string,
  sourceOutputs: unknown[],
  options?: { broadcast?: boolean; userPrompt?: string }
): Promise<WcSignTransactionResponse> {
  return signTransaction(config, secondSignerSession, {
    transaction: partiallySignedTransactionHex,
    sourceOutputs,
    broadcast: options?.broadcast,
    userPrompt: options?.userPrompt
  });
}

export async function signMessage(
  config: WalletConnectConfig,
  session: WalletSession,
  request: WcSignMessageRequest
): Promise<WcSignMessageResponse> {
  const client = await getClient(config);
  return client.request<WcSignMessageResponse>({
    topic: session.topic,
    chainId: bchChainId(session.network),
    request: { method: "bch_signMessage", params: request }
  });
}

async function requestAddress(
  client: SignClient,
  session: SessionTypes.Struct,
  network: BchNetwork
): Promise<string> {
  const addresses = await client.request<string[]>({
    topic: session.topic,
    chainId: bchChainId(network),
    request: { method: "bch_getAddresses", params: {} }
  });

  const address = addresses[0];
  if (!address) {
    throw new Error("The wallet did not return any address");
  }
  return address;
}
