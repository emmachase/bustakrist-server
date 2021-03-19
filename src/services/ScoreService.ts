import { createHmac } from "crypto";
import { getConfig } from "../config";
import { SECOND } from "../util/time";
import { KristService } from "./KristService";

export function calculateGameResult(seed: Buffer, salt: string): number {
  const nBits = 52; // number of most significant bits to use

  // 1. HMAC_SHA256(key=salt, message=seed)
  const hmac = createHmac("sha256", salt);
  hmac.update(seed);
  const seedDigest = hmac.digest("hex");

  // 2. r = 52 most significant bits
  const seedBits = seedDigest.slice(0, nBits/4);
  const r = parseInt(seedBits, 16);

  // 3. X = r / 2^52
  let X = r / Math.pow(2, nBits); // uniformly distributed in [0; 1)

  // 4. X = 99 / (1-X)
  X = 99 / (1 - X);

  // 5. return max(trunc(X), 100)
  const result = Math.floor(X);
  return Math.max(100, result);
}

/**
 * Returns how long a round with a given bust will last in terms of ms
 * @param bust The bust multiplier as a 2 dec fixed point number (encoded as int)
 */
export function getRoundLength(bust: number): number {
  // b = 2^((t/1000)/10)
  // t = log_2(b)*10*1000
  return Math.log2(bust/100) * 10 * SECOND;
}

/**
 * The multiplier at the given point in the round, rounded down, times 100
 * @param time The time since the round started in milliseconds
 */
export function getScoreAt(time: number): number {
  return Math.floor(100 * 2**((time/1000)/10));
}

async function getSafety(wagered: number, profited: number, maxPercent: number) {
  const bankRoll = await KristService.instance.getUnallocatedBalance() - profited;
  const max = bankRoll * maxPercent;
  return Math.round((max + 100*wagered)/wagered);
}

export function getIndividualSafety(wagered: number): Promise<number> {
  return getSafety(wagered, 0, getConfig().game.safetySingle);
}

export function getRoundSafety(totalWagered: number, totalProfited: number = 0): Promise<number> {
  return getSafety(totalWagered, totalProfited, getConfig().game.safetyRound);
}
