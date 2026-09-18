# Haunt system

Losing has consequences beyond the scoreboard. Every round you lose adds to a **haunt streak**, and when the next round starts your own browser turns on you. Effects are **client-side and self-inflicted only** — nothing is sent to other players and no network spam occurs.

## Levels

Haunts escalate with consecutive losses. Each level applies only its own effect (they are not cumulative).

| Level | Name | Reached after | Effect |
| --- | --- | --- | --- |
| 1 | Haunted | 1 loss | Tab title cycles taunts (`REKT`, `GIT GUD`, `MOM HELP`, …) every 2 s, echoed across the arena floor for 15 s |
| 2 | Possessed | 2 losses | All four movement directions reversed for 10 s, with `POSSESSED` across the arena floor |

The level is `min(2, floor(lossStreak / 2) + 1)`, so a streak of 1 → level 1, 2+ → 2.

## Clearing haunts

- **Win a round** — resets the haunt streak and level to zero.
- **Land a kill** — clears the active haunt level immediately.
- **Haunt Immunity** — a 20 ⚡ consumable from [The Forge](ECONOMY.md). If you hold one when a haunt would fire, it is consumed instead, the haunt is skipped, and you'll see `HAUNT BLOCKED`.

## Notes

- Level 1 taunts expire after 15 s; level 2 reverts after 10 s. A win or a kill clears the active haunt early.
- Haunts fire at the start of a round, so you get them as the next match begins.
- The current level is shown in the HUD next to your bolt count and announced in the bolt feed.
