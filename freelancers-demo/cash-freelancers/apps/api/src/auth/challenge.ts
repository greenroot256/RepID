import { authRepo } from "../db/repositories/index.js";
// Imported from the module rather than the barrel: the barrel re-exports
// repositories as namespaces (`authRepo.challenge...`), and these are bare
// values and a type that live alongside them, not members of the repository
// object. Going through `auth.js` keeps the type import obvious to a reader.
import { CHALLENGE_PURPOSES, type ChallengePurpose } from "../db/repositories/auth.js";
import { verifyMessage } from "../utils/bch-message.js";
import { decodeAddressForNetwork } from "../utils/address.js";

/** An error carrying the status code the route should answer with. */
export class ChallengeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ChallengeError";
    this.status = status;
  }
}

export function parsePurpose(value: unknown): ChallengePurpose {
  if (typeof value === "string" && (CHALLENGE_PURPOSES as readonly string[]).includes(value)) {
    return value as ChallengePurpose;
  }
  throw new ChallengeError(400, `purpose must be one of ${CHALLENGE_PURPOSES.join(", ")}`);
}

export const PURPOSE_TEXT: Record<ChallengePurpose, string> = {
  "sign-in": "wants you to sign in to your Cash Freelancers account.",
  "link-wallet": "wants to add this wallet to your Cash Freelancers account.",
  "activate-wallet": "wants to make this the active wallet on your Cash Freelancers account."
};

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * Issues a one-time message for a wallet to sign, bound to the action it
 * authorises.
 *
 * The purpose is not decoration. A signature the user gave while linking a
 * second wallet is a real, valid signature over a real message — without the
 * binding, a route that only cares about "the holder of this key signed
 * something" would accept it. Each route redeems for the purpose it expects, so
 * the message the user reads in their wallet says what will actually happen.
 */
export async function issueChallenge(walletAddress: unknown, rawPurpose: unknown) {
  const purpose = parsePurpose(rawPurpose ?? "sign-in");
  if (typeof walletAddress !== "string" || !walletAddress) {
    throw new ChallengeError(400, "walletAddress is required");
  }
  // Checked here so the user is not asked to sign something that can never
  // be valid on this deployment (e.g. a mainnet address on Chipnet).
  decodeAddressForNetwork(walletAddress);

  const nonce = crypto.randomUUID();
  const message =
    `Cash Freelancers ${PURPOSE_TEXT[purpose]}\n\n` +
    `Wallet: ${walletAddress}\n` +
    `Nonce: ${nonce}\n` +
    `Issued: ${new Date().toISOString()}`;

  const challenge = await authRepo.createChallenge({
    walletAddress,
    nonce,
    message,
    purpose,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS)
  });

  return { challengeId: challenge.id, message, purpose };
}

/**
 * Verifies a signature against a challenge and burns it.
 *
 * Single use, expiry and purpose are all checked here rather than in each route,
 * so a new route that needs a wallet proof inherits the same rules instead of
 * re-implementing them — and forgetting one is the kind of bug that is
 * invisible until someone replays a signature.
 *
 * `notLinkedToUser` is the one thing a caller may add: linking a wallet is
 * permitted for any signed wallet (that's how you add a *new* one), whereas
 * activating one should only be allowed for wallets already on the caller's
 * account. That check is expressed as a predicate so the caller supplies it,
 * keeping the security-critical part in one place.
 */
export async function redeemChallenge(
  challengeId: unknown,
  signature: unknown,
  expectedPurpose: ChallengePurpose,
  opts: { notLinkedToUser?: (walletAddress: string) => Promise<string> } = {}
): Promise<string> {
  if (typeof challengeId !== "string" || typeof signature !== "string") {
    throw new ChallengeError(400, "challengeId and signature are required");
  }
  if (signature.length === 0) {
    throw new ChallengeError(400, "signature is required");
  }

  const challenge = await authRepo.findChallengeById(challengeId);
  if (!challenge) throw new ChallengeError(404, "Challenge not found");

  // Purpose is checked before the signature, and deliberately answered with a
  // 400 rather than the 401 a bad signature gets. The distinction is not
  // cosmetic: it tells a legitimate client that it replayed a challenge issued
  // for a different action, which is a bug it should surface loudly, whereas a
  // wrong signature tells it to ask for a new signature. Both still require the
  // signature check below before anything is granted, so a forged "purpose"
  // gains nothing — it can only pick which error is returned.
  if (challenge.purpose !== expectedPurpose) {
    throw new ChallengeError(
      400,
      `This challenge was issued for "${challenge.purpose}", not for "${expectedPurpose}"`
    );
  }
  if (challenge.usedAt) throw new ChallengeError(409, "Challenge was already used");
  if (challenge.expiresAt.getTime() < Date.now()) throw new ChallengeError(410, "Challenge expired");
  if (!verifyMessage(challenge.message, signature, challenge.walletAddress)) {
    throw new ChallengeError(401, "Signature does not match the challenge and wallet");
  }

  if (opts.notLinkedToUser) {
    await opts.notLinkedToUser(challenge.walletAddress);
  }

  await authRepo.markChallengeUsed(challenge.id);
  return challenge.walletAddress;
}
