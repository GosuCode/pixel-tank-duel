# Gameplay

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Move | `WASD` / arrow keys | on-screen joystick |
| Fire | `Space` | **FIRE** button / right stick |
| Aim (optional) | mouse | right aim-stick |
| Emotes | `1`–`7` | emote bar |
| Chat | `T` or `Enter` | **TALK** button |
| Scoreboard (hold) | `Tab` | — |
| Armory | **Customize** button or `G` | **Customize** button |

By default the turret points wherever you drive. Switch **Controls → Aim** in the Armory for an independent turret (mouse on desktop, right aim-stick on touch).

## Rounds & match

- 2–4 players per game.
- Each round opens with a **3-2-1 countdown** and **1.2 s of spawn protection** — it drops the instant you fire.
- Tanks have **3 HP**, shown as a segmented bar above each tank. A hit flashes the tank white.
- **Last tank standing** wins the round. If the 60 s timer runs out, **most kills** wins.
- Tie on the clock → **sudden death**: everyone drops to 1 HP for 15 s and the next kill wins.
- Rounds auto-restart ~4 s after ending (~9 s once the match is decided).
- The **match is first to 3 round wins**, then the series resets.

## Maps

Three symmetric layouts, one picked at random each round (never the same twice in a row):

- **Crossroads** — a central cross breaks the diagonal sightlines between opposite spawns, plus four edge pillars that break the straight lanes.
- **Bunkers** — a solid center block with four offset bars for flanking cover.
- **Bastion** — a broken square ring around the center with gaps on all four sides.

## Power-ups

Powerups spawn on a fixed clock at fixed spots on each map (first at ~8 s, then every ~9 s), cycling through every type in a fixed order. The next spawn is announced with a pulsing marker and countdown, so it is a contested objective rather than a lottery. Drive over one to grab an **8-second buff**:

| Power | Icon | Effect |
| --- | --- | --- |
| Speed Boost | S (cyan) | Move speed up ~70% |
| Rapid Fire | F (orange) | Fire cooldown cut way down |
| Triple Shot | T (purple) | Fires a 3-bullet spread instead of 1 |
| Ricochet | R (yellow) | Bullets survive 3 wall bounces instead of being destroyed on impact — rendered as bigger gold bullets, and exempt from the normal range limit |
| Energy Shield | B (blue) | Absorbs the next bullet hit (including ricochets/spread shots), then shatters |
| Laser | L (red) | Hold fire for 0.5s to charge, then releases a fast beam that deals 2 HP and pierces walls and every tank in its path, hitting each enemy once (never its owner). Each wall it passes through keeps a permanent hole for the rest of the round — normal bullets fly through the holes, but tanks are still blocked |

Your active buff shows as a badge above your tank and a countdown chip in the HUD.

## Bullets & collisions

- Bullets are destroyed when they hit a wall/obstacle — they do not bounce unless you have Ricochet.
- Normal bullets have a fixed range (~400 px) and fizzle out mid-air; Ricochet and Laser shots are exempt.
- Tanks are solid to each other and slide around one another instead of overlapping (walls too).

## Trash talk

Every tank can talk smack. A message pops up in a speech bubble above the sender, wobbles for a moment, and plays a synthesized sound (no audio files — generated with the Web Audio API).

- **Emotes:** number keys `1`–`7` (`GG`, `REKT`, `NICE!`, `LOL`, `EZ`, `OOPS`, `HeHeHe...`), or tap the emote buttons on the touch bar. Each emote has its own tune.
- **Free text:** press `T` (or Enter) to open the chat bar, type up to 40 characters and hit Enter. On phones, tap **TALK**.
- Messages are sanitized server-side (control characters stripped, length capped, a light profanity filter applied) and rate-limited to one taunt per ~1.2 s, so a hacked client can't spam or inject. Bubbles fade out after ~3 s and clear at the start of each round.

## Feedback

- Landing a shot shows a hitmarker and a hit sound; taking one flashes a red vignette with a low thud and a brief screen shake, and floating `-1`/`BLOCK` numbers mark the impact.
- Destroyed tanks erupt in a debris burst with a synthesized boom at the spot they died.
