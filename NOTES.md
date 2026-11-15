# Token Radar — build notes (koordinator)

Lomba: token-radar-01, deadline 14 Des 2026 17:00 WIB. Hadiah $1.325 total —
**1st $1.000, 2nd–5th $50, 6th–10th $25** (winner-take-most: target #1).
Submit: maks 5/hari, 10 total, Force_Last. Juri AI pairwise atas dossier
(screenshots + source dashboard ≤65.536 byte). Screen: garis final di
peringkat 40 ladder dev; entri tanpa rating masuk di garis itu.

## Kit
- Kit: /tmp/kit-tr/token-radar-01-kit/ — terverifikasi 20/20 file OK.
  Tarball: /tmp/kit-tr.tgz (cadangan). Manifest: /tmp/kit-test.bin.
- Snapshot: 758 protokol (TVL ≥ $5 jt), as_of 2026-11-14, floor $50 jt.
  Watchlist: 40 protokol. Pre-token rankable total: 289 (40 watchlist + 249
  di bawah floor). Live-token (mcap tercatat): 144, median mcap/TVL global
  0,241 (n=120, tanpa CEX).
- Starter (radar-1): implied = TVL × 0,25 × growth × maturity. Flat 0,25
  itu praktis = median global — kelemahan utamanya.

## Model v2 (radar-2) — keunggulan vs starter
- Base multiple PER KATEGORI: median mcap/TVL protokol live-token di
  kategori yang sama (tanpa CEX, mcap>0, TVL>0). Kategori dengan <3 peer
  live → fallback median global. Clamp multiple ke [0,05, 1,50].
  Angka TERKOREKSI (Fase A, aturan peer ketat mcap>0): global 0,2460
  (n=119); Dexs 0,3424; Lending 0,1324; Liquid Staking 0,0406→clamp 0,05;
  RWA 0,2748; Basis Trading 0,6544; Cross Chain Bridge 1,2205; Yield
  0,1914; Bridge 0,5567; Yield Aggregator 0,1510; CDP 0,1687;
  Indexes 0,1477; Canonical Bridge 0,7464; Privacy 0,9691.
  Semua dari snapshot — tidak ada angka karangan.
- Growth & maturity dipertahankan dari starter (clamp change_7d [-60,120],
  bobot 0,5; maturity 0,6 + min(age,1095)/1095×0,4; age tak diketahui 365).
- implied = round(TVL × catMultiple × growthMult × maturityMult), min 1.
- Board: SEMUA 289 protokol pre-token rankable (watchlist + early),
  rank 1..289 by implied desc. Tiap baris: model {base_multiple (= multiple
  kategori), growth_pct, growth_multiplier, maturity_multiplier, age_days,
  category_peers} + 6 farm step (diperkaya per kategori, 20–600 karakter).
- Live view: 24 protokol live-token by mcap (nilai pasar, bukan model).

## Gate (tujuh baris, semua harus lolos)
- dashboard/ ≤400 file, ≤4 MiB, tanpa alamat network; index.html + ≥1 .css + ≥1 .js.
- board.json 100–4000 baris, ≤8 MiB; rank 1..N unik, implied tak naik
  seiring rank, watchlist ter-cover penuh, implied ≤1e14.
- farm_steps 3–12 string @ 20–600 karakter per baris.
- 3–4 screenshot, masing-masing ≤512 KiB, sisi panjang ≤1440, sisi pendek
  ≥800. Target 300–350 KiB per shot, ukuran 1440×900 PNG.
- dossier.json = buildDossier (vendor byte-for-byte); dossier ≤1,5 MiB,
  teks ≤65.536 byte → **source dashboard total target ≤60 KiB** agar juri
  membaca semuanya (data.js TIDAK masuk dossier — hanya dashboard/).
- Juri hanya membaca dossier: screenshot + source dashboard. Jadi
  metodologi harus tertulis DI DALAM halaman (dan tampil di screenshot),
  bukan cuma di board.json.

## Temuan Fase A (15 Nov 2026, builder selesai — SEMUA gate lolos)
- Board 289 baris, deterministik 2× run byte-identik (board.json sha256
  28dac3f2…), boardIssue null, 19/19 gate lokal PASS. dossier 705.011 B,
  teks dossier 29.807 B dari cap 65.536 B. board.json 409.750 B.
- ⚠️ CACAT KREDIBILITAS: top 10 didominasi produk wrapped/bridged/staked
  (rank 1 Coinbase Bridge, 2 WBTC, 3 Binance Bitcoin, 4 USDT0, 5 Base
  Bridge, 6 CCIP, 10 Binance staked ETH) — ini BUKAN kandidat peluncuran
  token; brief lomba sendiri menegaskan produk wrapped/staked dari token
  yang sudah diperdagangkan bukan token yang belum lahir. Penyebab:
  isRankable starter hanya mengecualikan CEX + version marker.
- KEPUTUSAN: terapkan pengecualian ala watchlist ke SEMUA baris board
  (kategori Bridge/Canonical Bridge/Liquid Staking/Liquid Restaking/
  Restaked BTC/CEX; nama mengandung kata wrapped/staked/staking; nama
  diawali nama exchange). parentProtocol tak ada di snapshot → tak bisa
  dicek, dokumentasikan batasan itu. Ukur dulu sisa baris: bila <100,
  STOP dan lapor (gate butuh ≥100). Watchlist 40/40 sudah lolos filter
  ini menurut definisinya.
- Catatan Fase B: app.js starter menghitung ulang implied dengan flat
  base_multiple — dashboard baru WAJIB pakai base_multiple per baris
  dari data.js.

## Fase A-fix (SELESAI 15 Nov 2026)
- Board 289 → **198 baris** (40 watchlist + 158 early; 91 terbuang: 86
  kategori, 5 kata di nama, 0 prefix exchange). Watchlist 40/40 utuh.
  Ketujuh nama cacat sudah hilang dari board. Top 10 baru kredibel:
  1 Steakhouse Financial $534,9 jt; 2 Sentora Curator $513,9 jt;
  3 Gauntlet $318,6 jt; 4 Veda $306,3 jt; 5 USDD $144,6 jt;
  6 BitFi Basis $111,2 jt; 7 Upshift $109,9 jt; 8 Polymarket
  International $78,3 jt; 9 Bittensor dTAO $77,3 jt; 10 Nonce Capital
  $74,1 jt. 7 dari 10 adalah baris watchlist. board.json baru sha256
  8fa42075…, 15/15 gate PASS, deterministik 2× (outA/outB).
- KEPUTUSAN lanjutan: (1) Tambah 'Cross Chain Bridge' ke daftar
  eksklusi — Circle Gateway (rank 15) lolos hanya karena ejaan
  kategorinya; ini produk bridge menurut brief, dan tak ada baris
  watchlist di kategori itu (board → ~197). Dikerjakan di awal Fase B.
  (2) USDD (rank 5) DIBIARKAN — snapshot mencatatnya pre-token
  (mcap/gecko/symbol null); mengecualikan by-name = special-casing
  (dilarang prinsip model starter) dan datanya memang begitu;
  dokumentasikan sebagai keterbatasan snapshot di metodologi.
  (3) 'Staking Pool', 'Restaking', 'Stablecoin Wrapper' dibiarkan —
  watchlist sendiri berisi baris di kategori itu, jadi sah menurut
  definisi watchlist.

## Rencana
- Fase A (SELESAI): model v2 + main.ts + board.json + dossier.json, uji
  deterministik 2× run byte-identik, verifikasi gate lokal.
- Fase A-fix (SELESAI): eksklusi wrapped/staked/bridged + verifikasi ulang.
- Fase B (SELESAI 15 Nov 2026): (0) tambah 'Cross Chain Bridge' ke eksklusi +
  verifikasi ulang board (198 → 197, top 10 tak berubah, watchlist 40/40,
  deterministik 2×); (1) redesign dashboard (46.317 B source — index.html 628 B,
  app.css 9.309 B, app.js 36.380 B — dossier teks 46.581 B dari cap 65.536 B,
  ketiga file source utuh di dossier tanpa "[Cut at"); (2) 3 screenshot asli
  1440×900 dari dashboard final via headless Chromium + CDP (CLI --screenshot
  build ini diam — lihat catatan); (3) verifikasi gate akhir: semua PASS.
  Dua bug ketemu & diperbaiki saat pengujian: hash-state tidak me-reset state
  (detail menempel saat pindah ke #wl=1) dan selector CSS `.field input`
  membuat checkbox watchlist melebar. Farm plan detail view cocok 6/6 dengan
  board.json untuk rank 1, 5 (USDD/CDP) dan 9 (Bittensor dTAO/Dexs); recompute
  in-page cocok dengan board.json; multiple per baris tampil benar
  (CDP 0,1687x, Dexs 0,3424x) — bug flat 0,25 starter hilang.
  Catatan render: /opt/meta-chromium/chrome butuh switch policy WebGL
  `--hatch-webgl-allowed-domains-file=/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt`
  + `--hatch-webgl-allowed-domains-sha256=<sha256 file>`; --dump-dom/--screenshot
  CLI tidak menghasilkan output di build ini, jadi screenshot diambil lewat CDP
  (remote-debugging-port 9222 + WebSocket Node 22, skrip /tmp/shot.mjs —
  TIDAK di repo, hanya alat bantu).
- Fase C: repo GitHub publik baru (BUTUH parent via browser — login GitHub
  Secure Vault; koordinator TIDAK bisa push sendiri), kit check 12/0,
  bundle transkrip dari sesi builder, submit v1 awal.
- Fase D: iterasi jujur vs pesaing; submit ulang hanya seizin parent.

## Backlog iterasi v2 (SETELAH submit v1 — jangan tunda v1 untuk ini)
- (a) Screenshot ke-4 (maks 4) berisi seksi metodologi penuh — screenshot
  board hanya ~5,5 baris dan metodologi di bawah lipatan. Dossier saat ini
  798.723 B; tambah ~175 KiB masih ≤1,5 MiB.
- (b) Bawa peer list per kategori ke data.js agar detail view menampilkan
  baris komparabel live (saat ini kategori seperti Risk Curators hanya
  catatan provenance karena live view dibatasi 24 baris).
- Sesi untuk bundle transkrip (semua ada di ~/agents/agent-<id>/sessions/):
  Fase A 33fb83b6-a1cc-4446-b088-08f6ed75c805; fix dd86f70e-81fa-4a04-
  baca-01debf35eb2e; Fase B f6b02fad-31d8-42a5-88cb-e131ca150fd1;
  koordinator 9a542425-800e-4bc3-8cac-dc0516145c28.
- STATUS 15 Nov 2026: build lokal SIAP submit v1 (board final 197 baris,
  sha256 2dc24e8e…; dossier 798.723 B). Fase C menunggu parent: buat repo
  GitHub publik + push. Bersihkan out1/out2 (output Fase A, 289 baris,
  usang) sebelum/saat pembuatan repo agar tidak membingungkan.

## Aturan
- Jangan tampilkan isi agent-keypair.json, API key, atau signature.
- Jangan sentuh repo BTC/puisi; jangan submit ulang entri lama.
- Login make.fun @andestan s.d. 15 Des 2026; delegasi payout CbL1...MPwj1
  s.d. 13 Feb 2027 (Competitions: *) — submit lomba ini tanpa Phantom baru.
