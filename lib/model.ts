// The token radar's model v2 ("radar-2"): one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every other
// pre-token protocol the snapshot can rank: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// Implied value follows only from the snapshot's own figures:
//
//   multiple   = the protocol's CATEGORY multiple (see below), clamped to [0.05, 1.50]
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   implied    = max(1, round(tvl_usd x multiple x growthMult x maturity))
//
// --- Where the category multiple comes from (measured from this snapshot, never invented) ---
//
// The starter's flat 0.25 was practically the global median mcap/TVL of live-token protocols, so it
// priced a DEX and a liquid-staking protocol as if the market valued their TVL the same. It does not:
// the market pays far more per dollar of TVL for some categories than others. So radar-2 prices each
// protocol at its own category's median mcap/TVL, taken over the category's LIVE-token peers in this
// same snapshot. A peer is a protocol with mcap_usd > 0 and tvl_usd > 0 whose category is not 'CEX'
// (exchange tokens are valued on exchange cash flows, not on protocol TVL, so they would corrupt the
// median; mcap 0 or -1 entries are data artefacts, not prices, so they are excluded too).
//
// Why the median: a handful of live tokens trade at absurd multiples (one prediction-market token at
// ~400x TVL); the mean would let those outliers set the price for a whole category, while the median
// tracks the typical peer. Why the clamp [0.05, 1.50]: a category median below 0.05x or above 1.50x
// would come from a tiny or distorted peer set, and the clamp keeps one thin category from pricing a
// whole board at ~0 or at several times its TVL. Categories with fewer than 3 live peers have no
// median worth trusting, so they fall back to the global median over all live peers.
//
// Measured from snapshot.json (as_of 2026-11-14, 758 protocols) with exactly that peer rule:
//   global median 0.2460 (n = 119 live peers, no CEX)
//   Dexs 0.3424 (n=11) | Lending 0.1324 (n=15) | Liquid Staking 0.0406 (n=9) | RWA 0.2748 (n=9)
//   Basis Trading 0.6544 (n=7) | Cross Chain Bridge 1.2205 (n=4) | Yield 0.1914 (n=9)
//   Canonical Bridge 0.7464 (n=8) | Bridge 0.5567 (n=6) | Yield Aggregator 0.1510 (n=4)
//   CDP 0.1687 (n=3) | Indexes 0.1477 (n=3) | Privacy 0.9691 (n=3)
//   Liquid Staking 0.0406 (n=9) -> clamped to 0.05
// Every other category has <3 live peers and uses the global fallback 0.2460. The program recomputes
// all of this from the snapshot on every run (deriveMultiples), so the numbers above are documentation
// of what the snapshot says, not constants the model trusts blindly. Two small notes on the record:
// the coordinator's notes quoted a global median of 0.241 (n=120) and Yield 0.180; re-measuring with
// the strict peer rule (mcap > 0) gives 0.2460 (n=119) and Yield 0.1914 — the earlier figures counted
// one mcap-0 protocol as a peer. The strict figures are the ones this code uses.
//
// Wrapped, staked and bridged products are excluded from the board (see isExcludedProduct): they are
// receipts for tokens that already trade, not tokens waiting to be born, and a board topped by WBTC
// would not be a launch ranking. No protocol name is ever special-cased: the same rule scores every
// row. The model is fully deterministic: no current date, no randomness, no network — only the
// snapshot's as_of date.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  /** Fallback multiple: the global median mcap/TVL over all live peers (measured 0.2460). */
  base_multiple: number;
  /** Same value as base_multiple, kept explicit: the fallback every thin category uses. */
  global_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  /** A category multiple is clamped to [multiple_floor, multiple_cap]. */
  multiple_floor: number;
  multiple_cap: number;
  /** A category needs at least this many live peers for its own median; fewer fall back to global. */
  min_category_peers: number;
  /** Per-category multiple actually used (derived from the snapshot at runtime; empty in the default). */
  category_multiples: Record<string, number>;
  /** Per-category live-peer count behind the multiple (derived from the snapshot at runtime). */
  category_peers: Record<string, number>;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.246,
  global_multiple: 0.246,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  multiple_floor: 0.05,
  multiple_cap: 1.5,
  min_category_peers: 3,
  category_multiples: {},
  category_peers: {},
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    /** The category multiple actually used for this row (category median, or the global fallback). */
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
    /** Live-token peers in this row's category (0 when the category has none; fallback still applies). */
    category_peers: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  base_multiple: number;
  category_peers: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers (average of the two middle values when even). */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) throw new Error('median of an empty list');
  return n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Clamp a multiple into [floor, cap]. */
function clampMultiple(value: number, floor: number, cap: number): number {
  return Math.min(cap, Math.max(floor, value));
}

/** Whether a protocol is a live-token peer for pricing a category: a real market cap on real TVL. */
export function isLivePeer(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX';
}

/** The category multiples derived from one snapshot: global fallback plus one median per category. */
export interface DerivedMultiples {
  global: number;
  byCategory: Map<string, number>;
  peersByCategory: Map<string, number>;
}

export function deriveMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): DerivedMultiples {
  const peers = snapshot.protocols.filter(isLivePeer);
  const global = clampMultiple(round4(median(peers.map((p) => p.mcap_usd! / p.tvl_usd))), model.multiple_floor, model.multiple_cap);
  const ratiosByCategory = new Map<string, number[]>();
  for (const p of peers) {
    const list = ratiosByCategory.get(p.category!);
    if (list === undefined) ratiosByCategory.set(p.category!, [p.mcap_usd! / p.tvl_usd]);
    else list.push(p.mcap_usd! / p.tvl_usd);
  }
  const byCategory = new Map<string, number>();
  const peersByCategory = new Map<string, number>();
  for (const [category, ratios] of ratiosByCategory) {
    peersByCategory.set(category, ratios.length);
    byCategory.set(
      category,
      ratios.length >= model.min_category_peers
        ? clampMultiple(round4(median(ratios)), model.multiple_floor, model.multiple_cap)
        : global,
    );
  }
  return { global, byCategory, peersByCategory };
}

/** The effective model for one snapshot: the constants plus the multiples derived from it. */
export function effectiveModel(snapshot: Snapshot, model: ModelConstants = MODEL): ModelConstants {
  const derived = deriveMultiples(snapshot, model);
  return {
    ...model,
    base_multiple: derived.global,
    global_multiple: derived.global,
    category_multiples: Object.fromEntries(derived.byCategory),
    category_peers: Object.fromEntries(derived.peersByCategory),
  };
}

/** The category multiple one protocol is priced at, and how many live peers back it. */
export function categoryMultipleFor(p: SnapshotProtocol, derived: DerivedMultiples): { multiple: number; peers: number } {
  if (p.category === null) return { multiple: derived.global, peers: 0 };
  const peers = derived.peersByCategory.get(p.category) ?? 0;
  return { multiple: derived.byCategory.get(p.category) ?? derived.global, peers };
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The three multipliers and the implied value one protocol gets under `model` at `multiple`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiple: number,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Categories whose products are not launch candidates: a bridge moves an existing token between
 * chains, a liquid-staking / restaking product is a receipt for a token that already trades, and a
 * CEX is an exchange, not a protocol about to launch a token. The competition brief says the same:
 * a wrapped or staked product of an already-traded token is not a token that has not been born yet.
 * This mirrors the watchlist's own definition, so every watchlist protocol passes it by construction.
 */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** A whole word in the name that marks a wrapped or staked product of an already-traded token. */
const WRAPPED_OR_STAKED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name that starts with an exchange's name: an exchange's wrapped/staked product, not a launch. */
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)(\s|$)/i;

/**
 * Whether a protocol is a wrapped / staked / bridged product rather than a launch candidate, by the
 * watchlist's own definition. The same rule scores every row — no name is special-cased by hand.
 *
 * Limitation: the snapshot carries only ten fields per protocol and has no parentProtocol field, so a
 * wrapped product whose category and name do not betray it (no bridge/staking category, no
 * wrapped/staked word, no exchange prefix) cannot be caught by this rule. That gap is inherent to the
 * sealed input, not to the rule.
 */
export function isExcludedProduct(p: SnapshotProtocol): boolean {
  if (EXCLUDED_CATEGORIES.has(p.category ?? '')) return true;
  if (WRAPPED_OR_STAKED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool, and not a wrapped/staked/bridged product (see isExcludedProduct). */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name) && !isExcludedProduct(p);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/**
 * The protocols the board ranks, strongest first, with ranks 1..n: every rankable pre-token protocol
 * (the watchlist plus every pre-token protocol below the floor), plus — belt and braces, as the starter
 * did — any watchlist slug the snapshot carries even if it failed the rankable test, so watchlist
 * coverage is never gambled on a filter. The wrapped/staked/bridged exclusion still applies on that
 * path too: no excluded product can re-enter the board through the watchlist.
 */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const eff = effectiveModel(snapshot, model);
  const derived = deriveMultiples(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) if (isRankable(p)) chosen.set(p.slug, p);
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined && !isExcludedProduct(p)) chosen.set(slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const { multiple, peers } = categoryMultipleFor(p, derived);
    const { implied, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, eff, multiple);
    return { p, implied, growthPct, growthMult, maturityMult, age, multiple, peers };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: s.multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
      category_peers: s.peers,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** The weekly top-up for a repeated action: a tenth of the position's capital, $5 to $25. */
function weeklyAmount(capital: number): number {
  return Math.min(25, Math.max(5, Math.round(capital / 10)));
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('govern')) return `Deposit $${capital} of USDC into ${name} on ${chain} and vote on one proposal when voting opens.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * The weekly repeat action, tailored to the category: the same kind of activity as the opening
 * position, repeated once a week with a small top-up, naming the protocol, its chain and the amount.
 * These are instructions for how to use the protocol, not claims that it runs a points program — the
 * snapshot carries no airdrop flag, and no step here claims one exists.
 */
function weeklyActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const w = weeklyAmount(capital);
  if (c.includes('dex')) return `Each week, swap $${w} of USDC for another asset in ${name}'s main pool on ${chain}, then swap it back, to show repeated use.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Each week, supply or borrow $${w} on ${name} on ${chain} and repay or withdraw a small part, to show repeated use.`;
  if (c.includes('bridge')) return `Each week, bridge $${w} of USDC through ${name} to ${chain} and use the bridged funds in its app, to show repeated use.`;
  if (c.includes('staking') || c.includes('restak')) return `Each week, check the rewards on ${name} on ${chain} and stake another $${w} of the staking asset when you can.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Each week, open and close one small $${w} hedge on ${name} on ${chain}, to show repeated use.`;
  if (c.includes('prediction')) return `Each week, place one $${w} market position on ${name} on ${chain}.`;
  if (c.includes('govern')) return `Each week, vote on one live proposal on ${name} on ${chain} with the position you hold.`;
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Each week, harvest and compound about $${w} of rewards from ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Each week, hold the ${name} position on ${chain} and top it up by $${w} when you can.`;
  if (c.includes('stable')) return `Each week, mint or redeem $${w} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('insurance')) return `Each week, keep the ${name} cover on ${chain} active and check the policy still covers the position.`;
  if (c.includes('curator') || c.includes('allocator')) return `Each week, check the ${name} vault on ${chain} and add $${w} when the vault is open.`;
  return `Each week, make one qualifying action on ${name} on ${chain}, such as a deposit, a borrow, a swap or a vote, with about $${w}.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const weekly = weeklyActionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weekly,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    base_multiple: row.model.base_multiple,
    category_peers: row.model.category_peers,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: effectiveModel(snapshot, model),
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, farm steps, and the implied-value cap. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.implied_value_usd > 1e14) return `${r.slug} has implied value ${r.implied_value_usd}, over the 1e14 cap`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
