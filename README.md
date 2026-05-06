# Chud the trader

A small app: website + server + bot that trades one Solana wallet on memecoins.

---

## Your checklist (OpenClaw + X)

1. **This repo:** `cp env.example .env` → fill RPC, wallet, and (if you use site chat or thought lines) `ANTHROPIC_API_KEY`.
2. **Only OpenClaw trades the wallet:** add `CHUD_OPENCLAW_ONLY=1` to this project’s `.env` and restart so the built-in loop does not fight OpenClaw.
3. **OpenClaw points at Chud (easiest):** from the repo run **`./scripts/setup-openclaw-for-chud.sh`** — it sets `LOBBI_AGENT_BASE_URL`, syncs the skill, and tries to restart the gateway. Then open **`openclaw-skill/PASTE-INTO-OPENCLAW.txt`** in OpenClaw and paste it into a new chat (that file is the “go trade” button in words).
4. **Reasons on-chain + site + X:** OpenClaw’s `POST …/api/agent/buy` body should include `reason`; sells use `POST …/api/agent/sell` with JSON `{ "reason": "…" }`. That text is stored as the bag thesis / sell note, shows on the website, and is preferred for buy/sell tweets when you set the `TWITTER_*` keys.
5. **Posting “chud thoughts” without X API:** set `CHUD_THOUGHT_POST_MINUTES` (value is **minutes**; `60` = hourly). Poll `GET /api/chud/outbox` from OpenClaw and paste `text` with your browser or Telegram tool—or set `TWITTER_*` / `CHUD_X_POST_MODE` so this server posts the same line to X for you.

---

## Fresh start (wipe trades + claw state)

**Stop** anything using port **4000**, then:

```bash
./scripts/chud-reset-data.sh
npm run dev
```

That deletes under `data/`: trades, live claw state, logs, site chat history, coach notes, thought outbox, and the cycle lock. Your **`.env` wallet and keys are not touched.**

- **Live claw on the website (built-in bot):** remove or comment **`CHUD_OPENCLAW_ONLY=1`** in `.env`, then `npm run dev` so the loop runs with the site.
- **Only OpenClaw moves the wallet:** keep **`CHUD_OPENCLAW_ONLY=1`**; the site updates when OpenClaw calls the API (no autonomous loop).

---

## Start it on your computer

Open a terminal in this folder and run one of:

- `npm run dev`
- or `./scripts/chud-dev.sh`

A browser address will print (often port 5173). The server part listens on port **4000**.

You need a file named **`.env`** in this folder. Copy the example:

`cp env.example .env`

Then open `.env` in a text editor and fill the three big things at the top (RPC, wallet key, AI key). The example file explains each line in normal words.

---

## OpenClaw (separate app on your Mac)

Think of it like this:

- **This project** = the wallet + the website + the buttons the internet can hit to buy/sell.
- **OpenClaw** = another program that can *call those buttons* if you tell it where they live.

They are **not** glued together automatically.

**What you do once:**

1. Put this in **OpenClaw’s** settings file (not in this project):  
   File is usually `~/.openclaw/.env`  
   Add: `LOBBI_AGENT_BASE_URL=http://127.0.0.1:4000`  
   (If the server runs somewhere else, use that address instead.)

2. In **this** project folder run: `./scripts/sync-openclaw-skill.sh`  
   Then restart OpenClaw’s gateway so it sees the skill.

3. Keep **this** project running (`npm run dev` etc.) while you use OpenClaw, or OpenClaw has nothing to talk to.

**If OpenClaw should be the only thing trading** (recommended so two bots do not use the same wallet at once): in **this** project’s `.env` add `CHUD_OPENCLAW_ONLY=1` and restart.

**Tweets on buy/sell** come from **this** project’s `.env` (uncomment the Twitter lines in `env.example`). When OpenClaw calls buy/sell with a written **reason**, that text is what goes into the tweet (within X’s length limit). OpenClaw still does not hold your X keys — Chud’s server posts using `TWITTER_*`.

**Auto “chud thoughts” (no X API needed):** set `CHUD_THOUGHT_POST_MINUTES=5` (or whatever). Each tick writes a lowercase shitpost-y line to **`data/chud-outbox.json`** and **`GET /api/chud/outbox`**. Point OpenClaw’s HTTP tool at that URL on a schedule (or chain it after reading) and use your **browser / Telegram** tool to paste and post — stays under X API limits. Optional: still set `TWITTER_*` or `CHUD_X_POST_MODE` if you also want this server to push X directly.

**Two “Claudes”:** OpenClaw uses **your** Claude login inside OpenClaw. This project uses **`ANTHROPIC_API_KEY` in `.env`** only for things that run **inside this server** (website chat + the old auto-trader if it is on). You are **not** supposed to copy OpenClaw’s secret into Chud. If OpenClaw runs all trades (`CHUD_OPENCLAW_ONLY=1`), you still keep `ANTHROPIC_API_KEY` here **only** if you care about the **site chat** tab; trading picks then come from OpenClaw’s Claude, not this key.

---

## OpenClaw skill text

The file `openclaw-skill/SKILL.md` is the instruction sheet OpenClaw reads for trading. Do not delete it.
