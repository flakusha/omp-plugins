---
name: encryption-compression-round-trip
description: "For applications that require it — confirm data is properly encrypted and compressed, AND is decryptable/decompressable on round trip: serialize -> encrypt/compress -> store -> retrieve -> decrypt/decompress reproduces the original bytes"
condition: ["^(?=[\\s\\S]*encrypt|decrypt|cipher|crypto|at rest|in transit|TLS)(?=[\\s\\S]*compress|decompress|gzip|zlib|snappy|lz4|lzma|zip|codec)(?=[\\s\\S]*round trip|serialize|deserialize)(?=[\\s\\S]*secret|sensitive|credential|password|pii|personal (data|info)|token)"]
scope: ["text", "thinking"]
---

For applications that require encryption and/or compression, CONFIRM the data is properly encrypted and compressed AND is decryptable/decompressable on round trip. Both directions matter; the classic failure is one-way.

THE RULE — check each:
- APPLY WHERE REQUIRED: encrypt at rest (secrets, PII, credentials, tokens) and in transit (TLS) as the application's contract requires; confirm key management (where the key lives, how it is looked up) and that encryption actually covers the field/file — not a no-op.
- ROUND-TRIP VERIFICATION: confirm the read path is the symmetric inverse of the write path — serialize → (encrypt|compress) → store → retrieve → (decrypt|decompress) → deserialize reproduces the original bytes byte-for-byte. The failure mode is a write path that encodes but a read path that cannot reverse it: wrong key, wrong codec, missing/non-persisted salt or IV, truncated payload.
- FRAMING MATCHES: the compressor's framing must match the decompressor (same codec/level/stream); confirm no accidental double-compression or double-encryption.
- Verify the actual runtime round trip, not the intent (see verify-api-actuality): a unit or integration test that writes and reads back the value is the proof.

WHY: encryption and compression that only work one way silently corrupt or brick data on the read path — and the corrupt version (not a clean error) is the worst outcome. Confirming the round trip makes the symmetry explicit and testable.

TIES: verify-api-actuality, strict-review-standards, parallel-safe-tests (round-trip test as the observable check), data-sanitization.

DON'T OVER-APPLY: not every field needs encryption — only data the application's requirements tag as sensitive. And the check is round-trip correctness, not maximal crypto: don't cryptographically-wrap everything or add checksums where no real requirement exists.
