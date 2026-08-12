# Capital Flow — Product DNA

> **Snapshot, not living truth.** Written 2026-08-04 as a one-time product/business
> reference for whoever (human or AI) picks up work on this project next. It captures
> _what the product is and why_, not implementation detail (see [README.md](../README.md)
> for tech stack, project structure, env vars) and not anything that changes on its own
> schedule (exact prices, vendor account status, current metrics) — those live in the
> code and the actual dashboards, not in a markdown file that will silently go stale.
> If something below contradicts the live code, the code is right.

## What this is, in one line

A real-time stock volume scanner for swing traders: it finds stocks trading on unusually
high volume — the kind of move that often means real money (institutions, not retail
noise) is quietly building a position before the price itself reacts — and hands the
trader that information before it's obvious to everyone else.

## The problem it solves

Retail traders normally notice a stock _after_ it's already moved — a headline, a trending
ticker, a friend's tip. By the time they see it, the early move is over. Unusual volume
is one of the few signals that shows up _before_ the price catches up, but scanning the
whole market for it by hand is impractical. Capital Flow automates that scan and
surfaces the handful of tickers actually worth a trader's attention, continuously,
without them having to watch the market all day.

## The product, feature by feature

**Capital Flow (the main scanner)** — the core feature and the app's namesake. Scans a
configurable universe (S&P 500 / NASDAQ 100 / by sector / everything) for stocks trading
at some multiple of their average volume, with filters (min ratio, market cap, price,
volume). Every result carries price, volume ratio, RVOL (time-of-day-adjusted volume
pace), a 7-day sparkline, float/short-interest, and a link into a chart, live news, and
a historical-spike comparison ("has this stock spiked like this before, and what
happened after").

**MA Scanner** — finds stocks trading near a chosen moving average (SMA 9/20/50/150,
daily or weekly), for traders whose setup is technical-level-based rather than
volume-based.

**Hot Sectors (money flow)** — a sector-by-sector heatmap across 15 sector ETFs, showing
where money is rotating into or out of at a macro level, independent of any single stock.

**Watchlist** — users star tickers to track them, with live quotes. On top of that sits
the alerting system: a per-ticker **volume alert** (fires when RVOL crosses a threshold)
or **price alert** (fires when price crosses a target, in either direction) — one-shot,
re-armed manually, available from the Watchlist, the main scanner, and the MA Scanner
alike so a user never has to leave whatever screen they're on to set one.

**Capi** — an AI assistant (Elite feature) that explains what a scan result means, in
plain language, with memory of the conversation. Deliberately scoped to _explaining_
data the app already shows, never to giving investment advice or account-specific
answers it isn't actually wired up to know.

**Notifications** — push notifications and a daily scheduled-scan digest (Elite features,
also available during the seven-day Free trial) so a trader doesn't have to have the app
open to know something moved.

**Admin panel** — a single operator's control surface: user list, tier/pilot management,
audit log, backup status/trigger, push test, activity stats. Built for one person running
the business, not a multi-admin team tool.

## The tier model (structure, not current prices)

Three tiers, structured around a simple idea: **let people feel the full product before
asking them to pay for it.**

- **Free** — the complete Elite experience for a 7-day trial from signup, then the
  account is locked until it upgrades. This is deliberate: the free tier isn't a
  permanently-crippled demo, it's a full trial with a clock on it.
- **Premium** — unlimited-_feeling_ scanning (a generous shared daily pool across every
  scan type) plus the core analysis features (advanced filters, charts, float/short
  data), but no notifications, no Capi, no scheduled scans.
- **Elite** — everything, unlimited, forever: unlimited scans, push notifications,
  scheduled daily scans, custom watchlist alerts, and Capi.

Both paid tiers are **one-time purchases**, not subscriptions — pay once, keep it. Exact
current prices live in `src/constants/tierFeatures.js` and change independently of this
document; don't hardcode them anywhere that isn't that one file.

## Where the product stands right now (2026-08-04 snapshot)

This snapshot follows a full pre-launch audit pass: security (auth/IDOR/rate-limiting/
webhook integrity), scale/reliability (timeouts, background-scan watchdog, crash
recovery, real backups with a tested restore path, actual downtime alerting), and
correctness (payment/coupon races, price-alert accuracy, DST-safe market-hours math).
Every finding from that pass has a corresponding fix and a regression test in the repo.
Monitoring (Sentry, PostHog) and uptime (paid Render instance, no more cold-starts) are
implemented/configured, but their live dashboards and external account settings must be
verified in the deployment environment. The product is in a genuinely
launch-ready state as of this date — "as of this date" being the operative phrase, since
that's exactly the kind of fact this file can't promise stays true forever.

The one deliberately-deferred piece from that pass: a short-TTL cache on the live
Finnhub price lookup inside the scanner's enrichment phase was identified as a possible
further reduction in external API calls, and explicitly **not** implemented — it's the
one field in a scan result promised to always be maximally fresh, and the tradeoff
wasn't judged worth it. Revisit only if Finnhub rate-limiting becomes a real, observed
problem, not preemptively.

## How to keep this file useful

Don't add anything here that a script could compute from the live code or a dashboard
instead — that's exactly the class of content that quietly rots and then misleads the
next reader. When the _product itself_ meaningfully changes (a new core feature, a tier
restructuring, a pivot in who this is for), update the relevant section above. When only
a number changes (a price, a vendor's plan, a metric), don't — point at where that
number actually lives instead.
