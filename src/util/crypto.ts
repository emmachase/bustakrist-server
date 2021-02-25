import { randomBytes } from "crypto";

export function crypto64(length: number): string {
    const bytes = randomBytes(length);
    return bytes.toString("base64");
}