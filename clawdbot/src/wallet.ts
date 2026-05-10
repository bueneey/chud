import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

let _warnedWalletMismatch = false;

export function loadKeypair(): Keypair | null {
  const secret = process.env.WALLET_PRIVATE_KEY;
  if (!secret) return null;
  try {
    const bytes = bs58.decode(secret);
    const kp = Keypair.fromSecretKey(bytes);
    const expected = process.env.CHUD_WALLET_PUBLIC?.trim();
    if (expected && kp.publicKey.toBase58() !== expected && !_warnedWalletMismatch) {
      _warnedWalletMismatch = true;
      console.warn(
        `[Clawdbot] WALLET_PRIVATE_KEY pubkey (${kp.publicKey.toBase58()}) does not match CHUD_WALLET_PUBLIC (${expected}). Trading uses the keypair key; update one of them.`
      );
    }
    return kp;
  } catch {
    return null;
  }
}

export function getPublicKeyBase58(): string | null {
  const kp = loadKeypair();
  return kp ? kp.publicKey.toBase58() : null;
}
