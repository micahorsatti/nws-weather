/**
 * Preload that applies a machine time zone to Node at startup, so the data-layer tests can prove they
 * don't depend on it. On Windows Node ignores a TZ variable set before launch, but honours assigning
 * process.env.TZ at runtime, which is what this does (and it works the same on macOS/Linux).
 *
 *   TEST_TZ=Pacific/Auckland NODE_OPTIONS=--import=./scripts/set-tz.mjs npx vitest run src/data
 */
const zone = process.env.TEST_TZ;
if (zone) process.env.TZ = zone;
