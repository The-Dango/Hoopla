# Hoopla

A logic puzzle game in the family of Sudoku, Star Battle and Queens. Drop hoops onto a
grid so that every coloured region, row and column holds the right number of them, and no
two hoops ever touch.

This repository holds the working prototype: a single page that generates its own puzzles,
solves them, grades their difficulty, explains its hints and scores the player. It runs with
no build step and no server.

- `index.html` — page shell, styles, markup
- `engine.js` — board shapes, puzzle generation, solver
- `logic.js` — difficulty grading, hints, target times, scoring, puzzle codes, serialization
- `ui.js` — screens, drawing, input
- `manifest.webmanifest`, `icons/` — home-screen name and icon (the hoop, in gold)
- `build.sh` — replaces the loader between the `SCRIPTS` markers with the three files
  inlined, giving `dist/hoopla.html`
- `dist/hoopla.html` — the playable build, for handing someone one file to open

Hosting serves the directory, not `dist/hoopla.html`: `index.html` plus the three JS files
is already a static site with no build step. `build.sh` is only for the single-file copy.

`engine.js` and `logic.js` are plain JavaScript with no browser dependencies and export for
Node, so a server can run the identical generator. `ui.js` is the only file that touches
the DOM.

---

## The rules

Every puzzle asks the same three things:

1. Every coloured region holds exactly N hoops (N is 1 or 2).
2. Every row and every column holds the number shown at its edges (shown on all four sides).
   On plain square boards this is the same number for every line, which is the classic
   Star Battle rule. On other shapes the counts vary per line.
3. Hoops never touch, not even diagonally.

Every puzzle has exactly one solution. The generator verifies this before the board is shown.

Cells are marked by tapping: once for an X (this cell can't hold a hoop), twice for a hoop,
a third time to clear. Dragging from an empty cell X-es out a run of cells. On a mouse,
right-click places or removes a hoop directly.

### Board types

| Type | What it is |
| --- | --- |
| Square | Full square grid, 6×6 to 10×10 depending on options |
| Rectangle | Wider than tall, about 3:2 |
| Octagon | Square with the corners cut diagonally, flat edges three cells long |
| Carved | Full grid with two or three large blocked areas cut out, symmetrically |
| Blank | Plain grid, no regions at all: row and column counts are the only information |

Scattered blocked cells (about 10% of the board, placed point-symmetrically) appear on
roughly one board in four. This is decided from the puzzle's seed, not offered as an option,
because it is texture rather than a choice a player would make.

---

## How puzzles are generated

`engine.js`:

1. Build the board mask for the chosen shape, optionally punching blocked cells, then crop
   empty edges.
2. Place the solution's hoops. Square boards place exactly N per row and column. Other
   shapes place a target number of non-touching hoops at a density of 13% to 17% of cells
   (9% to 13% for Blank boards).
3. Grow one region per hoop by random flood fill from the hoops outward, then, for two-hoop
   puzzles, merge adjacent regions into connected pairs.
4. Count solutions with the backtracking solver. If more than one exists, take a cell where
   the rival solution puts a hoop and move it to a neighbouring region, which invalidates the
   rival without touching the true solution. Repeat until unique. Blank boards have no regions
   to reshape, so they pin down hoops as givens instead.

Generation is capped at 500ms per attempt and about 1.2 seconds overall, and the app builds
the next puzzle in the background while the current one is being played, so New puzzle is
usually instant.

## How difficulty works

`logic.js` solves each finished puzzle with the same hint engine the player uses and records
the hardest step it needed:

| Level | Step |
| --- | --- |
| 1 | Direct: X out around a hoop, finish a row or region, or the last open cell in a line |
| 2 | Squeeze: a region's open cells all sit inside one row or column (or vice versa) |
| 3 | What-if: a hoop here would block a whole region, so it can't go here |
| 4 | One step of chain reasoning from that what-if |
| 5 | Longer chains |
| 6 | Beyond the hint engine: the player has to work it out unaided |

**Easy** is level 3 or below, **Medium** is exactly 4, **Hard** is 5 or 6.

When a board comes out harder than asked, the generator pre-places hoops ("givens", drawn
with a thin ring, up to 35% of the solution) and re-grades until it fits. This is what makes
Easy possible on big two-hoop boards. When a board comes out easier than asked, it tries
another board. If the shape can't produce the requested level, the player is told what they
got instead.

The four rungs on the Pick for me screen (Gentle, Steady, Tricky, Brutal) each hold two or
three setups combining size, hoop count and difficulty, chosen at random per board.

## Hints and checks

**Hint** finds the simplest available step, highlights the cells, dims the rest of the board
and explains the reasoning in a sentence ("This column still needs 1 hoop and has only one
open cell left"). A solid gold ring marks the cells to act on; a dashed outline marks the row,
column or region the reasoning comes from. "Do it for me" applies it. Mistakes are caught
first: a wrong hoop or a wrongly X-ed cell is pointed out before anything else.

**Check** is free and answers only "everything so far is correct" or "something is wrong",
never which. From there, "Show me" outlines the wrong cells for a penalty, and "Do it for me"
then clears them at no extra cost. Checking ends the misclick grace window (below), so a
player can't test a speculative hoop with Check and then remove it for free.

## Learning the rules

The two helpers that blank squares out — "Blank out around stars" and "Blank out finished
rows, columns and regions" — **start switched off**, so the rules get met by playing rather
than by reading the settings screen. "Show rule breaks" stays **on**: it is feedback rather
than assistance, and without it a first wrong hoop produces no response at all, which reads
as a broken page rather than a hard puzzle.

Red that a fresh X brings on waits half a second (`HOLD_MS`), because tapping twice for a
hoop passes through an X that can starve a row or colour for a moment; on phones that
flashed the board red before every hoop. Red already showing stays up, and a hoop that
breaks a rule is red at once. For the same reason a tap-tap hoop undoes as one step,
clearing the square rather than leaving the X behind. And a quick double tap on an X
(`DOUBLE_MS`, 400ms) leaves a hoop: the second tap, which would otherwise run the cycle on
to empty, is dropped.

When a row, column or colour can no longer reach its count, the X's in it go red: the
player's own, and the squares a helper blanked, so a hoop that starves a row with the
helpers on shows where it reaches rather than only reddening the clue.

Wherever a row or column crosses squares that are not on the board (octagon corners, carved
bays, holes in the middle), faint dots carry it across so a clue can be followed to its
squares. They are one weight everywhere, whatever the clue, and only change colour, to red,
when that row or column is broken. Every dot sits on one lattice through the square centres,
so where a row and a column cross they share a dot instead of stacking two.

When a hoop lands on a square a helper would have blanked, the game names the rule that
square breaks and offers the helper:

| Trip | Rule | Screen | Helper offered |
| --- | --- | --- | --- |
| The square touches a hoop already placed | Hoops never touch | "Hoops can never touch" | Blank out around stars |
| Its colour already holds its hoops | Every colour holds N | "That colour already has its hoop" | Blank out a full colour |
| Its row or column already holds its hoops | Every line holds its number | "That row already has its hoop" | Blank out a full row or column |

One screen per rule, each explaining that rule in its own terms, and each offering only the
help for it — which is why "blank out finished units" is two settings rather than one. Asked
on the 1st, 4th, 7th trip of that rule and so on: often enough to teach, rarely enough to
nag. There is no cap beyond that — declining does not stop them, and they can fire more than
once on a board — because "Never show rule reminders" in the gear is the way to switch them
off — offered both in the gear and as a third choice on the reminder itself, since the
moment someone wants them gone is the moment one is in front of them. Counts live in
`hoopla-ruletrips`.

Saying yes switches the helper on **and takes the offending hoop off**: the square it sits
on is exactly the kind the player has just asked to have blanked out, so leaving it there
would contradict the answer. Saying no leaves the board alone — it means "let me do this by
hand", not "fix it for me".

While one is up the board is not merely blurred but flattened to grey, since blurring alone
leaves the regions' shapes and colours readable through it. The clock stops, and so does the
three-second grace on removing a hoop, which runs on the wall clock and would otherwise be
eaten by the time spent reading the question.

The check asks whether a hoop *on that square* breaks a rule, judged against the board as it
stood before the move, and deliberately ignores what was marked on the square itself: a hoop
is normally placed on a square the player has already X-ed, so testing the square's own mark
would mean the touching rule almost never fired.

## Scoring

A golf score in seconds: clock time plus penalties, measured against a target time.

| Penalty | Small Easy | scaling |
| --- | --- | --- |
| Extra hoop | +1s | +1s per step |
| Reveal after a check | +2s | +1s per step |
| Hint | +10s | +5s per step |

A board's step count is +1 for a Big board and +1 for Medium or +2 for Hard, so Small Easy is
step 0 and Big Hard is step 3.

An "extra hoop" is any placement beyond the number the board needs. The counter is visible
while playing, and because it counts every placement rather than every wrong one, it never
tells the player whether a move was right. Removing a hoop within 3 seconds of placing it
doesn't count, which covers misclicks.

**Target time** is computed from the solving trace rather than board size: 6 seconds to look
at the board, plus 1.1 seconds per hoop the player has to place, plus thinking time per
deduction by level (1.2s, 3s, 4.5s, 8s, 13s, 20s), rounded to 5 seconds. Two boards of the
same size get different targets if one needs more work.

A solve with no hints, no reveals and no extra hoops is a "clean solve".

## Screens

Two screens exist, never both at once.

**Picker** — Daily (one button, described on the button, disabled once played), Pick for me
(four rungs plus board type with Random as default), Let me pick (every raw dial, Blank
included), and a gear for settings. A Resume button appears when a puzzle is in progress.

**How to play** — the last button on the menu, "Haven't caused a Hoopla before?". It covers
the controls first, because those were the one thing the game explained nowhere. Then the
three rules, each on a hand-built 3×3, and what Hint, Check and giving up cost. It ends with
"Try it out", which starts the tutorial. The board screen carries a one-line version of the
controls, for the majority who will never open any of this.

The board no longer prints the rules under every puzzle. They are on the how-to-play page,
the reminders teach them in play, and the header chip carries the only board-specific part
(how many hoops a colour holds), so the space is better spent.

## The tutorial

A 6×6 easy board, run with the real drawing and the real input, so what is learned is what
the game actually does. It is guided for two steps and then gets out of the way:

| Stage | Teaches | Offers |
| --- | --- | --- |
| 1 | A square cycles empty → X → hoop | — |
| 2 | Hoops never touch | Blank out around stars |
| 3 | The board is yours | — |

Only the rule that follows directly from placing a hoop is taught up front. The other two
arrive through the ordinary rule reminders, when the player actually puts a hoop in a full
colour or a full line — which is the same lesson, at the moment it means something, instead
of a fourth dialog in a row before any real play has happened. The toolbar comes back at
stage 3, so the rest of it is an ordinary game with no clock and no score.

Inside the tutorial the reminders appear **every** time a rule is broken rather than every
third: someone who declined a helper and then breaks that rule is exactly who the lesson is
for. Those breaks do not count towards the real game's tally, so the reminders met later are
unaffected.

Everyone gets the same tutorial, down to the colours: the board is a literal in the source,
and `colorRegions` skips its usual palette shuffle when the tutorial is running, so two
people comparing notes are looking at exactly the same picture.

The board is one the generator made, then frozen into `TUT_BOARD`. Building it fresh from a
fixed seed does not give the same puzzle twice — the builder runs attempts against a wall
clock, so a slower machine gets through fewer of them and a different candidate wins. It was
checked separately to have exactly one solution, contiguous regions, no hoops placed to
start, and solution squares away from the edges for the no-touching lesson to use.

The example boards are written out by hand rather than generated — the generator starts at
6×6, and an example wants to be small enough to take in at a glance — but they are drawn
with the game's own `drawHoop`, so a hoop there looks like a hoop in play. Each one obeys
every rule, not just the one it illustrates.

The gear appears on every screen and goes straight to settings. The gear again, or Back,
returns to exactly where it was pressed — a particular picker view, or the board mid-puzzle
with the clock picked up where it left off, since opening settings stops it.

A finished daily, or one given up on, offers "Another like this" first and Menu second.
There is only one daily a day, so the way onward is a fresh board with the daily's setup
(shape, hoops per colour, size, difficulty, holes) but no seed. It is an ordinary puzzle:
the daily stays done, and its "Another one" keeps building the same kind. It is built in
the background while the daily is played, so Saturday's big board does not keep anyone
waiting.

**Board** — header, board, and five buttons: Undo, Clear, Hint, Check, Menu. The header
carries the board's title, a chip reading "N per colour" (hidden on Blank boards, which have
no colours; shortened to "× N" below 360px), the timer, and the gear. The chip draws its hoop
in the colour a hoop has while the puzzle is unsolved rather than the gold of a finished one,
since it is a reminder of what to place. The puzzle code sits under the board as a
tap-to-copy chip. Closing the tab pauses automatically. Keyboard: H hint, C check, U undo,
Cmd+Z undo, Esc menu.

Anything the player has to answer — Menu (save and leave, or give up), and the rule offers below — opens as a card over
the board with the board blurred out behind it and **the clock stopped**, so a paused puzzle
cannot be worked on while the question is up. The solution reveal after giving up is
deliberately *not* blurred: the point of it is to look at the board.

Finished rows and columns dim slightly once nothing in them is left to decide.

## Daily puzzles

`Logic.dailyOptions()` derives the day's options from the date: a fixed weekly ramp (easy
square on Sunday through a two-hoop hard board on Saturday) plus a hash of the date as the
seed. Everyone gets the same board. Leaving and resuming is fine; giving up marks the day as
spent.

The date is read in **New York time** (`DAILY_TZ` in `logic.js`), not the device's own
timezone, so the board changes at midnight ET for everyone on earth at the same instant.
No time server is contacted: the device clock is already kept accurate by the OS, and the
only thing that needed fixing was which timezone the date gets read in. This also means the
game keeps working offline. Set `DAILY_TZ` to `'UTC'` to move the reset; nothing else changes.

`nextDailyReset()` and `msUntilDailyReset()` give the instant the board turns over, which is
what the menu counts down to once the day's puzzle is spent. The countdown names one unit at
a time — hours, then minutes inside the last hour, then seconds inside the last minute — and
when it reaches zero the menu unlocks the new board in place, without a reload.

## Puzzle codes

Every board has a code like `OC1SEH-sefwma`: shape, hoops per region, size, difficulty,
optional H for blocked cells and N for no regions, then the seed. The same code always
rebuilds the same board, which is how two people play an identical puzzle. Codes can be
entered under the gear.

Caveat: a code only reproduces a board as long as the generator itself doesn't change. For
anything shipped, generate boards ahead of time and store the finished puzzle rather than
relying on the code.

There is a second caveat, and it is the one that matters for a shared daily. `build` runs
generation attempts against a wall clock, so a device slow enough to get through fewer of
them can settle for a different board. On cheap boards this never happens: 120 easy 6×6
seeds gave identical results whether the budget was 1200ms or 1ms, because the builder is
satisfied long before the clock matters. On expensive ones it does — of 8 big two-hoop hard
seeds, 2 produced a different board on a starved budget, and graded **medium** instead of
hard. Saturday's daily is exactly that setup. Serving pre-generated boards removes this; so
would making the builder stop on a fixed attempt count rather than a time budget.

## Data format

`Logic.toJSON(P)` / `Logic.fromJSON(o)` round-trip a puzzle as plain JSON: width, height,
which cells exist, region per cell, row and column targets, hoops per region, the solution,
any givens, the grade and the code. That object is what an API would return.

Local storage keys: `hoopla-settings`, `hoopla-inprogress`, `hoopla-daily-YYYY-MM-DD`,
`hoopla-best-<code prefix>`, `hoopla-ruletrips`, and `hoopla-migrated` to mark the one-time move off the old
`starproto-*` names. The migration in `ui.js` copies anything still under the old prefix and
can be deleted once no tester has played a build older than 0.1.0.

---

## Build stamp

`<meta name="build">` in `index.html` is the version testers see: on the menu under the
buttons, on the win card, and in whatever the puzzle-code chip copies. **Bump it before
pushing a build to testers** — it is the only thing that says which version a bug report
came from, and it is the one place the version lives.

It also stamps the script URLs. A browser will otherwise pair a freshly deployed page with
the previous build's cached JavaScript, and the moment the markup and the code disagree —
a renamed element, say — the game dies on load for everyone who played before. The loader
at the foot of `index.html` appends `?v=<build>` to each script so that cannot happen, which
is why bumping the build is not optional.

The puzzle code sits next to the title on the board screen. Tapping it copies
`Hoopla <code> · build <BUILD>`, which is the whole of a reproducible bug report: the code
rebuilds the exact board, the stamp says which generator built it.

## Known limits

- The solution ships inside the page, so times are trust-based. Anything competitive needs
  the solution kept server-side.
- Results, bests and daily status live in one browser. Nothing is comparable between people.
- Puzzles are generated on the device. Fine for free play, wrong for a shared daily.
- No accounts, so nothing follows a player between devices.
- The daily is the same board for everyone **only within one build**, since each device
  generates it. Two testers on different builds can get different boards. Timezone is no
  longer a factor: the rollover is midnight New York for everyone. On the hardest boards a
  slow device can also land on a different board entirely — see the puzzle code caveats.
- The rollover still trusts the device clock, so someone who sets their clock forward can
  play ahead. Not worth solving before the backend does it properly.

## Next up

- **Backend**: pre-generate dailies, serve puzzles, take results, keep solutions private.
- **Accounts**: needed for streaks, history and leaderboards across devices.
- **Community times**: once real solves exist, set target times from actual data (the median,
  say) and show where a player lands. The computed target stays the fallback for a board
  nobody has played.
- **Adventure mode**: the rungs make a natural progression to unlock through.
- **Piece packs**: the hoop is one drawing function taking a position and a state, so
  alternate pieces are a cosmetic swap and a natural thing to unlock or sell.
- **Monetization**: no forced ads. Free daily plus recent archive, one-time unlock for the
  full archive and adventure mode, optional cosmetic packs, optional rewarded ads for hints.
- **iOS**: SwiftUI app, with `engine.js`/`logic.js` ported or run server-side.
