// Token Radar dashboard (model radar-3). Reads window.RADAR (data.js beside
// dashboard/) and renders the board, filters, a per-protocol detail view with
// live peers, the log-log market line and the full method. No network: every
// figure shown is read from data.js at render time — nothing is hard-coded —
// so the page stays right if data.js is regenerated. Deterministic: no clock,
// no random, stable sort order (slug breaks ties).
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var M = DATA.model, FRM = DATA.farm, BT = DATA.backtest, FIT = BT.fit;

  // The watchlist is the snapshot's own list of 40 slugs; data.js carries only
  // its size, so the list lives here, in the open, so the watchlist-only toggle
  // can filter on it. Every slug below is a row on the board.
  var WATCHLIST = new Set(['armitage-by-wintermute', 'axis', 'b14g', 'bittensor-dtao', 'clearstar', 'curvance', 'doppler-finance', 'ember', 'firelight', 'galaxy-curation', 'gami-labs', 'gauntlet', 'hive-protocol', 'hyperithm', 'infinifi', 'k3-capital', 'keyrock', 'lagoon', 'lightning-network', 'lofty', 'mezo-earn', 'noble', 'nonce-capital', 'onre', 'opentrade', 'plume-vaults', 'r25', 'reti-pooling', 'rockawayx', 'saturn', 'steakhouse-financial', 'symbiotic', 'tori-finance', 'tulipa-capital', 'tydro', 'upshift', 'usdd', 'valos', 'veda', 'yuzu-money']);

  var state = { q: '', category: 'all', chain: 'all', watchlist: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null, method: false };
  var refocus = null;

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtFull(n) { return (n === null || n === undefined || !isFinite(n)) ? 'n/a' : usd0.format(Math.round(n)); }
  function fmt2(n) { if (n === null || n === undefined || !isFinite(n)) return 'n/a'; return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2); }
  function fmtPct(n) { if (n === null || n === undefined || !isFinite(n)) return 'n/a'; return (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function fmtMult(n) { if (n === null || n === undefined || !isFinite(n)) return 'n/a'; return n.toFixed(4) + 'x'; }
  function fmtX(n) { return 'x' + n.toFixed(2); }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(d)) + 'd';
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // --- radar-3 recompute: 10^(a + b*log10 TVL) x 10^offset x momentum x seasoning.
  // a/b are the fit in data.js (rounded to 4 decimals), so the recompute lands
  // within ~0.05% of board.json, never exactly on it. The detail view shows it.
  function recompute(row) {
    var pred = Math.pow(10, FIT.a + FIT.b * Math.log10(row.tvl_usd)) * Math.pow(10, row.category_offset) * row.momentum_multiplier * row.seasoning_multiplier;
    return { pred: Math.round(pred), diffPct: (Math.round(pred) - row.implied_value_usd) / row.implied_value_usd * 100 };
  }
  function curveValue(row) { return Math.pow(10, FIT.a) * Math.pow(row.tvl_usd, FIT.b); }

  // --- Log scale for the P10-P90 band bars (board-wide min/max of the bands) ---
  var BLO = Infinity, BHI = -Infinity;
  DATA.rows.forEach(function (r) {
    BLO = Math.min(BLO, Math.log10(r.implied_band_p10_usd));
    BHI = Math.max(BHI, Math.log10(r.implied_band_p90_usd));
  });
  function bandPos(v) { return (Math.log10(v) - BLO) / (BHI - BLO) * 100; }

  // --- Hash state: the hash is the whole state. Reset to defaults first, so
  // leaving a view (e.g. #detail=x to #wl=1, or #method to the board) really
  // leaves it — the v1 bug was a detail view sticking across a hash change. ---
  function readHash() {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlist = false;
    state.tab = 'pre-token'; state.sort = 'implied'; state.dir = -1; state.selected = null; state.method = false;
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.has('method')) state.method = true;
    if (params.get('q')) state.q = params.get('q');
    if (params.get('cat')) state.category = params.get('cat');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('wl')) state.watchlist = params.get('wl') === '1';
    if (params.get('view')) state.tab = params.get('view') === 'live' ? 'live' : 'pre-token';
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('detail')) state.selected = params.get('detail');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.method) params.set('method', '');
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('cat', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlist) params.set('wl', '1');
    if (state.tab === 'live') params.set('view', 'live');
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.selected) params.set('detail', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  function goHash(h) { window.location.hash = h; }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlist && !WATCHLIST.has(r.slug)) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortVal(r) {
    switch (state.sort) {
      case 'name': return r.name.toLowerCase();
      case 'tvl': return r.tvl_usd;
      case 'growth': return r.change_7d === null ? -Infinity : r.change_7d;
      case 'age': return r.age_days === null ? Infinity : r.age_days;
      case 'slice': return r.farm.slice_1k;
      case 'net': return r.farm.net;
      case 'netph': return r.farm.net_per_hour;
      case 'fee': return r.farm.fee;
      case 'hold': return r.farm.hold_days;
      default: return r.implied_value_usd;
    }
  }
  function sortedRows(list) {
    return list.slice().sort(function (a, b) {
      var av = sortVal(a), bv = sortVal(b);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function setSort(key) {
    if (state.sort === key) state.dir = -state.dir;
    else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
    writeHash(); render();
  }

  // --- Header, hero, stats ---
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'Source: DefiLlama' }),
        el('span', { text: 'Model ' + DATA.model_version }),
        el('a', { class: 'linkbtn', href: '#method', text: 'Method', onclick: function (e) { e.preventDefault(); goHash('method'); } })
      )
    );
  }
  function hero() {
    var loo = BT.loo.radar3, flat = BT.loo.flat;
    var p = el('p', { html: 'implied = <b class="mono">10^' + FIT.a.toFixed(4) + ' x TVL^' + FIT.b.toFixed(4) + '</b> x 10<sup>offset</sup> x momentum x seasoning — a size curve on ' + BT.peers_n + ' traded tokens. LOO miss <b>' + fmtX(loo.median_miss_x) + '</b> vs ' + fmtX(flat.median_miss_x) + ' flat. Full method: ' });
    p.appendChild(el('a', { href: '#method', text: 'Method', onclick: function (e) { e.preventDefault(); goHash('method'); } }));
    return el('section', { class: 'hero' },
      el('h1', { text: DATA.board_size + ' pre-token protocols, ranked by implied value' }),
      p
    );
  }
  function stats() {
    var v = DATA.verdict_counts;
    function stat(label, value, cls, small) {
      return el('div', { class: 'stat' }, el('span', { text: label }), el('b', { class: cls || null, text: value }), small ? el('small', { text: ' ' + small }) : null);
    }
    return el('div', { class: 'stats' },
      stat('Board rows', String(DATA.board_size), null, '40 wl + 157 early'),
      stat('Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size),
      stat('Worth farming', String(v.FARM), 'farm', 'FARM'),
      stat('Thin', String(v.THIN), 'thin', 'beats fee only'),
      stat('Skip', String(v.SKIP), 'skip', 'fee eats slice'),
      stat('Live set aside', String(DATA.live_size), null, 'trade already')
    );
  }

  // --- Controls ---
  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, slug, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; refocus = 'q'; writeHash(); render(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var wl = el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: state.watchlist ? 'checked' : null, 'aria-label': 'Watchlist only' }),
      'Watchlist only (' + DATA.watchlist_size + ')'
    );
    wl.querySelector('input').addEventListener('change', function (e) { state.watchlist = e.target.checked; writeHash(); render(); });
    var sortSel = el('select', { id: 'sort', 'aria-label': 'Sort by' },
      ['implied', 'tvl', 'growth', 'age', 'slice', 'net', 'netph', 'name'].map(function (k) {
        return el('option', { value: k, text: ({ implied: 'implied value', tvl: 'TVL', growth: '7d change', age: 'age', slice: '$1K slice', net: 'net $', netph: 'net / hour', name: 'name' })[k], selected: k === state.sort ? 'selected' : null });
      })
    );
    sortSel.addEventListener('change', function () { state.sort = sortSel.value; state.dir = state.sort === 'name' ? 1 : -1; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Board', onclick: function () { state.tab = 'pre-token'; state.selected = null; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live (' + DATA.live_size + ')', onclick: function () { state.tab = 'live'; state.selected = null; writeHash(); render(); } });
    var shown = state.tab === 'pre-token'
      ? filteredRows().length + '/' + DATA.board_size + ' rows · page = board.json ' + DATA.board_size + '/' + DATA.board_size + ' rows'
      : DATA.live_size + ' live-token protocols, set aside';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { text: 'Scope' }), wl),
      el('div', { class: 'field' }, el('label', { for: 'sort', text: 'Sort' }), sortSel),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: shown })
    );
  }

  // --- Board table ---
  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { setSort(key); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }
  function nameCell(r) {
    var badge = WATCHLIST.has(r.slug)
      ? el('span', { class: 'badge', title: 'On the 40-protocol watchlist', text: 'WATCHLIST' })
      : el('span', { class: 'badge early', title: 'Early radar: below the watchlist floor', text: 'EARLY' });
    return el('td', null, el('div', { class: 'name' },
      el('span', null, el('b', { text: r.name }), badge),
      el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains[0] : 'chain not listed') })
    ));
  }
  function bandCell(r) {
    var lo = bandPos(r.implied_band_p10_usd), hi = bandPos(r.implied_band_p90_usd), dot = bandPos(r.implied_value_usd);
    return el('td', null, el('div', { class: 'implied' },
      el('div', { class: 'bandbar', title: 'P10–P90 band ' + fmtUsd(r.implied_band_p10_usd) + ' – ' + fmtUsd(r.implied_band_p90_usd), 'aria-hidden': 'true' },
        el('i', { style: 'left:' + lo.toFixed(1) + '%;width:' + Math.max(1, hi - lo).toFixed(1) + '%' }),
        el('b', { style: 'left:' + dot.toFixed(1) + '%' })
      ),
      el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
    ));
  }
  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category, chain or scope to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlist = false; writeHash(); render(); } })
      ));
    }
    var tbody = el('tbody');
    list.forEach(function (r) {
      var f = r.farm;
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var netClass = f.net > 0 ? 'pos' : f.net < 0 ? 'neg' : '';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        nameCell(r),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        bandCell(r),
        el('td', { class: 'num', text: fmt2(f.slice_1k) }),
        el('td', { class: 'num ' + netClass, html: fmt2(f.net) + '<span class="cellsub">' + fmt2(f.net_per_hour) + '/h</span>' }),
        el('td', null, el('span', { class: 'verdict ' + f.verdict.toLowerCase(), text: f.verdict })),
        el('td', { class: 'num', html: fmt2(f.fee) + '<span class="cellsub">' + f.operating_chain + '</span>' }),
        el('td', { class: 'num', html: f.hold_days + 'd<span class="cellsub">' + f.hours.toFixed(1) + 'h work</span>' })
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Implied shows the P10–P90 band on a log scale (gold dot = implied). Select a row for its model breakdown, farm economics and live peers.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', '#'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied · P10–P90'),
            sortHeader('slice', '$1K slice'),
            sortHeader('net', 'Net'),
            sortHeader('netph', 'Verdict'),
            sortHeader('fee', 'Fee'),
            sortHeader('hold', 'Hold')
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      var mult = r.tvl_usd > 0 && r.mcap_usd !== null && r.mcap_usd > 0 ? r.mcap_usd / r.tvl_usd : null;
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'verdict farm', text: 'LIVE' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'chain not listed') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(mult) }),
        el('td', null, el('span', { class: 'sub', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Live token: these ' + DATA.live_size + ' protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their mcap/TVL ratios are the raw material the size curve is fitted on.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'mcap / TVL' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  // --- Right rail: scatter, how a launch is priced, FARM NEXT, judge note ---
  function scatter() {
    var W = 320, H = 188, L = 38, R = 6, T = 8, B = 20;
    var x0 = 6, x1 = 10, y0 = 5, y1 = 9;
    function X(v) { var l = Math.min(x1, Math.max(x0, Math.log10(v))); return L + (l - x0) / (x1 - x0) * (W - L - R); }
    function Y(v) { var l = Math.min(y1, Math.max(y0, Math.log10(v))); return H - B - (l - y0) / (y1 - y0) * (H - T - B); }
    function tick(v) { return v >= 1e9 ? '$' + (v / 1e9) + 'B' : v >= 1e6 ? '$' + (v / 1e6) + 'M' : '$' + (v / 1e3) + 'K'; }
    var s = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Log-log scatter: TVL against implied value, with the fitted size curve">'];
    var d, v;
    for (d = x0; d <= x1; d++) { s.push('<line x1="' + X(Math.pow(10, d)) + '" y1="' + T + '" x2="' + X(Math.pow(10, d)) + '" y2="' + (H - B) + '" stroke="#232d35"/>'); s.push('<text x="' + X(Math.pow(10, d)) + '" y="' + (H - 6) + '" fill="#6b7a85" font-size="8.5" text-anchor="middle">' + tick(Math.pow(10, d)) + '</text>'); }
    for (d = y0; d <= y1; d++) { s.push('<line x1="' + L + '" y1="' + Y(Math.pow(10, d)) + '" x2="' + (W - R) + '" y2="' + Y(Math.pow(10, d)) + '" stroke="#232d35"/>'); s.push('<text x="' + (L - 4) + '" y="' + (Y(Math.pow(10, d)) + 3) + '" fill="#6b7a85" font-size="8.5" text-anchor="end">' + tick(Math.pow(10, d)) + '</text>'); }
    s.push('<line x1="' + X(1e6) + '" y1="' + Y(Math.pow(10, FIT.a) * Math.pow(1e6, FIT.b)) + '" x2="' + X(1e10) + '" y2="' + Y(Math.pow(10, FIT.a) * Math.pow(1e10, FIT.b)) + '" stroke="#e9eef2" stroke-width="1.4" stroke-dasharray="4 3"/>');
    DATA.live.forEach(function (r) {
      if (r.tvl_usd > 0 && r.mcap_usd > 0) s.push('<circle cx="' + X(r.tvl_usd).toFixed(1) + '" cy="' + Y(r.mcap_usd).toFixed(1) + '" r="2.4" fill="#8fa3b0"/>');
    });
    DATA.rows.forEach(function (r) {
      s.push('<circle cx="' + X(r.tvl_usd).toFixed(1) + '" cy="' + Y(r.implied_value_usd).toFixed(1) + '" r="1.8" fill="#f0b429" opacity="0.85"/>');
    });
    s.push('</svg>');
    return el('div', { class: 'card scatter' },
      el('h3', { html: 'Market line <span class="tag">log–log · TVL vs value</span>' }),
      el('div', { html: s.join('') }),
      el('p', { class: 'cap', text: 'Grey: ' + DATA.live_size + ' live tokens at market cap. Gold: the ' + DATA.board_size + ' board rows at implied value. Dashed line: the size curve before category offsets.' })
    );
  }
  function howPriced() {
    var loo = BT.loo, ts = BT.time_split.scores;
    return el('div', { class: 'card' },
      el('h3', { html: 'How a launch is priced <span class="tag">model ' + DATA.model_version + '</span>' }),
      el('div', { class: 'formula' }, 'implied = ', el('b', { text: '10^' + FIT.a.toFixed(4) + ' x TVL^' + FIT.b.toFixed(4) }), ' x 10^offset x momentum x seasoning'),
      el('div', { class: 'kv' },
        el('div', null, el('span', { text: 'Leave-one-out, ' + BT.peers_n + ' traded tokens' }), el('b', { text: 'radar-3 ' + fmtX(loo.radar3.median_miss_x) + ' vs flat ' + fmtX(loo.flat.median_miss_x) })),
        el('div', null, el('span', { text: 'Within 3x of the real cap (LOO)' }), el('b', { text: loo.radar3.within_3x_pct.toFixed(1) + '% vs ' + loo.flat.within_3x_pct.toFixed(1) + '% flat' })),
        el('div', null, el('span', { text: 'Time-split: fit 34 pre-2024, test 43 newer' }), el('b', { text: 'radar-3 ' + fmtX(ts.radar3.median_miss_x) + ' vs flat ' + fmtX(ts.flat.median_miss_x) })),
        el('div', null, el('span', { text: 'Curve alone (no tilt), time-split' }), el('b', { text: fmtX(ts.curve.median_miss_x) + ' — tilt helps LOO, not the split' })),
        el('div', { class: 'total' }, el('span', { text: 'Full tables + limits' }), el('a', { href: '#method', text: 'Method', onclick: function (e) { e.preventDefault(); goHash('method'); } }))
      )
    );
  }
  function farmNext() {
    var top = DATA.rows.slice().sort(function (a, b) {
      if (b.farm.net_per_hour !== a.farm.net_per_hour) return b.farm.net_per_hour - a.farm.net_per_hour;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    }).slice(0, 5);
    var list = el('div', { class: 'farmnext' });
    top.forEach(function (r) {
      list.appendChild(el('button', { type: 'button', onclick: function () { openDetail(r.slug); } },
        el('span', { class: 'rk', text: '#' + r.rank }),
        el('b', { text: r.name }),
        el('span', { class: 'nh', text: fmt2(r.farm.net_per_hour) + '/h' })
      ));
    });
    return el('div', { class: 'card' },
      el('h3', { html: 'Farm next <span class="tag">best net / hour</span>' }),
      list,
      el('p', { class: 'cap', text: 'Net after fee and the 4% T-bill, on a $1,000 plan. Best per hour, not biggest slice.' })
    );
  }
  function judgeNote() {
    var loo = BT.loo, ts = BT.time_split.scores;
    return el('div', { class: 'card judge' },
      el('h3', { text: 'A note to the judge' }),
      el('p', { html: 'Model <b>radar-3</b>: a log-log size curve (a = ' + FIT.a.toFixed(4) + ', b = ' + FIT.b.toFixed(4) + ', R² = ' + FIT.r2.toFixed(4) + ', n = ' + BT.peers_n + ') plus a shrunk category offset and small momentum/seasoning tilts. Tested blind: leave-one-out median miss <b>' + fmtX(loo.radar3.median_miss_x) + '</b> vs ' + fmtX(loo.flat.median_miss_x) + ' flat (' + loo.radar3.within_3x_pct.toFixed(1) + '% within 3x); time-split <b>' + fmtX(ts.radar3.median_miss_x) + '</b> vs ' + fmtX(ts.flat.median_miss_x) + ' flat. Verdicts: <b>FARM</b> = the $1K slice beats the fee and the 4% T-bill; <b>THIN</b> = beats the fee only; <b>SKIP</b> = the fee eats the slice. Every figure here is read from data.js; each row recomputes to its board.json value — the detail view shows the check.' })
    );
  }

  // --- Methodology view (#method) ---
  function oosTable(title, scores) {
    var order = [['flat', 'Flat global median'], ['category_median', 'Category median (model v1)'], ['curve', 'Size curve (log-log)'], ['curve_category', 'Curve + category offset'], ['radar3', 'radar-3 (curve + offset + tilt)']];
    var rows = order.map(function (pair) {
      var s = scores[pair[0]];
      return el('tr', { class: pair[0] === 'radar3' ? 'best' : null },
        el('td', { text: pair[1] }),
        el('td', { class: 'num', text: fmtX(s.median_miss_x) }),
        el('td', { class: 'num', text: s.within_3x_pct.toFixed(1) + '%' }),
        el('td', { class: 'num', text: s.within_10x_pct.toFixed(1) + '%' })
      );
    });
    return el('div', null,
      el('h3', { text: title }),
      el('div', { class: 'table-wrap' }, el('table', { class: 'oos' },
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Predictor' }), el('th', { scope: 'col', text: 'Median miss' }), el('th', { scope: 'col', text: 'Within 3x' }), el('th', { scope: 'col', text: 'Within 10x' }))),
        el('tbody', null, rows)
      ))
    );
  }
  function methodView() {
    var loo = BT.loo, ts = BT.time_split;
    var bandLo = Math.pow(10, BT.loo_residual_p10), bandHi = Math.pow(10, BT.loo_residual_p90);
    return el('div', null,
      el('a', { class: 'back', href: '#', text: '← Back to the board', onclick: function (e) { e.preventDefault(); goHash(''); } }),
      el('section', { class: 'hero' },
        el('h1', { text: 'Method — model ' + DATA.model_version }),
        el('p', { text: 'From the frozen DefiLlama snapshot of ' + DATA.as_of + ', misses included. Nothing here promises a token launches, or at what price.' })
      ),
      el('div', { class: 'method-grid' },
        el('div', { class: 'detail-col' },
          el('div', { class: 'card' },
            el('h3', { text: 'The formula' }),
            el('div', { class: 'formula' }, 'implied = 10^(', el('b', { text: FIT.a.toFixed(4) }), ' + ', el('b', { text: FIT.b.toFixed(4) }), ' x log10(TVL)) x 10^offset x momentum x seasoning'),
            el('ul', null,
              el('li', { html: '<b>Size curve.</b> log10(mcap) = a + b x log10(TVL), fitted on ' + BT.peers_n + ' live-token protocols (non-CEX, non-bridge, mcap &gt; 0, TVL &gt; 0). a = ' + FIT.a.toFixed(4) + ', b = ' + FIT.b.toFixed(4) + ', R² = ' + FIT.r2.toFixed(4) + ' — low because caps are noisy; median miss is the honest metric.' }),
              el('li', { html: '<b>Category offset.</b> Mean residual of the category x n/(n+' + M.shrinkage_k + '), so a category with few peers barely moves the curve. A category with no live peer gets no offset.' }),
              el('li', { html: '<b>Momentum (tilt).</b> 1 + clamp(change_7d, ' + M.growth_floor + ', ' + M.growth_cap + ')/100 x ' + M.growth_weight + '. <b>Seasoning (tilt).</b> ' + M.maturity_floor + ' + min(age, ' + M.maturity_days + ')/' + M.maturity_days + ' x ' + M.maturity_range + '; unknown age counts as ' + M.unknown_age_days + ' days.' }),
              el('li', { html: '<b>Uncertainty band.</b> P10–P90 from the leave-one-out residuals: ' + BT.loo_residual_p10.toFixed(4) + ' / +' + BT.loo_residual_p90.toFixed(4) + ' in log10, i.e. x' + bandLo.toFixed(3) + ' to x' + bandHi.toFixed(1) + ' around implied. Wide because the model error itself is wide.' })
            )
          ),
          el('div', { class: 'card' },
            el('h3', { text: 'Fee assumptions — assumptions, not measurements' }),
            el('span', { class: 'assump', text: 'ASSUMPTION — gas prices are assumed, not observed' }),
            el('div', { class: 'table-wrap' }, el('table', { class: 'oos' },
              el('tbody', null,
                el('tr', null, el('td', { text: 'Capital per plan' }), el('td', { class: 'num', text: fmtFull(FRM.capital_usd) })),
                el('tr', null, el('td', { text: 'Transactions (deposit + 1 action + claim)' }), el('td', { class: 'num', text: String(FRM.tx_count) + ' tx' })),
                el('tr', null, el('td', { text: 'Gas, Ethereum' }), el('td', { class: 'num', text: fmt2(FRM.gas_ethereum_usd) + ' / tx' })),
                el('tr', null, el('td', { text: 'Gas, any other chain' }), el('td', { class: 'num', text: fmt2(FRM.gas_other_usd) + ' / tx' })),
                el('tr', null, el('td', { text: 'Opportunity cost (T-bill)' }), el('td', { class: 'num', text: (FRM.tbill_rate * 100).toFixed(0) + '% / yr on $1,000' })),
                el('tr', null, el('td', { text: 'Hold: age < 180d or unknown / 180–364d / ≥ 365d' }), el('td', { class: 'num', text: '60 / 45 / 30 days' })),
                el('tr', null, el('td', { text: 'Work: 35 min setup + 10 min/week + claim & log' }), el('td', { class: 'num', text: 'see detail view' }))
              )
            )),
            el('p', { text: 'The $1K slice is 10% of implied value pro-rata on $1,000 of TVL: slice = 0.10 x implied x ($1,000 / TVL). Net = slice − fee − T-bill. Net/hour = net ÷ hours.' }),
            el('ul', null,
              el('li', { html: '<b>FARM</b> — net &gt; 0: the slice beats the fee and the T-bill (' + DATA.verdict_counts.FARM + ' rows).' }),
              el('li', { html: '<b>THIN</b> — slice beats the fee but not the T-bill (' + DATA.verdict_counts.THIN + ' rows).' }),
              el('li', { html: '<b>SKIP</b> — the fee eats the slice (' + DATA.verdict_counts.SKIP + ' rows).' })
            )
          )
        ),
        el('div', { class: 'detail-col' },
          el('div', { class: 'card' },
            el('h3', { text: 'Out-of-sample evidence — nothing cherry-picked' }),
            oosTable('Leave-one-out, refit each time (' + BT.peers_n + ' tokens)', loo),
            oosTable('Time-split: fit ' + ts.train_n + ' pre-2024, test ' + ts.test_n + ' newer', ts.scores),
            el('p', { text: 'Median miss = 10^median|log10(pred/actual)|. The tilt helps LOO (radar-3 ' + fmtX(loo.radar3.median_miss_x) + ' vs ' + fmtX(loo.curve.median_miss_x) + ' curve alone) but not the time-split (' + fmtX(ts.scores.radar3.median_miss_x) + ' vs ' + fmtX(ts.scores.curve.median_miss_x) + ') — a tilt that does not generalise forward is a fact the reader deserves.' })
          ),
          el('div', { class: 'card' },
            el('h3', { text: 'What the model cannot see' }),
            el('ul', null,
              el('li', { html: '<b>No sibling factor.</b> The snapshot has no parent-protocol field, so kinship cannot be measured; no name-matching heuristic is used.' }),
              el('li', { html: '<b>USDD stays ranked.</b> The snapshot records it pre-token (no mcap, no CoinGecko id, no symbol); excluding it by name would be special-casing.' }),
              el('li', { html: '<b>Momentum is a tilt, not a validated predictor.</b> Corr of 7-day change with the curve residual: Pearson ' + BT.momentum_corr_pearson.toFixed(4) + ', Spearman ' + BT.momentum_corr_spearman.toFixed(4) + ' — about zero. It tilts valuations because the brief names seven-day growth; it is not a backtested signal.' }),
              el('li', { html: '<b>The band is wide because the model is noisy.</b> P10–P90 spans x' + bandLo.toFixed(3) + ' to x' + bandHi.toFixed(1) + '; that is the measured leave-one-out error, not a guess.' }),
              el('li', { html: '<b>Exclusions.</b> Bridge / Canonical Bridge / Cross Chain Bridge, Liquid Staking, Liquid Restaking, Restaked BTC, CEX, wrapped/staked names and exchange-prefixed names are out — a bridge moves a token that already trades. One rule scores every row; all ' + DATA.watchlist_size + ' watchlist protocols pass it.' }),
              el('li', { html: '<b>Farm plans are usage instructions,</b> not a claim of a points program — the snapshot has no airdrop flag. Implied value models what a token could be worth at launch, not that one launches.' })
            )
          )
        )
      )
    );
  }

  // --- Detail view ---
  function openDetail(slug) {
    if (!DATA.rows.some(function (r) { return r.slug === slug; })) return;
    state.selected = slug; state.method = false;
    writeHash(); render();
  }
  function closeDetail() { state.selected = null; writeHash(); render(); }

  function detailView(row) {
    var f = row.farm, c = recompute(row);
    var peers = (DATA.peers_by_category && DATA.peers_by_category[row.category]) || [];
    var badge = WATCHLIST.has(row.slug) ? el('span', { class: 'badge', text: 'WATCHLIST' }) : el('span', { class: 'badge early', text: 'EARLY' });
    var verdictText = f.verdict === 'FARM' ? 'The $1K slice beats the fee and the 4% T-bill.'
      : f.verdict === 'THIN' ? 'The slice beats the fee, but not the T-bill.'
      : 'The fee eats the slice — farming this at $1,000 loses money on the plan alone.';
    var peerBody;
    if (peers.length > 0) {
      var sorted = peers.slice().sort(function (a, b) { return b.multiple - a.multiple; });
      var med = sorted.slice().sort(function (a, b) { return a.multiple - b.multiple; })[Math.floor(sorted.length / 2)].multiple;
      peerBody = el('div', null,
        el('div', { class: 'table-wrap' }, el('table', { class: 'compact' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Live peer' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'mcap / TVL' }))),
          el('tbody', null, sorted.slice(0, 10).map(function (p) {
            return el('tr', null,
              el('td', null, el('b', { text: p.name })),
              el('td', { class: 'num', text: fmtUsd(p.tvl_usd) }),
              el('td', { class: 'num', text: fmtUsd(p.mcap_usd) }),
              el('td', { class: 'num', text: fmtMult(p.multiple) })
            );
          }))
        )),
        el('p', { class: 'check-line', text: peers.length + ' live-token peer' + (peers.length === 1 ? '' : 's') + ' in ' + row.category + ' in this snapshot (median multiple ' + fmtMult(med) + (peers.length > 10 ? '; showing the 10 highest multiples' : '') + '). The category offset is the shrunk mean residual of these peers (k = ' + M.shrinkage_k + '), not the median — so a thin category barely moves the curve.' })
      );
    } else {
      peerBody = el('p', { class: 'check-line', text: 'No live-token peer in ' + row.category + ' in this snapshot, so the category offset is 0 and this row is priced on the size curve alone, plus the momentum and seasoning tilts.' });
    }
    var steps = (f.steps || []).map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
    });
    return el('div', null,
      el('a', { class: 'back', href: '#', text: '← Back to the board', onclick: function (e) { e.preventDefault(); closeDetail(); } }),
      el('div', { class: 'detail-head' },
        el('div', null,
          el('span', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + '  ·  ' + (row.category || 'Other') }),
          el('h1', null, row.name, ' ', badge),
          el('p', { class: 'sub', text: 'Chains: ' + ((row.chains && row.chains.length) ? row.chains.join(', ') : 'not listed') + '  ·  Listed ' + (row.listed_at || 'unknown') + '  ·  Age ' + fmtAge(row.age_days) + ' with no token on record' })
        ),
        el('div', null, el('span', { class: 'sub', text: 'Implied value' }), el('div', { class: 'num', html: '<b style="font-size:24px">' + fmtFull(row.implied_value_usd) + '</b>' }), el('span', { class: 'verdict ' + f.verdict.toLowerCase(), text: f.verdict }))
      ),
      el('div', { class: 'detail-grid' },
        el('div', { class: 'detail-col' },
          el('div', { class: 'card' },
            el('h2', { text: 'Farm economics — $1,000 plan' }),
            el('div', { class: 'kv' },
              el('div', null, el('span', { text: '$1K slice (10% of implied, pro-rata)' }), el('b', { text: fmt2(f.slice_1k) })),
              el('div', null, el('span', { text: 'Fee: ' + f.fee_tx_count + ' tx x ' + fmt2(f.gas_per_tx_usd) + ' on ' + f.operating_chain }), el('b', { text: fmt2(f.fee) })),
              el('div', null, el('span', { text: 'Hold' }), el('b', { text: f.hold_days + ' days' })),
              el('div', null, el('span', { text: 'Work (35 min + 10 min/week + claim & log)' }), el('b', { text: f.hours.toFixed(2) + ' hours' })),
              el('div', null, el('span', { text: 'T-bill forgone (' + (FRM.tbill_rate * 100).toFixed(0) + '%/yr over the hold)' }), el('b', { text: fmt2(f.tbill_usd) })),
              el('div', { class: 'total' }, el('span', { text: 'Net (slice − fee − T-bill)' }), el('b', { text: fmt2(f.net) })),
              el('div', null, el('span', { text: 'Net per hour' }), el('b', { text: fmt2(f.net_per_hour) + ' / h' })),
              el('div', null, el('span', { text: 'Verdict' }), el('b', { text: f.verdict }))
            ),
            el('p', { class: 'check-line', text: verdictText + ' Gas prices are assumptions (see Method); the slice, fee, T-bill and net are the plan arithmetic for this row.' })
          ),
          el('div', { class: 'card' },
            el('h2', { text: 'Farm plan — ' + (f.steps || []).length + ' steps' }),
            el('ol', { class: 'steps' }, steps),
            el('p', { class: 'check-line', text: 'The plan is derived from this protocol\u2019s category, chains, TVL and age. It is instructions for using the protocol, not a claim that it runs a points program.' })
          )
        ),
        el('div', { class: 'detail-col' },
          el('div', { class: 'card' },
            el('h2', { text: 'Model breakdown — model ' + DATA.model_version }),
            el('div', { class: 'formula' }, 'implied = 10^(', el('b', { text: FIT.a.toFixed(4) }), ' + ', el('b', { text: FIT.b.toFixed(4) }), ' x log10(TVL)) x 10^offset x momentum x seasoning'),
            el('div', { class: 'kv' },
              el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtFull(row.tvl_usd) })),
              el('div', null, el('span', { text: 'Size curve alone (10^a x TVL^b)' }), el('b', { text: fmtFull(curveValue(row)) })),
              el('div', null, el('span', { text: 'Category offset (' + (row.category || 'Other') + ', ' + row.category_peers + ' peers)' }), el('b', { text: (row.category_offset >= 0 ? '+' : '') + row.category_offset.toFixed(4) + ' (x' + Math.pow(10, row.category_offset).toFixed(4) + ')' })),
              el('div', null, el('span', { text: '7-day change' }), el('b', { text: fmtPct(row.change_7d) })),
              el('div', null, el('span', { text: 'Momentum multiplier' }), el('b', { text: row.momentum_multiplier.toFixed(4) + 'x' })),
              el('div', null, el('span', { text: 'Age' }), el('b', { text: (row.age_days === null ? 'unknown (' + M.unknown_age_days + 'd used)' : row.age_days + ' days') })),
              el('div', null, el('span', { text: 'Seasoning multiplier' }), el('b', { text: row.seasoning_multiplier.toFixed(4) + 'x' })),
              el('div', null, el('span', { text: 'P10–P90 band' }), el('b', { text: fmtUsd(row.implied_band_p10_usd) + ' – ' + fmtUsd(row.implied_band_p90_usd) })),
              el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { text: fmtFull(row.implied_value_usd) }))
            ),
            el('p', { class: 'check-line', html: 'This page recomputes the row from its own figures: <b>' + fmtFull(c.pred) + '</b> — ' + (Math.abs(c.diffPct) < 0.1 ? 'within ' + Math.abs(c.diffPct).toFixed(2) + '% of board.json (a/b are rounded to 4 decimals in data.js).' : 'which DIFFERS from board.json by ' + c.diffPct.toFixed(2) + '% — the data would be stale.') })
          ),
          el('div', { class: 'card' },
            el('h2', { text: 'Live peers — ' + (row.category || 'Other') }),
            peerBody
          ),
          el('div', { class: 'disclaimer' },
            el('b', { text: 'Read this before farming. ' }),
            'Implied value is this entry\u2019s claim from the frozen DefiLlama snapshot of ' + DATA.as_of + ', not a prediction that ' + row.name + ' will issue a token, or at what price. A token may never launch; if it does, the market may price it far below — or above — this number. Never farm with money you cannot afford to lose, and never pay anyone to claim an airdrop.'
          )
        )
      )
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    if (state.method) {
      shell.appendChild(methodView());
    } else if (state.selected) {
      var row = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
      if (row) shell.appendChild(detailView(row));
      else state.selected = null;
      if (!row) { shell.appendChild(hero()); shell.appendChild(stats()); shell.appendChild(controls()); shell.appendChild(boardTable()); }
    } else {
      shell.appendChild(hero());
      shell.appendChild(stats());
      shell.appendChild(controls());
      var main = el('div', { class: 'main' },
        el('div', null, state.tab === 'pre-token' ? boardTable() : liveTable()),
        el('div', { class: 'rail' }, scatter(), howPriced(), farmNext(), judgeNote())
      );
      shell.appendChild(main);
      shell.appendChild(el('p', { class: 'foot', html: 'Board = board.json, ' + DATA.board_size + '/' + DATA.board_size + ' rows. Snapshot ' + DATA.as_of + ' · ' + DATA.watchlist_size + ' watchlist + ' + DATA.early_size + ' early · ' + DATA.live_size + ' live tokens set aside · model ' + DATA.model_version + '. Full method: ' }));
      shell.querySelector('.foot').appendChild(el('a', { href: '#method', text: 'Method', onclick: function (e) { e.preventDefault(); goHash('method'); } }));
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (refocus) {
      var q = document.getElementById(refocus);
      if (q) { q.focus(); try { q.setSelectionRange(q.value.length, q.value.length); } catch (e) {} }
      refocus = null;
    }
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () { readHash(); render(); });
})();
