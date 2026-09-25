---
name: encryption-compression-round-trip
description: "For applications that require it — confirm data is properly encrypted and compressed, AND is decryptable/decompressable on round trip: serialize -> encrypt/compress -> store -> retrieve -> decrypt/decompress reproduces the original bytes"
condition: ["^(?=[\\s\\S]*encrypt|decrypt|cipher|crypto|at rest|in transit|TLS)(?=[\\s\\S]*compress|decompress|gzip|zlib|snappy|lz4|lzma|zip|codec)(?=[\\s\\S]*round trip|serialize|deserialize)(?=[\\s\\S]*secret|sensitive|credential|password|pii|personal (data|info)|token)"]
scope: ["text", "thinking"]
---

For applications that require it, CONFIRM encryption/compression works both ways: serialize → (encrypt|compress) → store → retrieve → (decrypt|decompress) → deserialize reproduces the original bytes.

- APPLY WHERE REQUIRED: at rest (secrets, PII, tokens) + in transit (TLS) per contract; confirm key management and real coverage.
- ROUND TRIP: read path = symmetric inverse of write path. Failures: wrong key/codec, missing/non-persisted salt or IV, truncated payload.
- FRAMING MATCHES: same codec/level/stream both ways; no double-compression/encryption.
- Verify the runtime round trip, not intent (see verify-api-actuality): a write-then-read-back test is the proof.
- WHY: one-way crypto/compression silently corrupts or bricks data — the corrupt version (not a clean error) is the worst outcome.
- TIES: verify-api-actuality, strict-review-standards, parallel-safe-tests, data-sanitization.
- DON'T OVER-APPLY: only sensitive-tagged data; round-trip correctness, not maximal crypto.
