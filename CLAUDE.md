# Working on Hoopla

`README.md` explains what the game is and how it works. This file is the part that is easy
to get wrong.

## Bump the build, every single time

The version lives in one place: `<meta name="build">` at the top of `index.html`. **Change
anything that ships and you bump it.**

It is not cosmetic. The loader at the foot of `index.html` stamps that value onto every
script URL, and `ui.js` reads it back for the build stamp. Skip the bump and a returning
player's browser pairs the freshly deployed page with the previous build's cached
JavaScript. That was survivable while the two only drifted, but the moment the markup and
the code disagree — a renamed element, say — the game dies on load for everyone who played
before. It has already happened once.

## How to see a change

There is no test suite, and there is no build step for hosting. Verification means running
the page and driving it.

```sh
python3 -m http.server 4173      # then open http://localhost:4173
```

`.claude/launch.json` has the same thing as a named config. Prefer driving the real page —
placing hoops, opening dialogs, reading state — over reasoning about whether a change works.
Most of the bugs in this project's history were found that way and would not have been found
by reading.

## Deploying

GitHub Pages serves the **repository directory** — `index.html` plus the three JS files.
Push to `main` and it deploys itself. `dist/hoopla.html` is not in that path.

Pages sets `max-age=600`, so for up to ten minutes after a push a returning visitor may
still see the previous version. It self-corrects. Do not go and wait for it.

## dist/hoopla.html is generated

Run `sh build.sh`. It replaces everything between the `<!--SCRIPTS-->` markers in
`index.html` with the three JS files inlined. Never hand-edit it. It exists for handing
someone a single file to open locally, nothing else.

## Things that must stay true

- **Every puzzle has exactly one solution.** The generator verifies this. Anything
  hand-authored must be checked rather than eyeballed — the tutorial board and the
  how-to-play examples both failed this on their first draft.
- **Hand-made example boards obey all three rules**, not just the one they illustrate. An
  example that breaks the no-touching rule while teaching regions undermines both.
- **`engine.js` and `logic.js` touch no DOM** and export for Node, so a server can run the
  identical generator. Keep it that way; the backend depends on it. `ui.js` is the only file
  that knows about the page.
- **The blanking helpers default off** and are taught by the tutorial and the rule
  reminders. The tutorial switches each one on right after the move that teaches its rule
  (Jeremy's call, 2026-09-24); anyone who skips it starts with them off. Turning them on by
  default would remove the thing they are there to teach.
- **The tutorial board is frozen** in `TUT_BOARD` and its palette shuffle is skipped, so
  every player gets the same board in the same colours. Regenerating it would lose that.
- **The tutorial board has one legal move at every step** from its fixed start, and each
  stage rings that square and names why. Any edit to `TUT_BOARD` or `MOVES` must keep that
  chain, re-checked, not eyeballed: exactly one solution (`Engine.solve`) and exactly one
  forced square at every move. The README's tutorial section says how it was verified.

## Measured, not assumed

Two findings worth not rediscovering:

- **Generation is deterministic across devices and browsers; keep it that way.** Two things
  broke that until 0.13.2. A random draw inside a sort comparator (region growth) made the
  board depend on how often the engine's sort compared, which differs between Chrome and
  Safari and even between the first and later runs in one page. And both the generator and
  the builder stopped on a wall clock. Now they stop on work (solver nodes), and all 51
  picker/daily setups fingerprint identically in Chrome and in Safari's engine. Never call
  `r()` inside a comparator or a callback whose call count the engine decides, and never
  let time decide what gets built.
- Safari's engine runs from the command line with no install:
  `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc engine.js logic.js test.js`
  (use `print`). It is unthrottled, unlike the hidden browser pane, so it is where build
  timings should be measured.
- **Every setup builds in under a second** (slowest ~0.85s on a Mac in `jsc`, all 51 setups,
  12 seeds each, no failures, 4 of 612 off-grade). Keep it there: re-run that benchmark after
  any generator change. Big Blank and big two-hoop Carved used to take up to 6s or fail; the
  causes were a solver that ignored givens and a repair that gave up in carved corridors.
- **Hoops handed to the player are capped by board size** (`Engine.givenCap`): up to 64
  squares 1, up to 90 squares 2, above that 4. Jeremy's rule. Generator pins and the
  builder's too-hard pins share the cap, and a final pass removes any the puzzle does not need.
- Region colours are shuffled per board by `colorRegions`, so the same board looks different
  between sessions. Only the tutorial opts out.

## Where things are

| File | |
| --- | --- |
| `index.html` | markup, all styles, the build meta, the script loader |
| `engine.js` | board shapes, generation, solver |
| `logic.js` | grading, hints, scoring, codes, the daily, serialization |
| `ui.js` | screens, drawing, input, the tutorial |
| `icons/`, `manifest.webmanifest` | home-screen icon and name |
