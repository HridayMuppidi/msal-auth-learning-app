/**
 * Decodes a JWT (JSON Web Token) into its three parts.
 *
 * A JWT looks like this:   xxxxx.yyyyy.zzzzz
 *   - Part 1 (header)    : algorithm and token type, base64url encoded
 *   - Part 2 (payload)   : the actual claims/data, base64url encoded
 *   - Part 3 (signature) : cryptographic proof the token hasn't been tampered with
 *
 * We only decode — we do NOT verify the signature here.
 * In a real application the server verifies the signature using Microsoft's public keys.
 */
export function decodeJWT(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Not a valid JWT — expected 3 parts separated by dots.");

    const decodeBase64Url = (str) => {
      // JWT uses base64url encoding (URL-safe: uses - and _ instead of + and /)
      // atob() needs standard base64, so we convert and add padding.
      const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, "=");
      return JSON.parse(atob(padded));
    };

    return {
      header:    decodeBase64Url(parts[0]),
      payload:   decodeBase64Url(parts[1]),
      signature: parts[2],   // We keep this as a raw string — it's binary data
    };
  } catch (err) {
    console.error("Failed to decode JWT:", err.message);
    return null;
  }
}
