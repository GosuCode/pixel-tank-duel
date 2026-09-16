# Haunt system

Losing has consequences beyond the scoreboard. Every round you lose adds to a **haunt streak**, and when the next round starts your own browser turns on you. Effects are **client-side and self-inflicted only** — nothing is sent to other players and no network spam occurs.

## Levels

Haunts escalate with consecutive losses and are cumulative — level 5 does everything below it.

| Level | Name | Reached after | Effect |
| --- | --- | --- | --- |
| 1 | Haunted | 1 loss | Tab title cycles taunts (`REKT`, `GIT GUD`, `MOM HELP`, …) every 2 s |
| 2 | Cursed | 2 losses | Random beeps (every 5–15 s) + a 3 s screen blur at round start |
| 3 | Possessed | 4 losses | Browser window shrinks 30 px, and lateral controls flip every ~3.2 s for 10 s |
| 4 | Hexed | 6 losses | 4 desktop notifications + screen inversion flashes for ~2.4 s |
| 5 | Damned | 8 losses | All of the above, plus a webcam request |

The level is `min(5, floor(lossStreak / 2) + 1)`, so a streak of 1 → level 1, 2 → 2, 4 → 3, 6 → 4, 8+ → 5.

## Clearing haunts

- **Win a round** — resets the haunt streak and level to zero.
- **Land a kill** — clears the active haunt level immediately.
- **Haunt Immunity** — a 20 ⚡ consumable from [The Forge](ECONOMY.md). If you hold one when a haunt would fire, it is consumed instead, the haunt is skipped, and you'll see `HAUNT BLOCKED`.

## Notes

- The effects rely on browser APIs that may be blocked or unsupported (`window.resizeTo`, `Notification`, `getUserMedia`). Each is wrapped in a try/catch, so a blocked effect is simply skipped.
- Haunts fire at the start of a round, so you get them as the next match begins.
- The current level is shown in the HUD next to your bolt count and announced in the bolt feed.
