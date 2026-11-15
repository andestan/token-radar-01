// Token Radar dashboard (model radar-2). It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, a filterable table, a
// per-protocol detail view with the model's own arithmetic, the live-token set
// and the methodology in full. No network: every byte it shows is in data.js.
//
// One rule shapes the whole page: every implied value shown comes from the
// row's own base_multiple in data.js — the category multiple board.json used.
// The page never prices a row at the global fallback unless that row's own
// multiple IS the fallback. The starter recomputed with a flat 0.25; that bug
// is gone here.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var M = DATA.model;

  // The watchlist is the snapshot's own list of 40 slugs; data.js carries only
  // its size, so the list lives here, in the open, so the watchlist-only toggle
  // can filter on it. Every slug below is a row on the board.
  var WATCHLIST = new Set(['armitage-by-wintermute', 'axis', 'b14g', 'bittensor-dtao', 'clearstar', 'curvance', 'doppler-finance', 'ember', 'firelight', 'galaxy-curation', 'gami-labs', 'gauntlet', 'hive-protocol', 'hyperithm', 'infinifi', 'k3-capital', 'keyrock', 'lagoon', 'lightning-network', 'lofty', 'mezo-earn', 'noble', 'nonce-capital', 'onre', 'opentrade', 'plume-vaults', 'r25', 'reti-pooling', 'rockawayx', 'saturn', 'steakhouse-financial', 'symbiotic', 'tori-finance', 'tulipa-capital', 'tydro', 'upshift', 'usdd', 'valos', 'veda', 'yuzu-money']);

  var state = { q: '', category: 'all', chain: 'all', watchlist: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtUsdFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(4) + 'x';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
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

  // --- The model's arithmetic, exactly as lib/model.ts scores it ---
  // growthPct: the clamped 7-day change this row was scored on. recompute:
  // TVL x the row's OWN base_multiple x growth x maturity, rounded — the
  // number board.json carries for this row.
  function growthPctOf(row) {
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    return Math.min(M.growth_cap, Math.max(M.growth_floor, g));
  }
  function recompute(row) {
    var g = growthPctOf(row);
    var growthMult = 1 + (g / 100) * M.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? M.unknown_age_days : row.age_days;
    var maturity = M.maturity_floor + (Math.min(Math.max(age, 0), M.maturity_days) / M.maturity_days) * M.maturity_range;
    return { growthPct: g, growthMult: growthMult, maturityMult: maturity, implied: Math.max(1, Math.round(row.tvl_usd * row.base_multiple * growthMult * maturity)) };
  }

  // --- The farm plan: the same derivation main.ts writes to board.json ---
  // Category, chains, TVL and age decide the action, the capital, the hold and
  // every cost and time. No name is special-cased. These are instructions for
  // using the protocol, not a claim that it runs a points program.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function weeklyAmount(capital) { return Math.min(25, Math.max(5, Math.round(capital / 10))); }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('govern') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and vote on one proposal when voting opens.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function weeklyActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var w = weeklyAmount(capital);
    if (c.indexOf('dex') >= 0) return 'Each week, swap $' + w + ' of USDC for another asset in ' + name + "'s main pool on " + chain + ', then swap it back, to show repeated use.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Each week, supply or borrow $' + w + ' on ' + name + ' on ' + chain + ' and repay or withdraw a small part, to show repeated use.';
    if (c.indexOf('bridge') >= 0) return 'Each week, bridge $' + w + ' of USDC through ' + name + ' to ' + chain + ' and use the bridged funds in its app, to show repeated use.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Each week, check the rewards on ' + name + ' on ' + chain + ' and stake another $' + w + ' of the staking asset when you can.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Each week, open and close one small $' + w + ' hedge on ' + name + ' on ' + chain + ', to show repeated use.';
    if (c.indexOf('prediction') >= 0) return 'Each week, place one $' + w + ' market position on ' + name + ' on ' + chain + '.';
    if (c.indexOf('govern') >= 0) return 'Each week, vote on one live proposal on ' + name + ' on ' + chain + ' with the position you hold.';
    if (c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('farm') >= 0) return 'Each week, harvest and compound about $' + w + ' of rewards from ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Each week, hold the ' + name + ' position on ' + chain + ' and top it up by $' + w + ' when you can.';
    if (c.indexOf('stable') >= 0) return 'Each week, mint or redeem $' + w + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('insurance') >= 0) return 'Each week, keep the ' + name + ' cover on ' + chain + ' active and check the policy still covers the position.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Each week, check the ' + name + ' vault on ' + chain + ' and add $' + w + ' when the vault is open.';
    return 'Each week, make one qualifying action on ' + name + ' on ' + chain + ', such as a deposit, a borrow, a swap or a vote, with about $' + w + '.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: weeklyActionFor(p, capital, chain), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  // --- Live-token comparables: the same-category live protocols, by market cap ---
  // The page only knows the 24 live protocols data.js carries, so a category
  // with no live row among those 24 shows the multiple's provenance instead:
  // how many live peers the whole snapshot has in the category, and whether
  // the multiple is the category median or the global fallback.
  function comparables(row) {
    return DATA.live
      .filter(function (r) { return r.category === row.category && r.tvl_usd > 0 && r.mcap_usd !== null && r.mcap_usd > 0; })
      .sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0); })
      .slice(0, 5);
  }
  function multipleNote(row) {
    var peers = row.category_peers;
    var cat = row.category || 'Other';
    if (peers >= M.min_category_peers) {
      return 'The multiple is the median mcap/TVL of the ' + peers + ' live-token peers in ' + cat + ' in this snapshot.';
    }
    if (peers > 0) {
      return 'Only ' + peers + ' live-token peer' + (peers === 1 ? '' : 's') + ' in ' + cat + ' — below the ' + M.min_category_peers + '-peer minimum — so the global fallback ' + M.global_multiple.toFixed(4) + 'x (median of 119 live peers) is used.';
    }
    return 'No live-token peer in ' + cat + ' in this snapshot, so the global fallback ' + M.global_multiple.toFixed(4) + 'x (median of 119 live peers) is used.';
  }

  // --- Hash state: every view opens from a link ---
  // The hash is the whole state: reset to defaults first, so leaving a view
  // (for example #detail=x to #wl=1) really leaves it.
  function readHash() {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlist = false;
    state.tab = 'pre-token'; state.sort = 'implied'; state.dir = -1; state.selected = null;
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
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
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
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

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'Source: DefiLlama' }),
        el('span', { text: 'Model ' + DATA.model_version })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.board_size + ' pre-token protocols, ranked by implied value' }),
        el('p', { class: 'method-line', html: 'implied = <b>TVL x category multiple x growth x maturity</b>. The multiple is the median mcap/TVL of the protocol\u2019s own category\u2019s live-token peers (global fallback ' + M.global_multiple.toFixed(4) + 'x, clamped [0.05, 1.50]).' }),
        el('p', { text: 'The watchlist is the floor: the 40 protocols with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model of what a token could be worth at launch, not a promise that one launches, or at what price.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Board rows' }), el('b', { text: DATA.board_size + '  (40 watchlist + ' + DATA.early_size + ' early)' })),
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Category multiples measured' }), el('b', { text: Object.keys(M.category_multiples).length + ' categories' }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, slug, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories (' + categories.length + ')' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains (' + chains.length + ')' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var wl = el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: state.watchlist ? 'checked' : null, 'aria-label': 'Watchlist only' }),
      'Watchlist only (' + DATA.watchlist_size + ')'
    );
    wl.querySelector('input').addEventListener('change', function (e) { state.watchlist = e.target.checked; writeHash(); render(); });
    var sortSel = el('select', { id: 'sort', 'aria-label': 'Sort by' },
      ['implied', 'tvl', 'growth', 'age', 'name'].map(function (k) {
        return el('option', { value: k, text: 'Sort: ' + ({ implied: 'implied value', tvl: 'TVL', growth: '7d change', age: 'age', name: 'name' })[k], selected: k === state.sort ? 'selected' : null });
      })
    );
    sortSel.addEventListener('change', function () { state.sort = sortSel.value; state.dir = state.sort === 'name' ? 1 : -1; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'pre-token'; state.selected = null; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token (' + DATA.live_size + ')', onclick: function () { state.tab = 'live'; state.selected = null; writeHash(); render(); } });
    var shown = state.tab === 'pre-token' ? filteredRows().length + ' of ' + DATA.board_size + ' rows shown' : DATA.live_size + ' live-token protocols';
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

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { setSort(key); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function nameCell(r) {
    var badge = WATCHLIST.has(r.slug) ? el('span', { class: 'badge', title: 'On the 40-protocol watchlist', text: 'WATCHLIST' }) : null;
    return el('td', null, el('div', { class: 'name' },
      el('span', null, el('b', { text: r.name }), badge),
      el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') : 'an unnamed chain') })
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
    var max = DATA.rows[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        nameCell(r),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: fmtMult(r.base_multiple) }),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown, live comparables and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Category multiple' }),
            el('th', { scope: 'col', text: 'Token' })
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
      tbody.appendChild(el('tr', { onclick: function () {} },
        el('td', null, el('span', { class: 'status', text: 'live' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(mult) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Live token: these ' + DATA.live_size + ' protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their mcap/TVL ratios are the raw material the category multiples are medians of.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'mcap / TVL' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  // --- Methodology: the whole model, in the page, in words a reader can check ---
  function methodology() {
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How the ranking works — model ' + DATA.model_version }),
      el('div', { class: 'formula' }, 'implied = round( TVL x category_multiple x (1 + clamp(change_7d, ' + M.growth_floor + ', ' + M.growth_cap + ') / 100 x ' + M.growth_weight + ') x (' + M.maturity_floor + ' + min(age_days, ' + M.maturity_days + ') / ' + M.maturity_days + ' x ' + M.maturity_range + ') )'),
      el('ul', null,
        el('li', { html: '<b>Category multiple.</b> The median mcap/TVL of the protocol\u2019s own category\u2019s live-token peers in this snapshot (a peer has mcap &gt; 0 and TVL &gt; 0 and is not a CEX — exchange tokens are priced on exchange cash flows, not protocol TVL). Categories with fewer than ' + M.min_category_peers + ' live peers fall back to the global median ' + M.global_multiple.toFixed(4) + 'x (n = 119 live peers). Multiples are clamped to [' + M.multiple_floor + ', ' + M.multiple_cap + ']. The median is used because a few live tokens trade at absurd multiples (one prediction-market token at ~400x TVL); the mean would let outliers price a whole category.' }),
        el('li', { html: '<b>Growth.</b> The 7-day TVL change, clamped to [' + M.growth_floor + ', ' + M.growth_cap + ']%, weighted ' + M.growth_weight + ': a protocol growing fast is worth more per dollar of TVL, but one week cannot double a valuation.' }),
        el('li', { html: '<b>Maturity.</b> 0.6 + min(age, ' + M.maturity_days + ') / ' + M.maturity_days + ' x 0.4, where age is days from first listing to ' + DATA.as_of + '; an unknown listing date counts as ' + M.unknown_age_days + ' days. A protocol that has run for years with no token is a more credible launch candidate than one listed last month.' }),
        el('li', { html: '<b>Exclusions.</b> A row is out when its category is Bridge, Canonical Bridge, Cross Chain Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX; when its name contains the whole word wrapped, staked or staking; when its name starts with an exchange name; or when its name ends in a version marker. A bridge moves a token that already trades; a liquid-staking or restaking product is a receipt for a token that already trades. The same rule scores every row — no name is special-cased — and all 40 watchlist protocols pass it. It cut the board from 289 rankable rows to ' + DATA.board_size + '.' }),
        el('li', { html: '<b>Limits.</b> The snapshot is frozen at ' + DATA.as_of + ' (758 protocols, TVL \u2265 $5M); nothing after that date is in the ranking. It carries no parentProtocol field, so a wrapped product whose category and name do not betray it cannot be caught by the exclusion rule. Protocols the snapshot records as pre-token are ranked as recorded — including USDD, which the snapshot lists with no market cap, CoinGecko id or symbol. Implied value is this entry\u2019s claim from the frozen snapshot, not a prediction that a token will launch, or at what price. Farm plans are instructions for using a protocol, never a claim that it runs a points program: the snapshot carries no airdrop flag.' })
      )
    );
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    render();
  }
  function closeDetail() {
    state.selected = null;
    writeHash();
    render();
  }

  function detailView(row) {
    var c = recompute(row);
    var comps = comparables(row);
    var steps = farmSteps(row);
    var match = c.implied === row.implied_value_usd;
    var tvlTimesMult = row.tvl_usd * row.base_multiple;
    var badge = WATCHLIST.has(row.slug) ? el('span', { class: 'badge', text: 'WATCHLIST' }) : el('span', { class: 'badge', text: 'EARLY' });
    var compBody;
    if (comps.length > 0) {
      var rows = comps.map(function (r) {
        return el('tr', null,
          el('td', null, el('b', { text: r.name })),
          el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
          el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
          el('td', { class: 'num', text: fmtMult(r.mcap_usd / r.tvl_usd) })
        );
      });
      compBody = el('div', { class: 'table-wrap' },
        el('table', { class: 'compact' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Live peer' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'mcap / TVL' }))),
          el('tbody', null, rows)
        )
      );
    } else {
      compBody = el('p', { class: 'sub', text: 'None of the ' + DATA.live_size + ' live-token protocols shown here are in ' + (row.category || 'this category') + ' — the multiple still comes from the full snapshot (see the note below), not from this table.' });
    }
    return el('div', null,
      el('a', { class: 'back', href: '#', text: '\u2190 Back to the board', onclick: function (e) { e.preventDefault(); closeDetail(); } }),
      el('div', { class: 'detail-head' },
        el('div', null,
          el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + '  ·  ' + (row.category || 'Other') }),
          el('h1', null, row.name, ' ', badge),
          el('p', { class: 'sub', text: 'Chains: ' + ((row.chains && row.chains.length) ? row.chains.join(', ') : 'not listed') + '  ·  Listed ' + (row.listed_at || 'unknown') + '  ·  Age ' + fmtAge(row.age_days) + ' with no token on record' })
        ),
        el('div', null, el('span', { class: 'brand-name', text: 'Implied value' }), el('div', { class: 'num', html: '<b style="font-size:26px">' + fmtUsdFull(row.implied_value_usd) + '</b>' }))
      ),
      el('div', { class: 'detail-grid' },
        el('div', { class: 'detail-col' },
          el('section', { class: 'card' },
            el('h2', { text: 'Model breakdown — model ' + DATA.model_version }),
            el('div', { class: 'formula' }, 'implied = TVL x multiple x growth x maturity'),
            el('div', { class: 'kv' },
              el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsdFull(row.tvl_usd) })),
              el('div', null, el('span', { text: 'Category multiple (' + (row.category || 'Other') + ')' }), el('b', { text: fmtMult(row.base_multiple) })),
              el('div', null, el('span', { text: 'TVL x multiple' }), el('b', { text: fmtUsdFull(Math.round(tvlTimesMult)) })),
              el('div', null, el('span', { text: '7-day change (clamped)' }), el('b', { text: fmtPct(c.growthPct) })),
              el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { text: c.growthMult.toFixed(4) + 'x' })),
              el('div', null, el('span', { text: 'Age' }), el('b', { text: (row.age_days === null ? 'unknown (' + M.unknown_age_days + 'd used)' : row.age_days + ' days') })),
              el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { text: c.maturityMult.toFixed(4) + 'x' })),
              el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsdFull(row.implied_value_usd) }))
            ),
            el('p', { class: 'check-line', html: 'This page recomputes the row from its own figures: <b>' + fmtUsdFull(c.implied) + '</b>' + (match ? ' — the same number board.json carries.' : ' — which DIFFERS from board.json: the data would be stale.') })
          ),
          el('section', { class: 'card' },
            el('h2', { text: 'Live comparables — ' + (row.category || 'Other') }),
            compBody,
            el('p', { class: 'check-line', text: multipleNote(row) })
          )
        ),
        el('div', { class: 'detail-col' },
          el('section', { class: 'card' },
            el('h2', { text: 'Farm plan — 6 steps' }),
            el('ol', { class: 'steps' }, steps.map(function (s) {
              var at = s.indexOf(' Cost: ');
              var action = at >= 0 ? s.slice(0, at) : s;
              var tail = at >= 0 ? s.slice(at + 1) : '';
              return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
            })),
            el('p', { class: 'check-line', text: 'The plan is derived from this protocol\u2019s category, chains, TVL and age. It is instructions for using the protocol, not a claim that it runs a points program.' })
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
    if (state.selected) {
      var row = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
      if (row) {
        shell.appendChild(detailView(row));
        shell.appendChild(methodology());
        app.appendChild(shell);
        app.setAttribute('aria-busy', 'false');
        return;
      }
      state.selected = null;
    }
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    shell.appendChild(methodology());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () { readHash(); render(); });
})();
