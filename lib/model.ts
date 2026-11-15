// The token radar's model, third revision ("radar-3"): price a launch from the market's own size curve.
//
// v2 priced each protocol at its own category's median market-cap-per-TVL. That lost, out of
// sample, to a single flat multiple — and the flat multiple lost to a curve. The reason is visible
// in the snapshot itself: a protocol's market cap grows with its TVL, but slower than one-for-one,
// so a fixed multiple overprices the giants and underprices the small. A straight line through the
// log-log cloud (log market cap against log TVL) captures that bend, and it is the whole spine of
// this revision. Everything else is a small correction on top of it, each one measured from the
// same snapshot on every run, never typed in as a constant:
//
//   curve     = 10^(a + b x log10(TVL))          a and b refit from the snapshot each run
//   offset    = a category's mean leftover from the curve, shrunk toward zero when its peer
//               count is thin, so a category with one loud token cannot drag its own price
//   momentum  = a nudge from the last seven days of TVL growth, kept because the brief names
//               seven-day growth as an input — NOT because it predicts anything (it does not:
//               its correlation with the curve's leftovers is about zero, Pearson -0.09 and
//               rank -0.01 on the fit set; see backtestRadar, and do not cite this tilt as a
//               backtest result, it is a judgement tilt, labelled as one)
//   seasoning = a nudge for how long the protocol has run with no token yet, kept from the
//               starter's maturity term for the same reason
//   implied   = curve x 10^offset x momentum x seasoning, rounded, at least $1
//
// The fit set is the snapshot's live-token protocols with a real market cap on real TVL, minus
// exchanges (their tokens are priced on exchange cash flows, not on protocol TVL) and minus the
// three bridge categories (bridges move a token that already exists; their multiples describe
// wrapped value, not launches). That is 101 protocols on this snapshot. The board itself still
// ranks every pre-token protocol the v1 exclusions allow, watchlist included.
//
// How good is the curve? The library measures it, it does not assert it: backtestRadar runs a
// leave-one-out pass (refit the curve and the offsets for every held-out protocol) and a
// time-split pass (fit on protocols listed before 2024, test on the ones listed in 2024 or later),
// and scores the curve against the flat global median and against v2's category-median model on
// the same protocols. The numbers go into data.js so the dashboard can show them, and the
// honest error band around each implied value (the P10-P90 of the leave-one-out residuals, on a
// log scale) comes from the same pass — the band is the model's own measured miss, not a guess.
//
// Farm economics, new in this revision: every row is costed for a $1,000 position. The slice is
// the modelled gain, the fee is three counted transactions at an assumed gas price per chain,
// the opportunity cost is a 4%-a-year T-bill on the $1,000 over the hold, and the verdict follows
// from the arithmetic: FARM when the slice beats fee and T-bill together, THIN when it beats
// only the fee, SKIP when the fee alone eats it. Gas prices are ASSUMPTIONS, labelled as such
// wherever they appear (Ethereum $4 a transaction, every other chain $0.50); the chain charged
// is the cheapest chain the protocol lists, not the first one it names. Reads and checks are
// not transactions and are never charged.
//
// What this model deliberately does NOT do: it has no family or sibling factor. The snapshot
// carries ten fields per protocol and none of them names a parent protocol, and matching names
// by substring produces nonsense, so no kinship term is invented here. A protocol whose
// category and name do not betray it as a wrapped or staked product cannot be caught by the
// board's exclusions either; that gap belongs to the sealed input, and the dashboard's method
// note says so. USDD stays on the board for the same reason v1 left it there: the snapshot
// records it as pre-token, and no name is ever special-cased by hand.
//
// The program is fully deterministic: no clock, no randomness, no network — only the snapshot's
// as_of date. The same input always writes the same board, byte for byte.

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
  /** Seven-day growth is clamped to [growth_floor, growth_cap] per cent before it nudges the price. */
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  /** Seasoning: 0.6 at birth, rising to 1.0 at maturity_days; unknown age counts as unknown_age_days. */
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  /** A category's mean residual is shrunk by n / (n + shrinkage_k): thin categories barely move the price. */
  shrinkage_k: number;
}

/** The farm-economics assumptions, labelled as assumptions wherever they are shown. */
export interface FarmConstants {
  /** The modelled position size in dollars. */
  capital_usd: number;
  /** Counted transactions per farm: deposit + one interaction + claim. Reads and checks are not charged. */
  tx_count: number;
  /** Assumed gas per transaction on Ethereum. An assumption, not a measured price. */
  gas_ethereum_usd: number;
  /** Assumed gas per transaction on any other chain. An assumption, not a measured price. */
  gas_other_usd: number;
  /** Opportunity cost: the T-bill rate per year on the capital over the hold. */
  tbill_rate: number;
  /** Hold in days for a protocol whose age is unknown (treated as young, so the longest hold). */
  hold_default_days: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  shrinkage_k: 40,
};

export const FARM: FarmConstants = {
  capital_usd: 1000,
  tx_count: 3,
  gas_ethereum_usd: 4,
  gas_other_usd: 0.5,
  tbill_rate: 0.04,
  hold_default_days: 60,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row's farm economics for a $1,000 position, all in dollars except where named. */
export interface FarmEconomics {
  /** The modelled position size. */
  capital_usd: number;
  /** The $1K slice: 10% of the implied value, scaled to a $1,000 position against the protocol's TVL. */
  slice_1k: number;
  /** Total fee: tx_count transactions at the operating chain's assumed gas price. */
  fee: number;
  /** Counted transactions (deposit + one interaction + claim). */
  fee_tx_count: number;
  /** Assumed gas per transaction on the operating chain. */
  gas_per_tx_usd: number;
  /** The chain the farm runs on: the cheapest chain the protocol lists, not the first it names. */
  operating_chain: string;
  /** Hold in days before the position counts as farmed. */
  hold_days: number;
  /** Hands-on hours: setup plus one weekly check per week of the hold, plus claim and logging. */
  hours: number;
  /** Opportunity cost: the T-bill rate on the capital over the hold. */
  tbill_usd: number;
  /** Net gain: slice minus fee minus T-bill. */
  net: number;
  /** Net gain per hands-on hour. */
  net_per_hour: number;
  /** FARM when net > 0, THIN when only the fee is beaten, SKIP when the fee eats the slice. */
  verdict: 'FARM' | 'THIN' | 'SKIP';
  /** The farm plan's steps, as strings (the same strings as the row's farm_steps). */
  steps: string[];
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
  /** The honest band around the implied value, from the leave-one-out residuals (log scale). */
  implied_band_p10_usd: number;
  implied_band_p90_usd: number;
  model: {
    /** The log-log curve's intercept, refit from the snapshot on every run. */
    a: number;
    /** The log-log curve's slope, refit from the snapshot on every run. */
    b: number;
    /** The category's shrunk mean residual from the curve, in log10 units (0 when the category has no live peers). */
    category_offset: number;
    /** Live peers behind the category offset (from the 101-protocol fit set). */
    category_offset_peers: number;
    /** The momentum tilt (seven-day growth nudge). A judgement tilt, not a validated predictor. */
    momentum_multiplier: number;
    /** The seasoning tilt (how long the protocol has run with no token). */
    seasoning_multiplier: number;
    /** Seven-day TVL change in per cent, clamped to the model's growth window. */
    growth_pct: number;
    age_days: number | null;
    /** Live peers in this row's category (same count as category_offset_peers). */
    category_peers_n: number;
    /** The curve-implied multiple before the tilts (implied before tilts divided by TVL), kept so the v1 dashboard's column still reads. */
    base_multiple: number;
    /** Same value as momentum_multiplier, under the v1 dashboard's name. */
    growth_multiplier: number;
    /** Same value as seasoning_multiplier, under the v1 dashboard's name. */
    maturity_multiplier: number;
  };
  farm: FarmEconomics;
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
  implied_band_p10_usd: number;
  implied_band_p90_usd: number;
  base_multiple: number;
  category_peers: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  category_offset: number;
  momentum_multiplier: number;
  seasoning_multiplier: number;
  farm: FarmEconomics;
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

/** One live-token comparable in a category's peer list. */
export interface PeerEntry {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  /** The peer's own market multiple, mcap / TVL. */
  multiple: number;
}

/** One predictor's out-of-sample score: median miss in multiples, and the share inside 3x / 10x. */
export interface PredictorScore {
  median_miss_x: number;
  within_3x_pct: number;
  within_10x_pct: number;
}

/** The backtest, computed from the snapshot by this library, never typed in by hand. */
export interface Backtest {
  /** Live-token protocols in the fit set (non-CEX, non-bridge, mcap > 0, TVL > 0). */
  peers_n: number;
  /** The fitted curve's intercept, slope and R-squared on the fit set. */
  fit: { a: number; b: number; r2: number };
  /** Pearson correlation of seven-day growth with the curve's residuals (about zero: momentum does not predict the ratio). */
  momentum_corr_pearson: number;
  /** Rank correlation of the same pair (the figure the analysis quoted, about -0.01). */
  momentum_corr_spearman: number;
  /** Leave-one-out scores, refitting curve and offsets for every held-out protocol. */
  loo: Record<string, PredictorScore>;
  /** Time-split scores: fit on protocols listed before 2024, test on those listed in 2024 or later. */
  time_split: { train_n: number; test_n: number; scores: Record<string, PredictorScore> };
  /** The P10 and P90 of the full model's leave-one-out residuals (log10 units): the band's width. */
  loo_residual_p10: number;
  loo_residual_p90: number;
}

/** Everything the dashboard needs: the board, the live set, the peers, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  farm: FarmConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  backtest: Backtest;
  verdict_counts: { FARM: number; THIN: number; SKIP: number };
  rows: RadarRow[];
  live: LiveRow[];
  /** Live-token comparables per category (name, TVL, mcap, multiple), from the 119 non-CEX live protocols. */
  peers_by_category: Record<string, PeerEntry[]>;
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

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A quantile of a list by linear interpolation on the sorted values (q in [0, 1]). */
export function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) throw new Error('quantile of an empty list');
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Pearson's correlation of two equal-length lists. */
export function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}

/** Spearman's rank correlation: Pearson on the ranks (ties share the mean rank). */
export function spearman(xs: number[], ys: number[]): number {
  const ranks = (vs: number[]): number[] => {
    const order = vs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i);
    const out = new Array<number>(vs.length);
    let k = 0;
    while (k < order.length) {
      let j = k;
      while (j + 1 < order.length && order[j + 1]!.v === order[k]!.v) j++;
      const meanRank = (k + j) / 2 + 1;
      for (let t = k; t <= j; t++) out[order[t]!.i] = meanRank;
      k = j + 1;
    }
    return out;
  };
  return pearson(ranks(xs), ranks(ys));
}

/** Categories whose live tokens are bridges: they move a token that already exists, so their multiples describe wrapped value, not launches, and they leave the fit set. */
const BRIDGE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge']);

/** Whether a protocol is a live-token peer for the curve fit: a real market cap on real TVL, no exchange, no bridge. */
export function isFitPeer(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX' && !BRIDGE_CATEGORIES.has(p.category ?? '');
}

/** Whether a protocol is a live-token peer at all (non-CEX): the peer lists' universe. */
export function isLivePeer(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX';
}

/** The fit set: the snapshot's live-token protocols the curve is fitted on, in snapshot order. */
export function fitPeers(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(isFitPeer);
}

/** The ordinary-least-squares line through log10(mcap) on log10(TVL), with its R-squared. */
export interface CurveFit {
  a: number;
  b: number;
  r2: number;
  n: number;
}

export function fitCurve(peers: SnapshotProtocol[]): CurveFit {
  if (peers.length < 2) throw new Error(`fitCurve: ${peers.length} peers cannot fit a line`);
  const xs = peers.map((p) => Math.log10(p.tvl_usd));
  const ys = peers.map((p) => Math.log10(p.mcap_usd!));
  const n = peers.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  const a = my - b * mx;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssRes += (ys[i]! - (a + b * xs[i]!)) ** 2;
    ssTot += (ys[i]! - my) ** 2;
  }
  return { a, b, r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot, n };
}

/** One protocol's leftover from the curve, in log10 units: positive means the market pays above the line. */
export function curveResidual(p: SnapshotProtocol, fit: CurveFit): number {
  return Math.log10(p.mcap_usd!) - (fit.a + fit.b * Math.log10(p.tvl_usd));
}

/**
 * Each category's shrunk mean residual: the mean leftover of its fit peers, pulled toward zero by
 * n / (n + shrinkage_k), so a category with one or two peers barely moves the price and a thick
 * category earns its full offset. Categories with no fit peers get no offset at all (0).
 */
export interface CategoryOffsets {
  byCategory: Map<string, number>;
  peersByCategory: Map<string, number>;
}

export function deriveOffsets(peers: SnapshotProtocol[], fit: CurveFit, model: ModelConstants = MODEL): CategoryOffsets {
  const residualsByCategory = new Map<string, number[]>();
  for (const p of peers) {
    const list = residualsByCategory.get(p.category ?? '');
    if (list === undefined) residualsByCategory.set(p.category ?? '', [curveResidual(p, fit)]);
    else list.push(curveResidual(p, fit));
  }
  const byCategory = new Map<string, number>();
  const peersByCategory = new Map<string, number>();
  for (const [category, residuals] of residualsByCategory) {
    const n = residuals.length;
    const mean = residuals.reduce((s, v) => s + v, 0) / n;
    peersByCategory.set(category, n);
    byCategory.set(category, mean * (n / (n + model.shrinkage_k)));
  }
  return { byCategory, peersByCategory };
}

/** The category offset one protocol is priced at, and how many fit peers back it. */
export function categoryOffsetFor(p: SnapshotProtocol, offsets: CategoryOffsets): { offset: number; peers: number } {
  if (p.category === null) return { offset: 0, peers: 0 };
  return { offset: offsets.byCategory.get(p.category) ?? 0, peers: offsets.peersByCategory.get(p.category) ?? 0 };
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The momentum tilt: 1 + (clamped seven-day growth / 100) x 0.5. A JUDGEMENT TILT, not a
 * validated predictor: seven-day growth does not predict a protocol's ratio to the curve
 * (Pearson about -0.09, rank about -0.01 on the fit set), so this term is kept only because the
 * brief names seven-day growth as an input to the value model. Do not present it as a backtest
 * finding; the backtest below measures the curve, and this tilt rides on top of it.
 */
export function momentumMultiplier(p: SnapshotProtocol, model: ModelConstants = MODEL): number {
  const growth = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(p.change_7d, 0)));
  return 1 + (growth / 100) * model.growth_weight;
}

/** The seasoning tilt: 0.6 at birth, rising to 1.0 at maturity_days; unknown age counts as unknown_age_days. */
export function seasoningMultiplier(age: number | null, model: ModelConstants = MODEL): number {
  const ageForModel = age ?? model.unknown_age_days;
  return model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
}

/** The curve value before any tilt: 10^(a + b x log10(TVL)) x 10^offset. */
export function curveValue(p: SnapshotProtocol, fit: CurveFit, offset: number): number {
  return 10 ** (fit.a + fit.b * Math.log10(p.tvl_usd) + offset);
}

/** The implied value one protocol gets under radar-3, with its breakdown. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: CurveFit,
  offsets: CategoryOffsets,
  model: ModelConstants = MODEL,
): { implied: number; curve: number; offset: number; offsetPeers: number; momentum: number; seasoning: number; growthPct: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { offset, peers } = categoryOffsetFor(protocol, offsets);
  const curve = curveValue(protocol, fit, offset);
  const momentum = momentumMultiplier(protocol, model);
  const seasoning = seasoningMultiplier(age, model);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const implied = Math.max(1, Math.round(curve * momentum * seasoning));
  return { implied, curve, offset, offsetPeers: peers, momentum, seasoning, growthPct, age };
}

// ---------------------------------------------------------------- backtest

/** The five predictors the backtest scores, on the same protocols, so the comparison is fair. */
export type PredictorKind = 'flat' | 'category_median' | 'curve' | 'curve_category' | 'radar3';

/**
 * A predictor fitted on `train`: a function from a protocol to its predicted market cap.
 * flat: the train set's median mcap/TVL. category_median: v2's model — the category's median
 * ratio (at least 3 peers, else the global median), clamped to [0.05, 1.50]. curve: the log-log
 * line. curve_category: the line plus the shrunk category offset. radar3: the line, the offset,
 * and the momentum and seasoning tilts — the model the board actually uses; its seasoning tilt
 * counts ages against `asOf`, the snapshot's own date.
 */
export function fitPredictor(asOf: string, kind: PredictorKind, train: SnapshotProtocol[], model: ModelConstants = MODEL): (p: SnapshotProtocol) => number {
  const ratios = train.map((p) => p.mcap_usd! / p.tvl_usd);
  const global = median(ratios);
  const clamp = (v: number): number => Math.min(1.5, Math.max(0.05, v));
  if (kind === 'flat') return (p) => p.tvl_usd * global;
  if (kind === 'category_median') {
    const byCategory = new Map<string, number[]>();
    for (const p of train) {
      const list = byCategory.get(p.category ?? '');
      if (list === undefined) byCategory.set(p.category ?? '', [p.mcap_usd! / p.tvl_usd]);
      else list.push(p.mcap_usd! / p.tvl_usd);
    }
    return (p) => {
      const list = byCategory.get(p.category ?? '');
      const multiple = list !== undefined && list.length >= 3 ? clamp(median(list)) : clamp(global);
      return p.tvl_usd * multiple;
    };
  }
  const fit = fitCurve(train);
  if (kind === 'curve') return (p) => 10 ** (fit.a + fit.b * Math.log10(p.tvl_usd));
  const offsets = deriveOffsets(train, fit, model);
  if (kind === 'curve_category') {
    return (p) => curveValue(p, fit, categoryOffsetFor(p, offsets).offset);
  }
  return (p) => {
    const { offset } = categoryOffsetFor(p, offsets);
    const age = ageDays(asOf, p.listed_at);
    return curveValue(p, fit, offset) * momentumMultiplier(p, model) * seasoningMultiplier(age, model);
  };
}

/** Score one predictor on `test`: median miss in multiples, and the share inside 3x / 10x. */
export function scorePredictor(predict: (p: SnapshotProtocol) => number, test: SnapshotProtocol[]): PredictorScore {
  const misses = test.map((p) => Math.abs(Math.log10(predict(p) / p.mcap_usd!)));
  const medianMiss = 10 ** median(misses);
  const within = (x: number): number => (misses.filter((m) => 10 ** m <= x).length / misses.length) * 100;
  return { median_miss_x: round2(medianMiss), within_3x_pct: round2(within(3)), within_10x_pct: round2(within(10)) };
}

const PREDICTOR_KINDS: PredictorKind[] = ['flat', 'category_median', 'curve', 'curve_category', 'radar3'];

/** The backtest: leave-one-out plus time-split, both scored for all five predictors. */
export function backtestRadar(snapshot: Snapshot, model: ModelConstants = MODEL): Backtest {
  const peers = fitPeers(snapshot);
  const fit = fitCurve(peers);
  const offsets = deriveOffsets(peers, fit, model);

  // Leave-one-out: refit the curve and the offsets on the other 100 for every held-out protocol.
  const looScores: Record<string, PredictorScore> = {};
  const looResidualsFull: number[] = [];
  for (const kind of PREDICTOR_KINDS) {
    const misses: number[] = [];
    for (let i = 0; i < peers.length; i++) {
      const held = peers[i]!;
      const train = peers.filter((_, j) => j !== i);
      const predict = fitPredictor(snapshot.as_of, kind, train, model);
      const pred = predict(held);
      const miss = Math.abs(Math.log10(pred / held.mcap_usd!));
      misses.push(miss);
      if (kind === 'radar3') looResidualsFull.push(Math.log10(pred / held.mcap_usd!));
    }
    const medianMiss = 10 ** median(misses);
    const within = (x: number): number => (misses.filter((m) => 10 ** m <= x).length / misses.length) * 100;
    looScores[kind] = { median_miss_x: round2(medianMiss), within_3x_pct: round2(within(3)), within_10x_pct: round2(within(10)) };
  }

  // Time-split: fit on protocols listed before 2024, test on those listed in 2024 or later.
  const train = peers.filter((p) => p.listed_at !== null && p.listed_at < '2024-01-01');
  const test = peers.filter((p) => p.listed_at !== null && p.listed_at >= '2024-01-01');
  const timeScores: Record<string, PredictorScore> = {};
  for (const kind of PREDICTOR_KINDS) {
    timeScores[kind] = scorePredictor(fitPredictor(snapshot.as_of, kind, train, model), test);
  }

  // Momentum's (non-)signal: the correlation of seven-day growth with the curve's leftovers.
  const residuals = peers.map((p) => curveResidual(p, fit));
  const growths = peers.map((p) => finite(p.change_7d, 0));

  return {
    peers_n: peers.length,
    fit: { a: round4(fit.a), b: round4(fit.b), r2: round4(fit.r2) },
    momentum_corr_pearson: round4(pearson(growths, residuals)),
    momentum_corr_spearman: round4(spearman(growths, residuals)),
    loo: looScores,
    time_split: { train_n: train.length, test_n: test.length, scores: timeScores },
    loo_residual_p10: round4(quantile(looResidualsFull, 0.1)),
    loo_residual_p90: round4(quantile(looResidualsFull, 0.9)),
  };
}

// ---------------------------------------------------------------- board membership

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
 * sealed input, not to the rule. USDD stays on the board under this rule: the snapshot records it as
 * pre-token, and excluding it by name would be special-casing, which this rule forbids.
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

// ---------------------------------------------------------------- farm economics

/**
 * The operating chain: the cheapest chain the protocol lists, by the assumed gas table — any
 * chain other than Ethereum at the $0.50 tier, Ethereum at $4. Among equally cheap chains the
 * first the snapshot lists wins, so the choice is deterministic. This is the chain the fee is
 * charged on and the chain the farm steps name; it is deliberately NOT chains[0], which for a
 * multi-chain protocol is often Ethereum and would charge $12 where $1.50 is the honest cost.
 * The gas prices are ASSUMPTIONS (see FARM), not measurements: they price the work, they do not
 * claim to be the network's live fees.
 */
export function operatingChain(p: SnapshotProtocol): string {
  const chains = p.chains;
  if (chains.length === 0) return 'its main chain';
  for (const c of chains) if (c !== 'Ethereum') return c;
  return chains[0]!;
}

/** The assumed gas per transaction on a chain: $4 on Ethereum, $0.50 anywhere else. */
export function gasPerTx(chain: string): number {
  return chain === 'Ethereum' ? FARM.gas_ethereum_usd : FARM.gas_other_usd;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window; unknown age counts as young. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return FARM.hold_default_days;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * Hands-on hours for the farm: 5 minutes to set up the wallet, 15 to open the position, 10 a
 * week of checks for every week of the hold, 10 to claim, 5 to log it. The step texts name the
 * same minutes, so the hours here and the plan's times always agree.
 */
export function hoursFor(holdDays: number): number {
  const weeks = Math.ceil(holdDays / 7);
  return round2((5 + 15 + 10 * weeks + 10 + 5) / 60);
}

/** The farm economics of one board row for a $1,000 position. */
export function farmEconomics(p: SnapshotProtocol, implied: number, age: number | null, farm: FarmConstants = FARM): FarmEconomics {
  const chain = operatingChain(p);
  const gas = gasPerTx(chain);
  const fee = round2(farm.tx_count * gas);
  const holdDays = holdDaysFor(age);
  const hours = hoursFor(holdDays);
  const tbill = round2(farm.capital_usd * farm.tbill_rate * (holdDays / 365));
  const slice = p.tvl_usd > 0 ? round2(0.1 * implied * (farm.capital_usd / p.tvl_usd)) : 0;
  const net = round2(slice - fee - tbill);
  const netPerHour = round2(net / hours);
  const verdict: FarmEconomics['verdict'] = net > 0 ? 'FARM' : slice - fee > 0 ? 'THIN' : 'SKIP';
  return {
    capital_usd: farm.capital_usd,
    slice_1k: slice,
    fee,
    fee_tx_count: farm.tx_count,
    gas_per_tx_usd: gas,
    operating_chain: chain,
    hold_days: holdDays,
    hours,
    tbill_usd: tbill,
    net,
    net_per_hour: netPerHour,
    verdict,
    steps: [],
  };
}

// ---------------------------------------------------------------- farm steps

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The weekly top-up for a repeated action: a tenth of the position's capital, capped at $25. */
function weeklyAmount(capital: number): number {
  return Math.min(25, Math.max(5, Math.round(capital / 10)));
}

/** A gas price as the steps write it: "$4" on Ethereum, "$0.50" anywhere else. */
function gasLabel(gas: number): string {
  return gas >= 1 ? `$${gas}` : `$${gas.toFixed(2)}`;
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
 * A protocol's farm plan: six steps, each an action with a cost and a time, on the operating
 * chain (the cheapest the protocol lists) and sized to the modelled $1,000 position, held for
 * the same hold the economics use. The gas in the cost lines is the assumed price on that
 * chain; the fee the economics charge (three transactions) is the deposit here, one weekly
 * interaction, and the claim — reads and checks are never charged.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = operatingChain(p);
  const gas = gasLabel(gasPerTx(chain));
  const capital = FARM.capital_usd;
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const weekly = weeklyActionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `about ${gas} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital.toLocaleString('en-US')} of capital and about ${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weekly,
      cost: `about ${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital.toLocaleString('en-US')} stays in the position`,
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

// ---------------------------------------------------------------- board, live, peers

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** Everything the board needs from one fit: the curve, the offsets, the backtest, and the band's width. */
export interface FittedRadar {
  fit: CurveFit;
  offsets: CategoryOffsets;
  backtest: Backtest;
}

/** Fit the curve, the offsets and the backtest for one snapshot, once per run. */
export function fitRadar(snapshot: Snapshot, model: ModelConstants = MODEL): FittedRadar {
  const peers = fitPeers(snapshot);
  const fit = fitCurve(peers);
  const offsets = deriveOffsets(peers, fit, model);
  const backtest = backtestRadar(snapshot, model);
  return { fit, offsets, backtest };
}

/**
 * The protocols the board ranks, strongest first, with ranks 1..n: every rankable pre-token protocol
 * (the watchlist plus every pre-token protocol below the floor), plus — belt and braces, as the starter
 * did — any watchlist slug the snapshot carries even if it failed the rankable test, so watchlist
 * coverage is never gambled on a filter. The wrapped/staked/bridged exclusion still applies on that
 * path too: no excluded product can re-enter the board through the watchlist.
 */
export function buildBoard(snapshot: Snapshot, radar: FittedRadar, model: ModelConstants = MODEL): BoardRow[] {
  const { fit, offsets, backtest } = radar;
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) if (isRankable(p)) chosen.set(p.slug, p);
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined && !isExcludedProduct(p)) chosen.set(slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, fit, offsets, model);
    const bandP10 = Math.max(1, Math.round(v.implied * 10 ** backtest.loo_residual_p10));
    const bandP90 = Math.max(1, Math.round(v.implied * 10 ** backtest.loo_residual_p90));
    const econ = farmEconomics(p, v.implied, v.age);
    const steps = farmSteps(p, v.age).map(stepText);
    econ.steps = steps;
    return { p, v, bandP10, bandP90, econ, steps };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
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
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    implied_band_p10_usd: s.bandP10,
    implied_band_p90_usd: s.bandP90,
    model: {
      a: round4(fit.a),
      b: round4(fit.b),
      category_offset: round4(s.v.offset),
      category_offset_peers: s.v.offsetPeers,
      momentum_multiplier: round4(s.v.momentum),
      seasoning_multiplier: round4(s.v.seasoning),
      growth_pct: s.v.growthPct,
      age_days: s.v.age,
      category_peers_n: s.v.offsetPeers,
      base_multiple: round4(s.v.curve / s.p.tvl_usd),
      growth_multiplier: round4(s.v.momentum),
      maturity_multiplier: round4(s.v.seasoning),
    },
    farm: s.econ,
    farm_steps: s.steps,
  }));
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

/**
 * Live-token comparables per category, so a detail view never shows an empty box: every
 * non-CEX live protocol (mcap > 0, TVL > 0) in its own category, richest first, with its own
 * market multiple. Bridge categories are included here — a bridge's live peers are real
 * comparables for a bridge — even though no bridge row reaches the board.
 */
export function peersByCategory(snapshot: Snapshot): Record<string, PeerEntry[]> {
  const byCategory = new Map<string, PeerEntry[]>();
  for (const p of snapshot.protocols.filter(isLivePeer)) {
    const entry: PeerEntry = {
      slug: p.slug,
      name: p.name,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: round4(p.mcap_usd! / p.tvl_usd),
    };
    const list = byCategory.get(p.category ?? '');
    if (list === undefined) byCategory.set(p.category ?? '', [entry]);
    else list.push(entry);
  }
  const out: Record<string, PeerEntry[]> = {};
  for (const [category, list] of [...byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    out[category] = list.sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  }
  return out;
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
    implied_band_p10_usd: row.implied_band_p10_usd,
    implied_band_p90_usd: row.implied_band_p90_usd,
    base_multiple: row.model.base_multiple,
    category_peers: row.model.category_peers_n,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    category_offset: row.model.category_offset,
    momentum_multiplier: row.model.momentum_multiplier,
    seasoning_multiplier: row.model.seasoning_multiplier,
    farm: row.farm,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const fitted = fitRadar(snapshot, model);
  const board = buildBoard(snapshot, fitted, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const verdict_counts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of board) verdict_counts[r.farm.verdict]++;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    farm: FARM,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    backtest: fitted.backtest,
    verdict_counts,
    rows: board.map(radarRow),
    live,
    peers_by_category: peersByCategory(snapshot),
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
    if (r.implied_band_p10_usd > r.implied_value_usd || r.implied_band_p90_usd < r.implied_value_usd) return `${r.slug} has an error band that does not contain its implied value`;
    if (r.farm.verdict !== 'FARM' && r.farm.verdict !== 'THIN' && r.farm.verdict !== 'SKIP') return `${r.slug} has farm verdict ${r.farm.verdict}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
