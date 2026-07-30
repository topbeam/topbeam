# Topbeam

> **Folder ↔ package map (added 2026-07-30):** this directory is named `ocean-cli/` for historical
> reasons — the product was renamed Ocean → **Topbeam** on 2026-07-28. **`ocean-cli/` IS topbeam**:
> npm package [`topbeam`](https://www.npmjs.com/package/topbeam) · CLI command `topbeam` · repo
> [`github.com/topbeam/topbeam`](https://github.com/topbeam/topbeam). The working directory the tool
> writes on disk stays `.ocean/` **on purpose** (`src/state.ts`: no data-migration risk).
> *Verified 2026-07-30: registry latest `0.1.2` (published; `0.1.1` is deprecated).*
> If you are looking for "where is topbeam" six months from now — it is here.

An honest project board for vibe coders. Topbeam doesn't narrate your project;
it tells you **what is true right now, and the one move that gets you forward.**

Local-first: **no LLM calls.** The summary is **deterministic** — built from the
tool-use records in your Claude Code transcripts plus git facts.
**The model's prose cannot reach the summary** (the assistant's "done, it works!"
sentence is not read on any path; only the structural `tool_use` / `tool_result`
fields are), and every number you see on screen comes from a measurement.

> **But "deterministic" ≠ "always right".** The mapping that binds claims to
> records is heuristic (path / extension / label); wrong matches and misses are
> possible, and the code deliberately prefers one side of that trade:
> *missing something is better than accusing wrongly.*
> The sentence "hallucination is impossible" is never used in this product —
> it would overclaim what a heuristic mapping can actually do.

**One external source: an optional CI read.** If `gh` is installed and logged in,
Topbeam asks one question — *"is this commit green in CI?"* — the only fact you
can't learn locally. No `gh`, no login, no network: it passes quietly.
`--no-ci` / `TOPBEAM_NO_CI=1` turns it off entirely and then Topbeam makes
**not a single outbound call** (see [CI (optional)](#ci-optional)).

**Topbeam by REVERI** — *"topping out"*: the last beam nailed to the top of a
building, the finishing ceremony. That's what a full BuildPassport bar is.

## Install

The command is **`topbeam`** and the npm package is **`topbeam`** — one name,
one token. (No short alias: there is no `beam`.)

```bash
npx topbeam init          # try it without installing
npm i -g topbeam          # or install it for good
```

`topbeam` is on npm (MIT, zero runtime dependencies). The published version is
`0.1.2` — `0.1.1` is deprecated and should not be installed. Whatever you have,
`topbeam --version` is the one that tells you the truth about it.

### Install from source

```bash
git clone https://github.com/topbeam/topbeam.git
cd topbeam
npm install
npm run build
npm link            # puts `topbeam` on your PATH
```

Check the install:

```bash
topbeam --help      # help text and version should appear
```

To undo: `npm unlink -g topbeam`.

If you'd rather not `npm link`, run it without installing globally:

```bash
node /full/path/topbeam/dist/cli.js sync
```

Requires Node >= 20. No runtime dependencies (single-file bundle).

### Repo and links

- Source (MIT core): <https://github.com/topbeam/topbeam>
- npm: <https://www.npmjs.com/package/topbeam>
- Landing: <https://topbeam.surge.sh>

## Data directory: why it is still `.ocean/`

The brand is Topbeam, but the data directory in your project root is **`.ocean/`**
and the file names inside it (`state.json`, `pano.html`, `passport.jsonl`,
`goal.md`, `notes.md`, `gozlem.jsonl`) **did not change** — a deliberate call:
we're not taking a data-migration risk with existing installs. Same reason the
environment variables keep the `OCEAN_*` prefix.

Two command names are also Turkish and stay that way, because that's what people
already type: `gozlem` (observation) and `makbuz` (receipt).

## The seven commands

### `topbeam init`
Connects the project to Topbeam. Idempotent — a second `init` overwrites nothing
and tells you what it did.

- `.ocean/` is created: `state.json` (state), `goal.md` (goal **+ delivery
  promises**), `notes.md` (short notes). `goal.md` contains **no promises** —
  on purpose: the promise is yours, a tool cannot make it for you. Until you
  write one, no bar is drawn.
- The line `.ocean/` is added to the project `.gitignore` (the file is created if
  missing): `state.json` carries the text of the commands you ran, and
  `git add -A` shouldn't sweep that into your repo. This one is done without
  asking — but it is printed on screen. No silent changes.
- Your `CLAUDE.md` is touched **only with your consent.** Topbeam prints the exact
  block it would append, then asks `Add it? [y/N]`. No question can be asked
  in a pipe or CI, so in that case **nothing is added**.
  `--claude-md` appends without asking; `--no-claude-md` never touches the file.

> **Why the consent gate exists — found while hardening, 2026-07-29.** `init` used to
> append 15 lines of permanent behaviour instructions to the user's `CLAUDE.md`
> without asking and with no way back. In the test repo that file said
> *"Always answer in English. Never edit files without asking."* — the tool broke
> both rules at once. Writing instructions into your Claude is your decision,
> not the tool's. Whatever it did write can be taken back: `topbeam uninstall`.

### `topbeam sync`
Reads Claude Code transcripts (`~/.claude/projects/...`) and git facts →
produces evidence-ruled claims, the log history and the **single-next-move card**
→ writes `.ocean/pano.html`. Human approvals are never rolled back.

Flag: `topbeam sync --no-ci` → the optional CI read is skipped entirely (below).

### `topbeam verify <id>`
Shows one claim, lists its evidence, asks for your approval (e/H). If you approve:

- the claim rises to **`insan-onayi`** — human approval, the only legitimate way
  up,
- a line is appended to `.ocean/passport.jsonl` (append-only, immutable approval
  ledger),
- **if the bar fills** (every delivery promise human-approved) `.ocean/muhur.md`
  is written once, plus a macOS notification titled *Topbeam*: "Every delivery promise is now human-approved 🎉".
  (In the planned pricing this notification sits on the Pro side; in today's
  build it is on for everyone and there is no licence check in the code — see
  [Pricing](#pricing-planned--open-core).)

`<id>` can be a single record or a **delivery promise** (`soz-…`). Give it a
promise and every record matching that promise is printed, then approved with one
question. A promise with no records cannot be approved, and if a promise covers
more than 10 records you are warned before the question is asked — Topbeam does
not collect rubber stamps.

> #### ⚠️ The limit of this gate — measured, and not hidden
> An approval is written only if `process.stdin.isTTY` is true. That cuts plain
> pipes and redirects: `echo e | topbeam verify …` writes no approval and does not
> even ask the question. So an approval cannot appear by accident, or as the side
> effect of some script.
>
> **But this is a speed bump, not a wall.** `script(1)` ships with macOS, opens a
> fake pty and makes `isTTY` return `true`; `expect`, python's `pty` and
> `node-pty` do the same. Anyone who deliberately sets out to automate approvals
> will get past it.
>
> That is the strongest *accurate* sentence available here. "bots cannot approve",
> "an agent cannot fake a terminal", "structurally impossible" — none of those are
> honest, and they are never used in this product: `script(1)` passes it, a pty can
> do the rest. A mislabelled honesty badge is worse than no badge at all.
> (A test keeps those sentences from coming back:
> `src/verify.test.ts` → *"kaynak metinlerde mutlakçı kapı iddiası bulunmaz"*.
> On 2026-07-30 that sentinel was opened to English too — otherwise translating
> these pages would have quietly disarmed it.)

### `topbeam gozlem "<text>"`
Records **your own testimony** — the part of the work a machine cannot see.

```bash
topbeam gozlem "ran it on a real project for a week — I stopped keeping a separate list of what was done"
```

Why it exists: Topbeam only read transcripts, git and CI. But most delivery
promises are lived experience ("the person using it feels the mess is gathered",
"the client said it was worth it"). Those have no machine counterpart → no record
is created → `verify` says "no records" → that segment of the bar could never
fill.

**This is not evidence, and the code keeps it that way:**

- the level is locked to `dogrulanmadi` (not verified) — the machine verified
  nothing,
- the evidence type is a separate class, `insan-gozlemi`, and its line reads
  "İnsan beyanı — ÖLÇÜM DEĞİL" (*human statement — not a measurement*), with your
  OS username and the timestamp,
- it can never rise to file evidence or test evidence; that ceiling is enforced in
  `src/gozlem.ts`, the one place observations become claims.

It can still be raised to human approval with `verify` — approval was always the
human's job; what was missing was a way to put the off-machine work on the record.

Stored in `.ocean/gozlem.jsonl`, append-only. Nothing is deleted: if you wrote it
wrong, write another one; the old line stays. Broken lines are skipped **and
counted** — no silent deletion. Every `sync` re-reads the ledger, because the
engine cannot regenerate these from a transcript.

### `topbeam open`
Prints the board's path. It does **not** open your browser — you do.

### `topbeam makbuz`
Produces a one-page delivery receipt you can show **outside**:
`.ocean/makbuz.md` (add `--html` for `.ocean/makbuz.html` too). The board looks
*inward* (your screen); the receipt goes *outward* — to a client, a team, an
employer. It writes the file and tells you the path; it does not open it, send it
or publish it.

### `topbeam uninstall`
Takes back the traces Topbeam left **in your files**: the `## Topbeam` section in
`CLAUDE.md` (nothing else in that file is touched) and the `.ocean/` line plus its
comment in `.gitignore`. After removing the gitignore line it warns you that
`.ocean/` is no longer ignored and contains the text of commands run in this
project — look before you commit.

**`.ocean/` stays.** Deliberately. `passport.jsonl` is your signed approval
ledger: append-only and not reproducible. Transcripts are already deleted after 30
days, so the ledger may be the only surviving record of that work. An `uninstall`
command quietly destroying your only permanent record is not acceptable.
The command prints how many signed approvals it is leaving behind.

`--purge` deletes `.ocean/` as well — and then says exactly what you lost:
*"N signed approval records were deleted and cannot be brought back. That was the
only lasting proof you checked this work with your own eyes."*

## The board (`.ocean/pano.html`)

One static file, system fonts, one small piece of JS (the copy button).
Top to bottom:

1. **The single next move** (the dominant element): what is true now + the
   certainty level · evidence on three separate lines (git diff / test output /
   human approval) · the single most important unknown · one verb + a runnable
   command · why this one · what counts as done · a "start verifying" box
   (`topbeam verify <id>`, copyable).
2. **Delivery promises + the BAR** (right under the card; the card stays
   dominant): every `- [ ]` line in `goal.md` is one segment. The count reads
   "3 / 7 items approved" — **no percentages**, no partial fills. A segment fills
   only through a terminal-signed human approval in the `passport.jsonl` ledger.
   With no promises the bar is **not drawn at all** ("write your delivery promises
   into `.ocean/goal.md`, that's where the bar fills") — an empty bar would be a
   fake affordance.
3. **The scope of this board — and what it doesn't know**: what was filtered out
   and how much of it, with a trace left behind.
4. **Log history**: the timeline — git/test facts, Claude's statements (badged
   "beyan" / statement; not evidence, and folded shut by default), human approvals.
5. **The ledger**: the archive of session records — counted neutrally
   ("11 session records · *this is not a measure of progress*"). Those lines don't
   push a `verify` command: asking for approval on a 99-file archive unit
   manufactures rubber stamps.

## Why does the bar come from `goal.md`? (the Sisyphus bar)

The bar's unit used to be a **Claude Code session**. The result: every new coding
session grew the denominator — 0/11 today, 0/12 tomorrow if you keep working. The
more you worked, the further the bar receded. And "2026-07-11 · 99 files · 40 test
runs" is an archive record, not a product promise; asking for approval on a unit
like that produces rubber stamps and devalues human approval.

Now **the unit is a sentence a human wrote**: the `- [ ]` lines in
`.ocean/goal.md`. Finite, fixed, human-defined. Adding a session doesn't grow the
denominator; it grows only when you write a new promise.

### The second face of the same flaw: approval is not revoked

Fixing the denominator wasn't enough. Measured live in this repo on 2026-07-30:
after approving a promise, if you kept working in the same area, a new unverified
record matched the same promise and **the bar went backwards — 1/5 → 0/5, while
the human signature was still sitting in the ledger.** The denominator was stable;
this time the numerator was melting. Same outcome: the more you work, the further
the finish line — the exact thing this product exists to fix.

The correct model: **an approval is a fact about what a person saw at that moment.**
Later work does not invalidate it; later work is new, separate work. So a promise
stays `completed` — but the new work is not silenced either: the reason line says
*"Human-approved (2026-07-30). Since the approval, N new unverified records
appeared in this area — an approval is not revoked, but new work is new work."*

The distinction that was kept: "approval is not revoked" ≠ "stays approved even if
its basis evaporates". If **no** approved record survives — the approved record
itself fell away because the transcript changed or the 30-day retention deleted it
— calling the promise complete would be a lie. It drops to `partial` and says why:
the signature is still in the ledger, but the record you approved can no longer be
reproduced.

### Evidence matching rules (deterministic, no LLM)

A promise line is bound to records by these hints:

| Hint | How you write it | What it matches |
|------|------------------|-----------------|
| path | `src/auth`, `src/cli.ts`, `README.md` | records touching that path (or anything under that directory) |
| test | the line starts with `test:` | test-run records only |
| tag | `#odeme` somewhere in the line | a tag appearing in the record's text or path |

- A promise's **level** = the **highest** evidence level among its matching records.
- With no hint, or with no record matching, the item stays at **"no evidence"** —
  a match is never invented.
- Path hints are ASCII: Turkish phrases like "giriş/çıkış" are not mistaken for
  paths.
- `test:` and a path together means both conditions must hold.
- A `- [x]` you ticked by hand is a **statement**; it doesn't fill the bar (and it
  is labelled as such).
- Change the text of a promise and its id changes: the old approval doesn't cover
  the new sentence (the record stays in the `passport.jsonl` ledger regardless).

## The seal (`.ocean/muhur.md`)

Written once, when the bar fills — "topping out": the last beam nailed to the top.
It states its own scope honestly: how many promises, when they were locked, which
records and which signatures it rests on — and **what it does not mean** (it does
not mean "the product is bug-free"). The seal is written only at the moment of the
last **approval** — you cannot obtain one by deleting promises.

## The receipt (`.ocean/makbuz.md`) — the one page you show outside

The board is private; **the receipt is shared.** `topbeam makbuz` produces a
one-page delivery record in Markdown (paste it anywhere), or with `--html` a
single-file HTML (inline styles, **zero external requests**, no JS).

What's in it:

- project name · date · tool version · the goal sentence (marked as a statement),
- the **delivery promises**, each with its evidence level and status,
- an **evidence summary**: how many file-evidence / test-evidence / human
  approvals, the last test measurement, and the **commit SHAs** read from state,
- **"what it doesn't know"**: what was filtered out (edits outside the project,
  unrelated statements, check commands, log line chains), and a note if this isn't
  a git repo,
- **"what this does NOT mean"**: the receipt's own limits.

**So a third party can re-verify it themselves**, a copyable block sits in the
middle of the receipt — no "trust me", just "look for yourself":

```sh
git show <sha> --stat     # SHAs were read from this repo (otherwise: "no record")
npm test                  # test command comes from package.json; never invented
cat .ocean/passport.jsonl # the immutable record of human approvals
topbeam sync && topbeam makbuz   # regenerate the receipt from scratch
```

Honesty gates (locked by tests):

- An item shows `- [x]` only if it is bound to a **terminal-signed** approval in
  the `passport.jsonl` ledger. An item claiming `completed` with no counterpart in
  the ledger is shown **unapproved**, with the reason written out (not deleted,
  not hidden).
- SHAs, commands and numbers are **never invented**: no record, and it says
  "no record".
- When nothing is approved the receipt is **still produced**, but it opens with
  "no item has been human-approved yet — this is NOT a delivery sign-off".
  There is no fake seal, no fake badge.
- Like every text that hits disk, the receipt goes through secret redaction
  (`redact`) — on a file that leaves your machine, that's the most critical gate.

## What does the card pick? (the rule ladder)

The card picks the **highest-risk** item among the unverified work and states its
reasoning in the "Why this one?" line. The order is fixed, first match wins — all
deterministic, no LLM:

| # | Rule | When | What the reason line says |
|---|------|------|---------------------------|
| 1 | `kirik-test` | a failure count read from test output, or a real error exit (1–127) | how many tests failed / which exit code |
| 2 | `kritik-dosya` | unverified work touched payments · auth/session · data schema · config files | the kind + the file name |
| 3 | `kayip-riski` | a cluster of 4+ files with no trace in git | how many files in the cluster |
| 4 | `bayat` | **all** unverified work is 3+ days old (nothing fresh) | how many days the oldest has waited |
| 5 | `kume` | 2+ unverified records in the same session | records in the cluster + scope |
| 6 | `en-yeni` | the base rule / fallback | "the most recently touched unverified work" |

Where the rules stop:

- A rule fires only on **measured** signal (file count, path, git trace, test
  numbers read from output). No signal, the rule stays quiet and the card falls
  back to `en-yeni` — claim text is not parsed (text matching produces false
  positives).
- Critical-file matching requires **whole tokens**: `src/auth/login.ts` is
  critical, `src/author.ts` and `tokens.css` are not. Missing something is better
  than accusing wrongly.
- A run killed by a signal (exit ≥ 128: timeout, Ctrl-C) is **not** counted as a
  broken test — that's an interruption.
- No rule changes an evidence level: `dogrulanmadi` stays `dogrulanmadi`. The
  rules only set **order and reasoning**.

## CI (optional)

Everything else in Topbeam is local. CI is the **only external source**, and it
asks one question: *"is this commit green in CI?"* — the one fact you can't get
from your terminal in five seconds.

**How it behaves**

| Situation | What Topbeam does |
|---|---|
| `gh` installed + logged in + repo on GitHub | `gh run list --json …` (read-only, one command) |
| `gh` not installed | Passes quietly. **Does not ask you to install it.** Scope note: "CI record could not be read: `gh` is not installed" |
| No login / no permission / no network / no remote | Passes quietly + writes the reason as one line in the scope note |
| `--no-ci` or `TOPBEAM_NO_CI=1` | **Not a single outbound call is made** |

**The matching rule — nothing invented.** A CI run counts only if its `head_sha`
matches a known commit of this repo **exactly** (all 40 characters, full string).
A short-hash prefix is not enough. Runs that don't match are dropped, and how many
were dropped is written into the scope note.

**How results are read**

- `success` → a claim at `test-kaniti` level: *"CI green: 2 workflows succeeded on
  commit `abc1234`"*. If that commit isn't HEAD, **how many commits behind** it is
  gets written. If your working tree is dirty, it adds *"CI has not seen these
  changes"*.
- `failure` → a broken signal: the card puts it **in front of everything** via the
  `kirik-test` rule. The "done" condition is not a local test: *CI must go green
  on the same commit* — `npm test` passing locally does not turn CI green, and the
  card says so.
- Other outcomes (running, cancelled, skipped) produce **no claim**; they stay in
  the scope note. Outcomes are not invented.
- CI has no pass/fail counts and no exit code → Topbeam doesn't write any. The
  only thing measured is the `failure` result.
- A green CI does **not** clear a broken run recorded locally (different
  measurement, different tree), and the reverse holds too — a local green does not
  demote a red CI from the headline.

## What it reads · what it writes · what it never does

This tool reads your Claude Code transcripts. "Why would I allow that?" — the
answer was in the code but not written down. Now it is.

**READS (read-only):**

- `~/.claude/projects/<project-slug>/**/*.jsonl` — only sessions belonging to this
  project (plus `subagents/`). The fields read are STRUCTURAL: `tool_use` /
  `tool_result` / `timestamp` / `cwd`. **The assistant's free text is not read** —
  "done, it works!" cannot reach the summary by any path.
- `git` output: `rev-parse` · `status --porcelain` · `log` · `diff --numstat`.
  All read-only; **not one byte is written** to the repo.
- Optional: `gh run list` (CI status). Turned off with `--no-ci` or
  `TOPBEAM_NO_CI=1`, and then **not a single outbound call is made**.
- Its own files in the project: `.ocean/goal.md` (your promises), `.ocean/notes.md`
  (read back into the log as statements), `.ocean/passport.jsonl` (the approval
  ledger — the only thing that fills the bar), `.ocean/gozlem.jsonl`, and the
  `"test"` script in `package.json` (the receipt prints that command; it never
  invents one).

**WRITES (only inside `.ocean/` in the project root):**
`state.json` · `pano.html` · `goal.md` · `notes.md` · `passport.jsonl` ·
`gozlem.jsonl` · `muhur.md` · `makbuz.md` (+ `--html`). Plus, at `init` time: the
`.ocean/` line in your `.gitignore`, and — only with your consent — a section in
`CLAUDE.md`. Both of those can be taken back with `topbeam uninstall`.

**Writes do not follow symlinks.** Measured, not theoretical: when
`.ocean/pano.html` was a symlink, `sync` overwrote the target file.
Reproduction: `ln -s ~/victim.txt .ocean/pano.html && topbeam sync` →
`victim.txt`: 33 bytes → 14205 bytes, user data gone for good. Symlinks travel in
git (mode 120000), so an attacker needs no prior write access — "clone the repo and
run topbeam" is enough. The fix is not `lstat` (that leaves a TOCTOU race) but
`O_NOFOLLOW`, which is atomic in the kernel: if the final component is a symlink
the open fails with ELOOP and the write never happens. Second gate: `.ocean` itself
may be a symlinked directory, so its `realpath` is checked to be under the project
root. A refused write is a deliberate decision, not a crash — it exits with
**code 2** (1 = ordinary error) so your scripts can tell them apart.

**NEVER:**

- Sends data over the network. No telemetry, no account, no sign-up.
- Calls an LLM. The summary is rendered from templates.
- Makes a promise on your behalf, or an approval on your behalf.

**⚠️ But the RECEIPT you share contains your command text and file paths.**
The redaction filter (`src/redact.ts`) covers API-key, token and password
patterns — it does not claim to know every shape of secret. Read the receipt
before you send it.

## ⚠️ Evidence evaporates in 30 days

This isn't a flaw in the tool — it's Claude Code's behaviour; it's written here
because it hits Topbeam directly.

Claude Code deletes transcripts after `cleanupPeriodDays` (default **30 days**).
Once they're gone, Topbeam's file and test evidence **cannot be regenerated**.

**Measurement (2026-07-29, this machine):**
```
transcripts on disk      : 1903
age of the oldest file   : 28 days
files older than 30 days : 0
```
None of them cross 30 days — the cleanup really does run.

**What that means:** for work older than 30 days, the evidence is gone. On the
next `sync` those claims drop out as "could not be regenerated".
**Your human approvals in `.ocean/passport.jsonl` remain** (append-only, your
signature) — but what they rested on may be gone; the receipt doesn't hide that,
it says "no record".

Topbeam warns you before you lose anything: when the oldest transcript reaches
**25 days**, `sync` prints a note saying the records are about to be cleaned and
that the only lasting thing is the approval ledger.

**What you can do:**

- Extend retention: `~/.claude/settings.json` → `"cleanupPeriodDays": 180`
- Or approve the work when you finish it — the approval ledger is permanent, the
  transcript is not.

## ⚠️ This tool depends on an internal format

Topbeam reads the **internal structure** of Claude Code's transcript files. That
format belongs to Anthropic; **it can change between versions, without notice.**

Rather than hide this, Topbeam tries to **say it**: unrecognised lines are counted
and land in the scope note. If the format changes one day, the board will not say
"all good" — it will print how many records it could not read.

This is the product's one known structural dependency risk. It's an accepted risk,
not a stored-up surprise.

## The Honesty Principle (the product's constitution)

- **No claim is shown without evidence.** The evidence levels:
  `dosya-kaniti` — file evidence, seen in git diff (transcript ∩ git);
  `test-kaniti` — test evidence, a pass/fail count read from output;
  `insan-onayi` — human approval, a person checked it in their terminal;
  `dogrulanmadi` — looks applied, nobody has confirmed it.
- **`transcript ∩ git` is established two ways** — *committing your work does not
  destroy evidence:*
  1. **working tree** — `diff --numstat HEAD` ∪ `status --porcelain`
  2. **commit** — a commit touching that path, made **after** the edit
     (the evidence line prints the SHA; a third party can run
     `git show <sha> --stat`)

  > **Why rule 2 exists:** a file that was committed and left a clean tree does not
  > appear in set 1. Looking only at 1, the same work produced a new claim —
  > *"no trace in git — not verified"* — that claim matched the same delivery
  > promise, and the promise fell from `completed` to `partial`. Measured result:
  > **the bar went 2/2 → 1/2** — that is, committing your work emptied your bar.
  > (Fixed 2026-07-29; regression tests live in `src/truth.test.ts`.)
  >
  > **Time discipline:** a commit counts only if it came **after** the edit.
  > Otherwise a weak fact — "this file was committed at some point in the past" —
  > would masquerade as evidence for a current edit. If the timestamp can't be
  > read, no commit evidence is built: missing something is better than accusing
  > wrongly.
- **"It works" is never said automatically** — only with test evidence or human
  approval.
- Numbers are not invented: if no number could be read from test output, the claim
  stays `dogrulanmadi`.
- **An approval is not revoked.** It is a fact about what a person saw at that
  moment; later work does not undo it — but later work is reported, not swallowed.
- **Human testimony is not measurement.** `topbeam gozlem` is recorded next to the
  evidence and never mixed into it: level locked at `dogrulanmadi`, its own
  evidence class, its own wording.
- No percentage progress, no motivational lines, no red alarms. Calm, plain
  language.
- Every text that hits disk passes the secret-redaction filter (API keys, tokens,
  password patterns).
- **For anything it didn't measure, this board says "I don't know" — not
  "it isn't there".**

## Pricing (planned) · open core

> **What's true today:** there is no payment page, and this version locks no
> feature — there is no licence check in the code. The boundary below is the one I
> *plan* to draw. It's here so you know it before you install, not so you discover
> it afterwards.

**Free — $0, one project, no time limit**

- One project
- The full card — the single next move
- Log history
- Manual verification (`topbeam verify`)
- Basic passport record (for that project)

**Topbeam Pro — $5/month · $50/year (founding price, $9 afterwards)**

- Unlimited projects
- Portable passport history across projects
- The full-bar notification + advanced verification flows
- The founding price holds for as long as the subscription does

**Open core.** The reading core — transcript parsing, the git intersection, the
evidence rules, the card — is **MIT** licensed (`LICENSE`, `package.json` →
`"license": "MIT"`; it ships inside the package too). The paid layer stays closed.

This boundary is stated **identically** in three places and this file is the
single source of truth: this README; `README.tr.md` is the Turkish build and currently lags it (it still documents five commands, before `gozlem`, `uninstall` and the CLAUDE.md consent gate). ·
the pricing section of `site/index.html` · and the launch kit that carries the
Reddit / HN / X copy, which is **not in this repository** — it lives outside the
published tree, so you cannot check it from here (and it, in turn, calls itself
the source of truth; that contradiction is unsettled). If the boundary changes,
all three change together.

## Environment variables

| Variable | What it does |
|---|---|
| `OCEAN_CLAUDE_DIR` | Root to use instead of `~/.claude` (tests / isolation) |
| `OCEAN_NO_NOTIFY=1` | Turns the macOS notification off entirely |
| `OCEAN_NOTIFY_BIN` | Binary to use instead of `osascript` (tests) |
| `TOPBEAM_NO_CI=1` | Turns off the optional CI read (same as `--no-ci`) — no outbound call is made |
| `TOPBEAM_DEBUG=1` | Prints the full stack trace on an unexpected error (normally a single calm line) |

## Development

```bash
npm test            # node:test — fully isolated (never touches your real ~/.claude)
npm run typecheck   # tsc --noEmit (strict)
npm run build       # esbuild → dist/cli.js
```

The code comments, commit messages and test names are in Turkish and stay that
way — that's where the reasoning was written down, and translating it would
flatten it.

**Publish gate.** `prepublishOnly` runs typecheck + tests + build, then
`scripts/yayin-kapisi.mjs`: it runs `npm pack`, unpacks the tarball and checks
`node dist/cli.js --version` against `package.json`. If they disagree, the publish
stops. The reason it exists: the 0.1.1 published on 2026-07-29 introduced itself
as "v0.1.0", and the receipt wrote that version out to the world. In an evidence
product, that is not something to fix after the fact.
