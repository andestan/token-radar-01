# Token Radar — model radar-2 (make.fun token-radar-01)

Entry for the make.fun competition **token-radar-01** (deadline 14 Dec 2026 17:00 WIB).
It ranks pre-token DeFi protocols by implied token value, from a frozen DefiLlama
snapshot (`as_of` 2026-11-14, 758 protocols with TVL ≥ $5M, watchlist floor $50M).

## How to run

Node 22+ (stdlib only, no build, no install), from this directory:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /tmp/kit-tr/token-radar-01-kit/input/snapshot.json
```

This writes `out/board.json`, `out/data.js`, copies `dashboard/` + `screenshots/`,
and writes `out/dossier.json` via the vendored make.fun library (`vendor/makefun-board.ts`,
copied byte-for-byte from the kit — never edit it).

## The model (radar-2)

`implied = round(TVL × category_multiple × growth_multiplier × maturity_multiplier)`, min $1.

- **Category multiple** — the median `mcap_usd / tvl_usd` of the protocol's own
  category's live-token peers in this snapshot. A peer is a protocol with
  `mcap_usd > 0` and `tvl_usd > 0` whose category is not `CEX` (exchange tokens are
  priced on exchange cash flows, not protocol TVL; mcap 0 / −1 entries are data
  artefacts, not prices). Categories with fewer than 3 live peers fall back to the
  global median over all live peers. Multiples are clamped to [0.05, 1.50].
- **Why the median** — a few live tokens trade at absurd multiples (one
  prediction-market token at ~400× TVL); the mean would let outliers price a whole
  category, the median tracks the typical peer.
- **Why the clamp** — a median below 0.05× or above 1.50× would come from a tiny or
  distorted peer set; the clamp keeps one thin category from pricing a board at ~0
  or at several times its TVL.
- **Growth** — `clamp(change_7d ?? 0, −60, 120)`; `growth_multiplier = 1 + (growth/100) × 0.5`.
- **Maturity** — `0.6 + min(age_days, 1095)/1095 × 0.4`; `age_days` is days from
  `listed_at` to `as_of`, unknown age counts as 365 days.
- Every row of `board.json` carries its breakdown in `model`:
  `base_multiple` (the category multiple used), `growth_pct`, `growth_multiplier`,
  `maturity_multiplier`, `age_days`, `category_peers`.

The program recomputes every multiple from the snapshot on each run, so the table
below documents what the snapshot says rather than being a constant the model trusts.

## Measured multiples (snapshot 2026-11-14, strict peer rule)

Global fallback: **0.2460** (n = 119 live peers, no CEX).

| Category | Peers | Median (used) |
|---|---:|---:|
| Dexs | 11 | 0.3424 |
| Lending | 15 | 0.1324 |
| Liquid Staking | 9 | 0.0406 |
| RWA | 9 | 0.2748 |
| Basis Trading | 7 | 0.6544 |
| Cross Chain Bridge | 4 | 1.2205 |
| Yield | 9 | 0.1914 |
| Canonical Bridge | 8 | 0.7464 |
| Bridge | 6 | 0.5567 |
| Yield Aggregator | 4 | 0.1510 |
| CDP | 3 | 0.1687 |
| Indexes | 3 | 0.1477 |
| Privacy | 3 | 0.9691 |
| Liquid Staking | 9 | 0.0406 → clamped to 0.05 |
| All other categories | <3 | 0.2460 (global fallback) |

Note: an earlier draft of these notes quoted a global median of 0.241 (n=120) and
Yield 0.180. Re-measuring with the strict peer rule (`mcap > 0`) gives 0.2460
(n=119) and Yield 0.1914 — the earlier figures counted one mcap-0 protocol as a
peer. The strict figures are the ones the code uses. The Bridge, Canonical Bridge
and Liquid Staking multiples above are still measured from live peers, but no board
row uses them any more — those categories are excluded from the board (see below).

## The board

198 rows: all 40 watchlist protocols plus 158 rankable pre-token protocols below
the $50M floor. Rankable = pre-token (`mcap_usd`, `gecko_id`, `symbol` all null),
category ≠ `CEX`, name not ending in a version marker (` V2`, `2.0`, …), and not a
wrapped / staked / bridged product (see below). Ranked by implied value descending,
ties broken by slug ascending. Each row also carries a 6-step farm plan derived from
the protocol's own category, chains, TVL and age — instructions for using the
protocol, never a claim that it runs a points program (the snapshot carries no
airdrop flag). The Live view shows the 24 live-token protocols by market cap — the
market's own values, not a model.

*Fase B tweak:* `Cross Chain Bridge` was added to the excluded categories
(`isExcludedProduct` in `lib/model.ts`): Circle Gateway ranked 15th only because of
its category spelling, and it is a bridge product under the brief. No watchlist row
sits in that category, so the board went 198 → **197 rows** (157 early), watchlist
still 40/40, and the top 10 is unchanged.

### Wrapped / staked / bridged products are excluded

The first board (289 rows) was topped by products that are not launch candidates:
Coinbase Bridge, WBTC, Binance Bitcoin, USDT0, Base Bridge, CCIP, Binance staked ETH.
A bridge moves a token that already trades between chains; a liquid-staking or
restaking product is a receipt for a token that already trades. The competition brief
says the same: a wrapped or staked product of an already-traded token is not a token
that has not been born yet. So a row is excluded when any of these holds
(`isExcludedProduct` in `lib/model.ts`, applied to every row including watchlist rows):

- category is `Bridge`, `Canonical Bridge`, `Cross Chain Bridge`, `Liquid Staking`, `Liquid Restaking`,
  `Restaked BTC` or `CEX`;
- the name contains the whole word `wrapped`, `staked` or `staking`
  (case-insensitive, word boundary — `Staked ETH` is out, `StakeStone` is not);
- the name starts with an exchange name — `Binance`, `Coinbase`, `Bybit`, `Kraken`,
  `Bitget`, `OKX`, `Bitfinex`, `Gemini` — followed by a space or the end of the string.

The filter removes 91 of the 289 rows, all of them early rows; the 40 watchlist
protocols all pass it (verified, not assumed), so watchlist coverage stays 40/40.
Limitation: the snapshot carries only ten fields per protocol and has no
`parentProtocol` field, so a wrapped product whose category and name do not betray it
cannot be caught by this rule.

New top 10 (implied value): Steakhouse Financial ($534,937,903), Sentora Curator
($513,887,472), Gauntlet ($318,596,039), Veda ($306,306,740), USDD ($144,564,216),
BitFi Basis ($111,161,171), Upshift ($109,892,409), Polymarket International
($78,341,572), Bittensor dTAO ($77,264,755), Nonce Capital ($74,118,702) — all
plausible launch candidates (risk curators, capital allocators, CDP, basis trading,
prediction market, DEX), no wrapped/bridged/staked product among them.

## Determinism

No current date, no randomness, no network. Two runs to different output
directories produce byte-identical `board.json`, `data.js` and `dossier.json`
(verified by sha256 — after the Fase B exclusion tweak: board.json
`2dc24e8e773e0cb7777ed4abb415c2ac4e89b9a3948bc7ccc0887c4f60765d6d`, data.js
`8b257383efaf735dede7e2043554682fc635bce00143f2a022eb3287396a3d94`, dossier.json
`1c30cf47decc87e68138c2d3dc2096a65e1f9e14ac14bbaf3302b9f2771b620d`; dossier.json is
byte-identical to the pre-fix build because it carries only the dashboard source
and screenshots, which had not changed yet at that point).

## Status

- **Fase A (done):** model radar-2 + `main.ts` + verified board/dossier.
- **Fase A-fix (done):** wrapped/staked/bridged exclusion — board 289 → 198 rows
  (91 early rows removed, watchlist still 40/40), all gates re-verified, determinism
  re-verified 2× byte-identical (see above).
- **Fase B (done):** `Cross Chain Bridge` added to the exclusion — board 198 → 197
  rows (Circle Gateway removed, top 10 unchanged, watchlist 40/40, determinism
  re-verified 2× byte-identical); dashboard redesigned (46.317 B source, so the
  judge reads it all in the dossier) + 3 fresh 1440×900 screenshots rendered from
  the final dashboard in headless Chromium.
- **Fase C:** public GitHub repo + submit (needs the parent agent: GitHub login).

## Files

- `main.ts` — entry point (from the kit starter, unchanged).
- `lib/model.ts` — model radar-2, board builder, farm plans, gate checks.
- `vendor/makefun-board.ts` — make.fun dossier library, byte-for-byte from the kit.
- `dashboard/`, `screenshots/` — Fase B redesign: board with search/category/chain/
  watchlist-only/sort, per-protocol detail (model breakdown with the row's own
  category multiple, live comparables, 6-step farm plan, disclaimer), live-token
  view, full methodology section, hash-state URLs; 3 real 1440×900 screenshots
  from headless Chromium (1-board, 2-detail rank 1, 3-filtered watchlist-only).
- `.makefun/owner.json` — payout wallet (public address only).
