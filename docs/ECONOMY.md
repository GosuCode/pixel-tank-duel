# Bolt economy & The Forge

Bolts (⚡) are the in-game currency. They are earned in battle, spent in **The Forge**, and tied to your device (see [Persistence](#persistence)) — no login required.

## Earning bolts

| Action | Bolts |
| --- | --- |
| Kill | +3 |
| First blood (first kill of a round) | +2 bonus |
| Kill streak bonus | +1 per consecutive kill, up to +3 per kill |
| Round win | +5 |
| Ace (wipe the lobby) | +5 |
| Match win (first to 3 rounds) | +15 |
| Accuracy ≥ 60% (settled at round end) | +2 |
| Survival (zero deaths that round) | +3 |

The kill-streak bonus scales with the streak you already have: the first kill is +3, then +4, +5, and +6 for the third and later consecutive kills.

## Losing bolts

| Event | Bolts |
| --- | --- |
| Death | −2 |
| Round loss | −3 |
| Match loss | −8 |
| Rage quit (mid-round disconnect) | −15 (also clears your streak) |

Balances never go below zero.

## The Forge

Open the **Armory** (**Customize** button or `G`) — The Forge is the right-hand panel. Buy cosmetics (permanent, auto-equipped on purchase) and consumables.

| Category | Item | Cost |
| --- | --- | --- |
| Skin | Camo | 30 |
| Skin | Neon | 60 |
| Skin | Ghost | 80 |
| Skin | Chrome | 100 |
| Skin | Ember | 50 |
| Trail | Fire Trail | 35 |
| Trail | Rainbow Trail | 60 |
| Trail | Sparkle Trail | 30 |
| Trail | Smoke Trail | 25 |
| Boom | Confetti Boom | 40 |
| Boom | Skull Cloud | 70 |
| Boom | Comet Boom | 50 |
| Spawn | Portal In | 45 |
| Spawn | Drop From Sky | 55 |
| Spawn | Smoke Reveal | 30 |
| Consumable | Map Vote | 15 |
| Consumable | Haunt Immunity | 20 |

- **Cosmetics** (skins, trails, booms, spawn effects) are bought once, then owned forever. Buying one equips it immediately; click it again in The Forge to toggle it on/off.
- **Consumables** are held one at a time: buy, use, then buy again. **Map Vote** forces the next map; **Haunt Immunity** blocks one haunt (see [HAUNTS.md](HAUNTS.md)).
- If you can't afford something, the bolt feed flashes "not enough bolts" and nothing is charged.

## Streak skins

These are **earned, not bought** — unlocked by your best **win streak** (consecutive round wins, tracked across sessions) and layered over whatever skin you own:

| Win streak | Skin | Look |
| --- | --- | --- |
| 3 | Scarred | paint scratches |
| 5 | Golden | metallic gold accent |
| 10 | Phantom | semi-transparent ghost |
| 25 | Titanium | silver + dark glass + spinning bolt badge |

## Persistence

Balances, owned cosmetics, win/loss records and streaks are stored server-side in `data/players.json` (auto-created on first use).

No login or signup. On first load the client generates a random **device token**, keeps it in `localStorage`, and sends it when it connects. The server maps that token to a durable **account**, so progress survives server restarts and callsign changes — the callsign is display-only. Only hashed tokens are written to disk; raw tokens and link codes are never logged. Banks created before this feature (keyed by callsign) are adopted once on first connect.

### Linking another device

You can play the same account on a second device without copying the secret:

1. On a device already signed in, open the **Armory → Devices** panel and press **Link a new device**. A short single-use code appears (valid for 5 minutes).
2. On the new device, open **Armory → Devices**, enter the code, and press **Link this device**.
3. The new device connects and waits. Back on the original device, approve it in the same panel. It then loads the account automatically.

The code alone cannot open the account: redeeming it only creates a *pending* device, and the original device must approve it. Each device gets its own token, so a lost or stolen device can be denied without affecting the others, and there is a per-account device cap.

For the data model, API and security model, see **[ACCOUNTS.md](ACCOUNTS.md)**.

Caveats: clearing site data or using private mode on a device loses that device's identity (link it again from another device to recover access). The device token is still a bearer secret for that one device — don't share it.
