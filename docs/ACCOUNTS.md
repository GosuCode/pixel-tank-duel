# Accounts & device linking

There is no login. A player's progress lives in an **account**, and one or more **devices** point at it. This doc covers the data model, the linking flow, the HTTP API, and the security model.

The player-facing walkthrough lives in [ECONOMY.md](ECONOMY.md#linking-another-device).

## Model

- **Account** — the durable identity. Owns bolts, cosmetics, win/loss records and streaks. Keyed by a random UUID (`accountId`).
- **Device** — one browser, identified by a random **token** kept in `localStorage` under `tankToken`. The token is a bearer secret; only its SHA-256 hash is stored server-side.
- An account can have several devices. Linking a device never copies the original token — it mints a new one.

This split is what makes linking safe: a stolen or lost device token can be revoked on its own without touching the others.

## Storage

`data/players.json` (gitignored, auto-created). Schema version 2:

```json
{
  "version": 2,
  "accounts": {
    "<accountId>": {
      "bolts": 25,
      "owned": ["skin_neon"],
      "wins": 0,
      "losses": 0,
      "streak": 0,
      "best": 0,
      "bought": { "mapvote": 1 },
      "devices": {
        "<sha256(token)>": {
          "label": "Chrome Linux",
          "createdAt": 1789780000000,
          "lastSeen": 1789780100000,
          "approved": true
        }
      }
    }
  },
  "legacy": { "<callsign>": { "bolts": 0, "owned": [] } }
}
```

A device waiting for approval also carries `"approved": false` and a `"requestId"`. Pending **link codes** are held in memory only and are never written to disk.

Raw tokens, token hashes in URLs, and link codes are never logged.

### Migration from v1

v1 stored `{ "<token-or-callsign>": { bolts, owned, ... } }`. On load:

- Keys matching `^[A-Za-z0-9_-]{16,}$` are treated as device tokens. Each becomes a new account with that token hashed into its `devices` map (`approved: true`).
- Other keys are treated as pre-token **callsign** banks and moved to `legacy`, to be adopted once (see below).

### Legacy callsign adoption

When a player sets a callsign, the server checks `legacy[name]`. If found **and** the account is still untouched (no wins/losses/owned, bolts ≤ `START_BOLTS`), the legacy record is merged in and removed. An account that has already earned progress is never overwritten.

## Auth flow

1. Client generates a random token on first load and stores it in `localStorage.tankToken`.
2. On WebSocket open it sends `{ type: 'auth', token }`.
3. Server resolves the token:
   - **new** — no account yet; created lazily on the first bank write (after the client sends its design).
   - **ok** — approved device; the account is loaded and a `bank` message is sent.
   - **pending** — the device was linked but not approved. The server sends `pendingApproval` and grants **no bank access** until approved.
4. A pending player can still move around, but `bankOf()` returns `null`, so nothing is read or written.

## Linking flow

Two-sided: a code alone cannot open an account.

```
Device A (approved)                         Device B (new)
─────────────────────                       ──────────────
POST /api/transfer/start
  └─ { code, expiresAt }  ──── share code ──────────────▶
                                            POST /api/transfer/redeem { code, label }
                                              └─ { token, requestId, status: "pending" }
                                            connect + auth  ──▶  pendingApproval
POST /api/transfer/pending
  └─ [ { requestId, label, fingerprint } ]
POST /api/transfer/approve { requestId }
                                            poll /api/transfer/status ──▶ approved
                                            reconnect + auth ──▶ bank
```

Device B polls `status` every 4 s, then reconnects to receive its bank. Denying removes the pending device entirely.

## HTTP API

All endpoints are `POST` with a JSON body. Tokens and codes travel in the **body**, never the URL. Errors return a non-2xx status with `{ "error": "<code>" }`.

| Endpoint | Body | Success response |
| --- | --- | --- |
| `/api/transfer/start` | `{ token }` | `{ code, expiresAt }` |
| `/api/transfer/redeem` | `{ code, label }` | `{ token, requestId, status: "pending" }` |
| `/api/transfer/pending` | `{ token }` | `{ pending: [ { requestId, label, createdAt, fingerprint } ] }` |
| `/api/transfer/approve` | `{ token, requestId }` | `{ ok: true, label, fingerprint }` |
| `/api/transfer/deny` | `{ token, requestId }` | `{ ok: true, label }` |
| `/api/transfer/status` | `{ token }` | `{ status: "approved" \| "pending" \| "unknown", requestId?, label? }` |

Error codes: `bad-token`, `unknown-device`, `unapproved`, `bad-code`, `expired`, `too-many-devices`, `not-found`, `rate-limited`.

WebSocket: the server pushes `{ type: 'pendingApproval', requestId, label }` to a device that connects while pending.

## Security model

| Threat | Mitigation |
| --- | --- |
| Sniffed in transit | Tokens/codes in POST bodies, never URLs. **Must be served over TLS** — plain LAN HTTP still leaks them to a network sniffer. |
| Brute-forced code | 8-char code from a 31-symbol alphabet (~40 bits), single-use, 5-minute TTL, per-IP rate limit on redeem. |
| Leaked / shoulder-surfed code | Redeeming only creates a **pending** device; the owner must approve it. The code alone cannot open the account. |
| Token theft | Per-device tokens, hashed at rest; denying/removing one device leaves the others intact. |
| Logging leaks | Raw tokens and codes are never logged or written to disk. |
| Unbounded devices | Approved devices per account capped by `TRANSFER_MAX_DEVICES`. |

## Configuration

`lib/config.js`:

| Constant | Value | Meaning |
| --- | --- | --- |
| `TRANSFER_CODE_TTL_MS` | `5 * 60 * 1000` | Link-code lifetime |
| `TRANSFER_CODE_LEN` | `8` | Code length |
| `TRANSFER_CODE_ALPHABET` | `ABCDEFGHJKMNPQRSTUVWXYZ23456789` | Code alphabet (no `I/L/O/0/1`) |
| `TRANSFER_MAX_DEVICES` | `8` | Approved devices per account |

The per-IP limiter keys on the real client address from `lib/ratelimit.js`. Direct (LAN) connections use the socket address; behind the Cloudflare Tunnel `cloudflared` dials in over loopback, so the address is taken from `CF-Connecting-IP`. Forwarded headers are trusted **only** from a loopback peer, so a LAN client cannot spoof them to dodge the limiter. Limits (`server.js`, in memory): 30 transfer starts and 20 redeems per IP per 10 minutes.

## Limitations

- **No per-device revoke yet.** `deny` only removes a *pending* device. Revoking an already-approved device needs a new endpoint.
- Pending link codes live in memory, so a server restart invalidates outstanding codes (already-linked pending devices survive, since they're in `accounts`).
- The rate limiter is in-memory and per-process; it resets on restart and does not span multiple instances. Edge rate limiting (Cloudflare) is the durable complement.
- Device identity is per-browser-storage. Clearing site data or using private mode loses that device's token; recover by linking again from another approved device.
- No email/OTP recovery: if every approved device is lost, the account is unreachable.
