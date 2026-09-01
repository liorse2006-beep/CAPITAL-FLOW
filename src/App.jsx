import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import Toast from './components/shared/Toast';
import useSSE from './hooks/useSSE';
import useScanQuota from './hooks/useScanQuota';
import usePushSubscription from './hooks/usePushSubscription';
import useIsMobile from './hooks/useIsMobile';
import { parseVolInput, formatPrice } from './utils/format';
import { categoryQuota } from './utils/quota';
import { hasEliteAccess, hasPremiumFeatureAccess } from './utils/access';
import { useAuth } from './context/AuthContext';
import { track } from './analytics';
import PushPermissionPrompt from './components/shared/PushPermissionPrompt';
import InstallPrompt from './components/shared/InstallPrompt';
import UpgradeModal from './components/shared/UpgradeModal';
import TrialEndedModal from './components/shared/TrialEndedModal';
import PilotGate from './components/shared/PilotGate';
import AlertThresholdModal from './components/shared/AlertThresholdModal';
import Topbar from './components/shared/Topbar';
import WatchlistPage from './components/Watchlist/WatchlistPage';
import ScannerPage from './components/Scanner/ScannerPage';

/* Code-split: none of these are needed for the very first paint (the default
   "scanner" tab). Splitting them into their own chunks means a user who
   never opens Hot Sectors, MA Scanner, a chart, the policy page, or the
   auth modal never pays to download that code at all. */
const MoneyFlow = lazy(() => import('./components/MoneyFlow/MoneyFlow'));
const ChartModal = lazy(() => import('./components/Chart/ChartModal'));
const MAScannerPage = lazy(() => import('./components/MAScanner/MAScannerPage'));
const FundamentalsPage = lazy(() => import('./components/Fundamentals/FundamentalsPage'));
const PolicyPage = lazy(() => import('./pages/PolicyPage'));
const AccessibilityStatementPage = lazy(() => import('./pages/AccessibilityStatementPage'));
const AuthModal = lazy(() => import('./components/Auth/AuthModal'));
const ChatWidget = lazy(() => import('./components/shared/ChatWidget'));
const WelcomeTierModal = lazy(() => import('./components/shared/WelcomeTierModal'));
const ScheduledScanResultsModal = lazy(() => import('./components/shared/ScheduledScanResultsModal'));
const LandingPage = lazy(() => import('./pages/LandingPage?landing-preview-v2'));

/* ── Main App ── */
function App() {
  const {
    user,
    logout,
    login,
    getToken,
    authError,
    clearAuthError,
    pendingGoogleToken,
    acceptPilotTerms,
    refreshUser,
  } = useAuth();
  const storageScope = user ? String(user.id) : 'guest';
  function scopedStorageKey(name) {
    return name + ':' + storageScope;
  }
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authInitialScreen, setAuthInitialScreen] = useState('login');

  function openAuthModal(screen) {
    setAuthInitialScreen(screen === 'signup' ? 'signup' : 'login');
    setShowAuthModal(true);
  }

  const navigate = useNavigate();
  const landingGetStarted = useCallback(() => navigate('/scanner'), [navigate]);
  const location = useLocation();
  const isMobile = useIsMobile();
  // Derived from the URL rather than its own state — keeps every existing
  // `page === 'x'` / `setPage('x')` call site unchanged while making page
  // navigation a real, bookmarkable, back/forward-able browser route.
  const page = location.pathname === '/' ? 'scanner' : location.pathname.slice(1).split('/')[0];
  function setPage(p) {
    navigate(p === 'scanner' ? '/' : '/' + p);
  }

  // Profile has one scheduling action, but the product already owns a real
  // scheduler beside each scanner. Navigate to the relevant scanner and ask
  // its mounted ScheduleScan component to open its existing modal.
  const [profileScheduleRequest, setProfileScheduleRequest] = useState(null);
  function openSchedulingFromProfile() {
    const target = page === 'ma' ? 'ma' : page === 'flow' ? 'flow' : 'scanner';
    const scanType = target === 'ma' ? 'maScanner' : target === 'flow' ? 'sectorMoving' : 'capitalFlow';
    setProfileScheduleRequest({ target, scanType, id: Date.now() });
    if (page !== target) setPage(target);
  }

  useEffect(() => {
    if (!profileScheduleRequest || page !== profileScheduleRequest.target) return undefined;
    const timer = window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('capital-flow:open-schedule', { detail: { scanType: profileScheduleRequest.scanType } })
      );
      setProfileScheduleRequest(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [page, profileScheduleRequest]);

  // Manual pageview tracking — capture_pageview is off in src/analytics.js
  // specifically so this is the one place it happens, on every route change.
  useEffect(
    function () {
      track('$pageview', { path: location.pathname });
    },
    [location.pathname]
  );
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState(null);
  const [liveResults, setLiveResults] = useState([]);
  const [selectedSectors, setSelectedSectors] = useState([]);
  const [scanMode, setScanMode] = useState(null);
  var MAX_FREE_SECTORS = 2;
  var MAX_PREMIUM_SECTORS = 5;
  /* Per-tier cap on how many sectors can be scanned in one "By Sector" run —
     Free: 2, Premium: 5, Elite: unlimited. Computed as a function (not a
     plain var) because isElite/isPremium aren't assigned yet at this point
     in the render — called only after they're set, same pattern the rest of
     this component already relies on for closures like toggleSector. */
  function sectorLimit() {
    return eliteAccess ? Infinity : isPremium ? MAX_PREMIUM_SECTORS : MAX_FREE_SECTORS;
  }
  function toggleSector(s) {
    setSelectedSectors(function (prev) {
      if (prev.indexOf(s) >= 0)
        return prev.filter(function (x) {
          return x !== s;
        });
      var limit = sectorLimit();
      if (prev.length >= limit) {
        showToast(
          isPremium
            ? 'Premium lets you scan up to ' +
                MAX_PREMIUM_SECTORS +
                ' sectors at once — upgrade to Elite for unlimited.'
            : 'Free lets you scan up to ' + MAX_FREE_SECTORS + ' sectors at once — upgrade for more.'
        );
        return prev;
      }
      return prev.concat([s]);
    });
  }
  const [scanTime, setScanTime] = useState(null);
  const [scanDataStatus, setScanDataStatus] = useState(null);
  const [scanDataAsOf, setScanDataAsOf] = useState(null);
  const [marketClosed, setMarketClosed] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cacheAge, setCacheAge] = useState(0);
  // True only while the results on screen are the previous session's last
  // scan, auto-restored on load — never after a scan the customer actually
  // ran just now. Without this flag a plain page refresh silently repopulates
  // the table with old data and nothing on screen explains why.
  const [restoredFromLastScan, setRestoredFromLastScan] = useState(false);
  const [sortField, setSortField] = useState('volumeRatio');
  const [sortDir, setSortDir] = useState('desc');
  const [minRatio, setMinRatio] = useState('1.5');
  const [minCap, setMinCap] = useState('1');
  const [search] = useState('');
  const [sectorFilter] = useState('All');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [error, setError] = useState(null);
  const poll = useRef(null);

  // A scan can outlive the route that started it. Always tear down the
  // progress poll when the app unmounts or a new scan starts so stale requests
  // cannot keep updating an abandoned screen.
  useEffect(function () {
    return function () {
      if (poll.current) {
        clearInterval(poll.current);
        poll.current = null;
      }
    };
  }, []);

  /* ── Chart modal state ── */
  const [chartOpen, setChartOpen] = useState(false);
  const [chartSymbol, setChartSym] = useState('');
  const [chartName, setChartName] = useState('');

  function openChart(symbol, name) {
    setChartSym(symbol);
    setChartName(name || symbol);
    setChartOpen(true);
  }

  function closeChart() {
    setChartOpen(false);
  }

  /* ── SSE — real-time background scan updates ── */
  const [liveAlert, setLiveAlert] = useState(null);
  const [radarEvent, setRadarEvent] = useState(null);

  // EventSource cannot send Authorization headers. Exchange the normal bearer
  // token for a short-lived opaque ticket instead of putting the user's JWT in
  // the stream URL. Refresh before expiry so browser reconnects keep working.
  const [sseTicket, setSseTicket] = useState(null);
  useEffect(() => {
    let cancelled = false;
    let refreshTimer;
    if (!eliteAccess) {
      return undefined;
    }
    const fetchTicket = () => {
      fetch('/api/stream-ticket', { headers: { Authorization: 'Bearer ' + (getToken() || '') } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (cancelled || !d?.ticket) return;
          setSseTicket(d.ticket);
          refreshTimer = setTimeout(fetchTicket, Math.max(60_000, (d.expiresIn - 120) * 1000));
        })
        .catch(() => {
          if (!cancelled) refreshTimer = setTimeout(fetchTicket, 30_000);
        });
    };
    fetchTicket();
    return () => {
      cancelled = true;
      clearTimeout(refreshTimer);
    };
  }, [eliteAccess, getToken]);
  useSSE(
    sseTicket ? '/api/stream?ticket=' + encodeURIComponent(sseTicket) : null,
    {
      connected: () => {},
      ping: () => {},
      'auth-error': () => {},
      'scan-update': (d) => {
        if (!Array.isArray(d.results)) return;

        // The background worker scans the default floor universe. Show its
        // fresh, complete snapshot only while the scanner is idle and still
        // on its untouched defaults; never overwrite a user's in-progress or
        // custom-filtered scan with a differently filtered dataset.
        const canHydrateDefaultScanner =
          page === 'scanner' &&
          !scanning &&
          results === null &&
          scanMode === null &&
          minRatio === '1.5' &&
          minCap === '1' &&
          !minPrice &&
          !maxPrice &&
          !minVol;
        if (canHydrateDefaultScanner) {
          setResults(d.results);
          setScanTime(d.scanTime || null);
          setScanDataStatus(d.dataStatus || null);
          setScanDataAsOf(d.dataAsOf || d.scanTime || null);
          setFromCache(true);
          setCacheAge(0);
          setRestoredFromLastScan(false);
        }
      },
      alert: (d) => {
        addAlertToHistory(d.symbol, d.title, d.body);
        setLiveAlert(d);
        setTimeout(() => setLiveAlert(null), 6000);
        // Server already cancelled the underlying threshold (one-shot alert)
        // — mirror that locally so the bell/badge stops showing it as armed
        // without waiting for a refetch.
        clearAlertLevelLocal(d.symbol);
      },
      'radar-event': (d) => {
        addAlertToHistory(d.symbol, d.title, d.body);
        setRadarEvent(d);
        setLiveAlert(d);
        setTimeout(() => setLiveAlert(null), 6000);
      },
    },
    eliteAccess
  );

  /* ── Notification state ── */
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [showAlertPanel, setShowAlertPanel] = useState(false);
  const [alertHistory, setAlertHistory] = useState(function () {
    try {
      return JSON.parse(localStorage.getItem(scopedStorageKey('vs-alert-history'))) || [];
    } catch (e) {
      return [];
    }
  });
  const [unreadCount, setUnreadCount] = useState(function () {
    try {
      return parseInt(localStorage.getItem(scopedStorageKey('vs-alert-unread')) || '0', 10);
    } catch (e) {
      return 0;
    }
  });
  const prevResults = useRef(null);
  const notifPoll = useRef(null);

  function addAlertToHistory(sym, title, body) {
    var entry = { id: Date.now() + Math.random(), sym: sym, title: title, body: body, time: new Date().toISOString() };
    setAlertHistory(function (prev) {
      var next = [entry].concat(prev).slice(0, 100);
      localStorage.setItem(scopedStorageKey('vs-alert-history'), JSON.stringify(next));
      return next;
    });
    setUnreadCount(function (c) {
      var next = c + 1;
      localStorage.setItem(scopedStorageKey('vs-alert-unread'), String(next));
      return next;
    });
  }

  function removeAlertFromHistory(id) {
    setAlertHistory(function (prev) {
      var next = prev.filter(function (a) {
        return a.id !== id;
      });
      localStorage.setItem(scopedStorageKey('vs-alert-history'), JSON.stringify(next));
      return next;
    });
    if (typeof id === 'string' && id.indexOf('srv-') === 0) {
      fetch('/api/notifications/' + id.slice(4), {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + getToken() },
      }).catch(function () {});
    }
  }

  function clearAllAlerts() {
    setAlertHistory([]);
    localStorage.removeItem(scopedStorageKey('vs-alert-history'));
    if (user) {
      fetch('/api/notifications', { method: 'DELETE', headers: { Authorization: 'Bearer ' + getToken() } }).catch(
        function () {}
      );
    }
  }

  // Catches alerts the user missed while the app was closed (computer off,
  // push dismissed before being read, etc) — the server persists every alert
  // it sends (see checkWatchlistAlerts/runDigestTick), this pulls that
  // history in on load and whenever the tab becomes visible again.
  function refreshServerNotifications() {
    if (!user) return;
    fetch('/api/notifications', { headers: { Authorization: 'Bearer ' + getToken() } })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (!d || !d.notifications) return;
        var serverEntries = d.notifications.map(function (n) {
          return {
            id: 'srv-' + n.id,
            sym: n.symbol || '',
            scanType: n.scan_type || null,
            title: n.title,
            body: n.body,
            time: new Date(n.created_at * 1000).toISOString(),
          };
        });
        setAlertHistory(function (prev) {
          var localOnly = prev.filter(function (a) {
            return typeof a.id !== 'string' || a.id.indexOf('srv-') !== 0;
          });
          // Drop server entries that duplicate something already added live
          // via SSE/local polling during this same session.
          var localKeys = new Set(
            localOnly.map(function (a) {
              return a.title + '|' + a.body;
            })
          );
          var freshServer = serverEntries.filter(function (a) {
            return !localKeys.has(a.title + '|' + a.body);
          });
          var merged = freshServer
            .concat(localOnly)
            .sort(function (a, b) {
              return new Date(b.time) - new Date(a.time);
            })
            .slice(0, 100);
          localStorage.setItem(scopedStorageKey('vs-alert-history'), JSON.stringify(merged));
          return merged;
        });
        setUnreadCount(function (c) {
          var next = Math.max(c, d.unreadCount || 0);
          localStorage.setItem(scopedStorageKey('vs-alert-unread'), String(next));
          return next;
        });
      })
      .catch(function () {});
  }

  useEffect(
    function () {
      if (!user) return;
      refreshServerNotifications();
      function onVisible() {
        if (document.visibilityState === 'visible') refreshServerNotifications();
      }
      document.addEventListener('visibilitychange', onVisible);
      return function () {
        document.removeEventListener('visibilitychange', onVisible);
      };
    },
    [user]
  );

  /* New filter state */
  const [minChange] = useState('');
  const [maxChange] = useState('');
  const [exchangeFilter] = useState('All');
  const [minVol, setMinVol] = useState('');

  /* ── Subscription tier — authoritative source is user.tier from the DB.
        Never read from localStorage; the server enforces this independently. ── */
  var isPremium = !!(user && user.is_premium);
  var userTier = user ? user.tier || 'free' : 'free';
  var isElite = userTier === 'elite';

  /* ── Shared scan quota (unlimited for 7 days on free tier, then blocked
        until upgrade; 5/24h on premium; unlimited on elite) ── */
  const { scanMeta, setScanMeta, refreshQuota } = useScanQuota();
  // Re-sync whenever the user switches tabs too, not just on first mount —
  // otherwise the topbar counter can go stale after spending a scan on a
  // different page (e.g. MA Scanner) without a full reload.
  useEffect(
    function () {
      refreshQuota();
    },
    [refreshQuota, page]
  );

  // The 7-day free trial grants the COMPLETE Elite feature set — Capi, push,
  // watchlist alerts, AND daily scheduled scans — to every account, free.
  // `user.elite_access` is the server's authoritative answer (Elite OR still
  // in-trial), available immediately from /me; the scanMeta fallback covers a
  // cached /me response that predates that field. `canNotify` is kept as an
  // alias since it's threaded through many call sites already.
  var eliteAccess = hasEliteAccess(user, scanMeta);
  var premiumFeatureAccess = hasPremiumFeatureAccess(user, scanMeta);
  var canNotify = eliteAccess;
  var trialEnded = !!(user && userTier === 'free' && scanMeta && scanMeta.free && !scanMeta.free.trialActive);

  /* ── Trial-ended popup — auto-shown once per site visit the first time a
        free-tier user's scanMeta confirms the 7-day trial has ended, and
        again on demand every time a scan is attempted afterward (see
        onTrialEnded below, threaded into startScan / MoneyFlow /
        MAScannerPage). The ref guards against re-popping on every internal
        page navigation, which also calls refreshQuota(). ── */
  const [showTrialEndedModal, setShowTrialEndedModal] = useState(false);
  const trialEndedAutoShownRef = useRef(false);
  useEffect(
    function () {
      if (trialEndedAutoShownRef.current) return;
      if (!user || userTier !== 'free' || !scanMeta || !scanMeta.free) return;
      if (scanMeta.free.trialActive) return;
      trialEndedAutoShownRef.current = true;
      setShowTrialEndedModal(true);
    },
    [user, userTier, scanMeta]
  );
  function onTrialEnded() {
    setShowTrialEndedModal(true);
  }

  /* ── Scan Presets ── */
  const [presets, setPresets] = useState(function () {
    try {
      return JSON.parse(localStorage.getItem(scopedStorageKey('vs-presets'))) || [];
    } catch (e) {
      return [];
    }
  });
  const [presetName, setPresetName] = useState('');
  const [showPresetPanel, setShowPresetPanel] = useState(false);

  function savePreset() {
    if (!presetName.trim()) return;
    var preset = {
      name: presetName.trim(),
      minRatio: minRatio,
      minCap: minCap,
      minPrice: minPrice,
      maxPrice: maxPrice,
      minVol: minVol,
    };
    var updated = [].concat(presets, [preset]);
    setPresets(updated);
    localStorage.setItem(scopedStorageKey('vs-presets'), JSON.stringify(updated));
    setPresetName('');
    setShowPresetPanel(false);
  }

  function loadPreset(p) {
    setMinRatio(p.minRatio || '1.5');
    setMinCap(p.minCap || '1');
    setMinPrice(p.minPrice || '');
    setMaxPrice(p.maxPrice || '');
    setMinVol(p.minVol || '');
  }

  function deletePreset(idx) {
    var updated = presets.filter(function (_, i) {
      return i !== idx;
    });
    setPresets(updated);
    localStorage.setItem(scopedStorageKey('vs-presets'), JSON.stringify(updated));
  }

  /* ── Relative Volume Alert Levels — backed by the server so thresholds
     survive closing the tab and feed the push-notification pipeline.
     localStorage is kept only as an instant-paint cache. ── */
  const [alertLevels, setAlertLevels] = useState(function () {
    try {
      return JSON.parse(localStorage.getItem(scopedStorageKey('vs-alert-levels'))) || {};
    } catch (e) {
      return {};
    }
  });
  const alertFired = useRef({});

  // Auth state can change without unmounting App (login, logout, or account
  // switching). Rehydrate every browser cache when that happens so one
  // account's presets, thresholds, or unread alerts never flash in another
  // account's session.
  useEffect(
    function () {
      try {
        setPresets(JSON.parse(localStorage.getItem(scopedStorageKey('vs-presets'))) || []);
      } catch (e) {
        setPresets([]);
      }
      try {
        setAlertLevels(JSON.parse(localStorage.getItem(scopedStorageKey('vs-alert-levels'))) || {});
      } catch (e) {
        setAlertLevels({});
      }
      try {
        setAlertHistory(JSON.parse(localStorage.getItem(scopedStorageKey('vs-alert-history'))) || []);
      } catch (e) {
        setAlertHistory([]);
      }
      try {
        setUnreadCount(parseInt(localStorage.getItem(scopedStorageKey('vs-alert-unread')) || '0', 10));
      } catch (e) {
        setUnreadCount(0);
      }
      alertFired.current = {};
    },
    [storageScope]
  );

  useEffect(
    function () {
      if (!canNotify) return;
      fetch('/api/watchlist-alerts', { headers: { Authorization: 'Bearer ' + getToken() } })
        .then(function (r) {
          return r.ok ? r.json() : {};
        })
        .then(function (d) {
          setAlertLevels(d || {});
          localStorage.setItem(scopedStorageKey('vs-alert-levels'), JSON.stringify(d || {}));
        })
        .catch(function () {});
    },
    [canNotify]
  );

  // alertData is either { type: 'volume', minRatio } or
  // { type: 'price', targetPrice, referencePrice } — referencePrice is the
  // live price shown on screen when the alert was set, used server-side
  // only to record which side of targetPrice the stock started on.
  function setAlertLevel(symbol, alertData) {
    var updated = Object.assign({}, alertLevels);
    updated[symbol] = alertData;
    setAlertLevels(updated);
    localStorage.setItem(scopedStorageKey('vs-alert-levels'), JSON.stringify(updated));
    if (canNotify) {
      fetch('/api/watchlist-alerts/' + symbol, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
        body: JSON.stringify(alertData),
      }).catch(function () {});
    }
  }

  function removeAlertLevel(symbol) {
    clearAlertLevelLocal(symbol);
    if (canNotify) {
      fetch('/api/watchlist-alerts/' + symbol, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + getToken() },
      }).catch(function () {});
    }
  }

  // Local-only counterpart to removeAlertLevel — used when the server has
  // already cancelled the threshold itself (a fired one-shot alert), so
  // there's nothing to DELETE remotely, just local state to catch up.
  function clearAlertLevelLocal(symbol) {
    setAlertLevels(function (prev) {
      if (!(symbol in prev)) return prev;
      var updated = Object.assign({}, prev);
      delete updated[symbol];
      localStorage.setItem(scopedStorageKey('vs-alert-levels'), JSON.stringify(updated));
      return updated;
    });
    delete alertFired.current[symbol];
  }

  const [alertModalSymbol, setAlertModalSymbol] = useState(null);
  const [alertModalPrice, setAlertModalPrice] = useState(0);

  function promptCreateAlert(symbol, price) {
    if (!canNotify) {
      openUpgradeModal();
      return;
    }
    setAlertModalSymbol(symbol);
    setAlertModalPrice(price || 0);
  }

  /* ── Push Notifications — real device push that fires even with the app
     closed. Delivery is driven server-side (server/services/webPush.js)
     against the same thresholds set above. Subscribing is opened up during
     the free trial (canNotify). ── */
  var {
    pushSupported,
    notificationApiSupported,
    notificationPermission,
    pushEnabled,
    pushBusy,
    pushError,
    checkSubscribed,
    enablePush,
    disablePush,
  } = usePushSubscription();

  useEffect(
    function () {
      if (!canNotify || !pushSupported) return;
      checkSubscribed();
    },
    [canNotify, pushSupported]
  );

  /* ── Watchlist — backed by the server so starred tickers follow the
     account across devices, not just the browser that starred them.
     localStorage is kept only as an instant-paint cache (same pattern as
     alertLevels above). ── */
  const [watchlist, setWatchlist] = useState(function () {
    try {
      return JSON.parse(localStorage.getItem(scopedStorageKey('vs-watchlist'))) || [];
    } catch (e) {
      return [];
    }
  });
  const [watchlistData, setWatchlistData] = useState(null);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState(null);

  useEffect(
    function () {
      if (!user) return;
      fetch('/api/watchlist', { headers: { Authorization: 'Bearer ' + getToken() } })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (list) {
          if (!Array.isArray(list)) return;
          setWatchlist(list);
          localStorage.setItem(scopedStorageKey('vs-watchlist'), JSON.stringify(list));
        })
        .catch(function () {});
    },
    [user]
  );

  function toggleWatchlistTicker(symbol) {
    var wasStarred = watchlist.indexOf(symbol) >= 0;
    setWatchlist(function (prev) {
      var idx = prev.indexOf(symbol);
      var next;
      if (idx >= 0) {
        next = prev.filter(function (s) {
          return s !== symbol;
        });
      } else {
        next = [].concat(prev, [symbol]);
      }
      localStorage.setItem(scopedStorageKey('vs-watchlist'), JSON.stringify(next));
      return next;
    });
    if (user) {
      fetch('/api/watchlist/' + symbol, {
        method: wasStarred ? 'DELETE' : 'POST',
        headers: { Authorization: 'Bearer ' + getToken() },
      }).catch(function () {});
    }
  }

  function isInWatchlist(symbol) {
    return watchlist.indexOf(symbol) >= 0;
  }

  function refreshWatchlist() {
    if (watchlist.length === 0) {
      setWatchlistData(null);
      return;
    }
    setWatchlistLoading(true);
    setWatchlistError(null);
    fetch('/api/watchlist-quotes?symbols=' + watchlist.join(','), {
      headers: { Authorization: 'Bearer ' + getToken() },
    })
      .then(function (r) {
        if (!r.ok)
          return r.json().then(function (d) {
            throw new Error(d && d.error ? d.error : 'Fetch failed');
          });
        return r.json();
      })
      .then(function (d) {
        setWatchlistData(d.results);
      })
      .catch(function (e) {
        setWatchlistError(e.message || 'Failed to load quotes');
      })
      .finally(function () {
        setWatchlistLoading(false);
      });
  }

  /* ── Upgrade modal ── */
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeContext, setUpgradeContext] = useState('general');

  const openUpgradeModal = useCallback(
    function (context) {
      setUpgradeContext(context === 'trial-ended' ? 'trial-ended' : 'general');
      setShowUpgradeModal(true);
    },
    [setShowUpgradeModal, setUpgradeContext]
  );

  useEffect(
    function () {
      if (showUpgradeModal) track('upgrade_modal_shown', { tier: userTier, page: page });
    },
    [showUpgradeModal]
  );

  /* Toast state */
  const [toastMsg, setToastMsg] = useState('');
  const [toastShow, setToastShow] = useState(false);
  const toastTimeout = useRef(null);

  function showToast(msg) {
    setToastMsg(msg);
    setToastShow(true);
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(function () {
      setToastShow(false);
    }, 5000);
  }

  // Welcome toast after Google OAuth callback
  const prevUserRef = useRef(null);
  useEffect(
    function () {
      if (user && !prevUserRef.current) {
        var wasGoogleAuth = sessionStorage.getItem('google_auth_pending');
        if (wasGoogleAuth) {
          sessionStorage.removeItem('google_auth_pending');
          showToast('Signed in as ' + user.email);
        }
      }
      prevUserRef.current = user;
    },
    [user]
  );

  // Show toast if Google OAuth failed, or if this session was signed out
  // because the account logged in on another device (one active device at
  // a time, enforced server-side).
  useEffect(
    function () {
      if (authError === 'session_replaced') {
        showToast('You were signed out because this account logged in on another device.');
        clearAuthError();
      } else if (authError) {
        showToast('Google sign-in failed — please try again.');
        clearAuthError();
      }
    },
    [authError]
  );

  // Whop's checkout returns here after EVERY checkout attempt — success or
  // cancelled/failed alike — appending its own
  // ?status=success|error (see server/routes/checkout.js's redirectUrl,
  // which deliberately doesn't bake in an assumed outcome). Only a real
  // "success" status shows anything; anything else is treated as "nothing
  // happened," matching reality. The tier upgrade itself lands via the
  // server-side webhook, which can trail this redirect by a moment, so
  // refresh a couple of times rather than trusting the first fetch.
  //
  // Which tier was actually bought isn't in this URL at all — UpgradeModal
  // stashes it in localStorage right before redirecting to Whop so the
  // welcome screen can show the right badge/copy immediately, rather than
  // sitting blank until the webhook confirms.
  //
  // handledStatusRef guards against React StrictMode's dev-only
  // mount→cleanup→mount replay of this effect: without it, the first pass
  // reads and clears vs_pending_tier, then the second pass finds it already
  // gone and falls through to the "just a toast" branch — showing BOTH the
  // welcome modal AND the generic toast for the same purchase. The ref
  // survives that replay (only a full unmount would reset it), so it makes
  // the localStorage read-and-clear effectively run exactly once.
  const [welcomeTier, setWelcomeTier] = useState(null);
  const handledStatusRef = useRef(false);
  // Always mirrors the latest `user` value so the post-checkout polling loop
  // can detect when the webhook has landed without a stale closure.
  const userRef = useRef(user);
  useEffect(
    function () {
      userRef.current = user;
    },
    [user]
  );
  useEffect(
    function () {
      var status = new URLSearchParams(location.search).get('status');
      if (!status) return;
      navigate(location.pathname, { replace: true });
      if (status !== 'success') return;
      if (handledStatusRef.current) return;
      handledStatusRef.current = true;
      var pendingTier = localStorage.getItem('vs_pending_tier');
      localStorage.removeItem('vs_pending_tier');
      if (pendingTier === 'premium' || pendingTier === 'elite') {
        setWelcomeTier(pendingTier);
      } else {
        showToast('Payment received! Upgrading your account…');
      }
      // Poll /api/auth/me until the tier matches the purchased tier, backing
      // off gradually. The Whop webhook can trail the redirect by anywhere
      // from 1s to ~90s on a cold Render instance, so a single 3s retry is
      // not enough — the user would see "Free" in the nav until hard-refresh.
      var cancelled = false;
      var delays = [1000, 3000, 8000, 20000, 45000];
      (async function poll() {
        for (var i = 0; i < delays.length; i++) {
          await new Promise(function (r) {
            setTimeout(r, delays[i]);
          });
          if (cancelled) return;
          await refreshUser();
          if (cancelled) return;
          var u = userRef.current;
          if (u && pendingTier && u.tier === pendingTier) return;
        }
      })();
      return function () {
        cancelled = true;
      };
    },
    [location.search]
  );

  // Tapping a scheduled-scan push notification (or clicking one in the bell
  // panel) lands here as ?notif=<id> — fetch that exact notification's own
  // scan results and show them in a dedicated modal, instead of silently
  // dropping the user on whatever the current page happens to show. Query
  // param is always stripped so a refresh doesn't re-fetch/re-open it.
  const [scheduledScanNotif, setScheduledScanNotif] = useState(null);
  function openScheduledNotification(rawId) {
    // Local-only alert entries (a Date.now()+Math.random() id) never made it
    // to the server, so there's nothing to fetch — only 'srv-<id>' entries
    // (persisted via addNotification) can possibly have scan results.
    if (typeof rawId !== 'string' || rawId.indexOf('srv-') !== 0) return;
    var id = rawId.slice(4);
    if (!id || !user) return;
    fetch('/api/notifications/' + id, { headers: { Authorization: 'Bearer ' + getToken() } })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (data && data.scanType) setScheduledScanNotif(data);
      })
      .catch(function () {});
  }
  useEffect(
    function () {
      var notifId = new URLSearchParams(location.search).get('notif');
      if (!notifId) return;
      navigate(location.pathname, { replace: true });
      if (!user) return;
      openScheduledNotification(notifId);
    },
    [location.search, user]
  );

  // Open AuthModal automatically when Google OAuth returns (show consent screen)
  useEffect(
    function () {
      if (pendingGoogleToken) {
        setShowAuthModal(true);
      }
    },
    [pendingGoogleToken]
  );

  useEffect(
    function () {
      if (!user) return; // don't auto-show cached results to guests
      fetch('/api/last-results', { headers: { Authorization: 'Bearer ' + getToken() } })
        .then(function (r) {
          if (!r.ok) return null;
          return r.json();
        })
        .then(function (d) {
          if (d && d.results && d.results.length) {
            setResults(d.results);
            setScanTime(d.scanTime);
            setScanDataStatus(d.dataStatus || null);
            setScanDataAsOf(d.dataAsOf || d.scanTime || null);
            setRestoredFromLastScan(true);
          }
        })
        .catch(function () {});
    },
    [user]
  );

  /* ── Notification helpers ── */
  function playBeep() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {}
  }

  function isMarketHours() {
    var now = new Date();
    var etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    var et = new Date(etStr);
    var day = et.getDay();
    if (day === 0 || day === 6) return false;
    var mins = et.getHours() * 60 + et.getMinutes();
    return mins >= 570 && mins < 960;
  }

  useEffect(
    function () {
      if (!notificationsEnabled) {
        if (notifPoll.current) clearInterval(notifPoll.current);
        return;
      }

      function checkForNewTickers() {
        if (!isMarketHours()) return;
        fetch('/api/last-results', { headers: { Authorization: 'Bearer ' + getToken() } })
          .then(function (r) {
            return r.json();
          })
          .then(function (d) {
            if (!d.results || !d.results.length) return;
            var currentTickers = d.results.map(function (r) {
              return r.symbol;
            });
            var prev = prevResults.current;
            if (prev !== null) {
              var newTickers = currentTickers.filter(function (sym) {
                return prev.indexOf(sym) === -1;
              });
              if (newTickers.length > 0) {
                newTickers.forEach(function (sym) {
                  var stock = d.results.find(function (r) {
                    return r.symbol === sym;
                  });
                  if (!stock) return;
                  var title = 'Volume Alert: ' + sym;
                  var body =
                    formatPrice(stock.price) +
                    '  ·  ' +
                    (Number.isFinite(Number(stock.volumeRatio)) && Number(stock.volumeRatio) > 0
                      ? Number(stock.volumeRatio) + 'x avg volume'
                      : 'average volume unavailable');
                  addAlertToHistory(sym, title, body);
                  if (window.Notification && Notification.permission === 'granted') {
                    new Notification(title, { body: body, icon: '/icon-192.png', tag: sym });
                  }
                  playBeep();
                });
              }
            }
            prevResults.current = currentTickers;

            var levels = {};
            try {
              levels = JSON.parse(localStorage.getItem(scopedStorageKey('vs-alert-levels'))) || {};
            } catch (e) {}
            d.results.forEach(function (stock) {
              var alertData = levels[stock.symbol];
              if (!alertData || alertFired.current[stock.symbol]) return;

              var title, body;
              var livePrice = Number(stock.price);
              if (!Number.isFinite(livePrice) || livePrice <= 0) return;
              if (alertData.type === 'price') {
                var side = livePrice >= alertData.targetPrice ? 'above' : 'below';
                if (side === alertData.startingSide) return;
                title = 'Alert: ' + stock.symbol + ' crossed $' + alertData.targetPrice;
                body = 'Now ' + formatPrice(livePrice);
              } else {
                var liveRatio = Number(stock.volumeRatio);
                if (!Number.isFinite(liveRatio) || liveRatio <= 0 || liveRatio < alertData.minRatio) return;
                title = 'Alert: ' + stock.symbol + ' hit ' + liveRatio + 'x';
                body = 'Crossed your ' + alertData.minRatio + 'x threshold · ' + formatPrice(livePrice);
              }

              alertFired.current[stock.symbol] = true;
              addAlertToHistory(stock.symbol, title, body);
              if (window.Notification && Notification.permission === 'granted') {
                new Notification(title, { body: body, icon: '/icon-192.png', tag: 'alert-' + stock.symbol });
              }
              playBeep();
              // One-shot: cancel the threshold itself once it fires, same
              // as the server-side alert — no re-arming if the condition
              // becomes true again, the user has to set a new alert for that.
              removeAlertLevel(stock.symbol);
            });
          })
          .catch(function () {});
      }

      checkForNewTickers();
      notifPoll.current = setInterval(checkForNewTickers, 60000);

      return function () {
        if (notifPoll.current) clearInterval(notifPoll.current);
      };
    },
    [notificationsEnabled]
  );

  // The bell's "Notifications on" label is a promise to the customer that
  // this browser will actually show them — it must only ever go true once
  // Notification.permission is actually 'granted'. The bug this replaces
  // set it true whenever permission wasn't exactly 'default' (i.e. also for
  // 'denied', and for browsers with no Notification API at all), so a
  // customer who had blocked notifications — or whose browser doesn't
  // support them — still saw "on" with zero chance any notification would
  // ever fire.
  function requestNotificationPermissionIfNeeded() {
    if (!window.Notification) return; // unsupported — stays off, never claims otherwise
    if (Notification.permission === 'granted') {
      setNotificationsEnabled(true);
    } else if (Notification.permission === 'default') {
      Notification.requestPermission().then(function (perm) {
        if (perm === 'granted') setNotificationsEnabled(true);
      });
    }
    // 'denied': stays off — the browser will silently refuse anyway.
  }

  function handleBellClick() {
    var opening = !showAlertPanel;
    setShowAlertPanel(opening);
    if (opening) {
      setUnreadCount(0);
      localStorage.setItem(scopedStorageKey('vs-alert-unread'), '0');
      if (user) {
        fetch('/api/notifications/read', { method: 'POST', headers: { Authorization: 'Bearer ' + getToken() } }).catch(
          function () {}
        );
      }
      if (!notificationsEnabled) requestNotificationPermissionIfNeeded();
    }
  }

  function toggleNotifications() {
    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      prevResults.current = null;
    } else {
      requestNotificationPermissionIfNeeded();
    }
  }

  const startScan = useCallback(
    function () {
      if (!user) {
        setShowAuthModal(true);
        return;
      }
      if (!isPremium && categoryQuota(scanMeta, 'capitalFlow').exhausted) {
        setShowTrialEndedModal(true);
        return;
      }

      setScanning(true);
      setError(null);
      setFromCache(false);
      setRestoredFromLastScan(false);
      setProgress({ processed: 0, total: 1, found: 0 });
      setLiveResults([]);

      if (poll.current) clearInterval(poll.current);
      poll.current = setInterval(function () {
        fetch('/api/progress', { headers: { Authorization: 'Bearer ' + getToken() } })
          .then(function (r) {
            return r.json();
          })
          .then(function (d) {
            if (d.progress) setProgress(d.progress);
            if (d.liveResults && d.liveResults.length) setLiveResults(d.liveResults);
            if (!d.running) {
              clearInterval(poll.current);
              poll.current = null;
            }
          })
          .catch(function () {});
      }, 600);

      var cap = parseFloat(minCap) * 1e9;
      // Edge-cached via the Cloudflare Worker when VITE_SCAN_WORKER_URL is set
      // (see cloudflare-worker/scan-cache-worker.js); falls back to the app's
      // own origin otherwise, so local dev is unaffected.
      var scanWorkerBase = (import.meta.env.VITE_SCAN_WORKER_URL || '').replace(/\/+$/, '');
      var scanUrl = scanWorkerBase + '/api/scan?minVolumeRatio=' + minRatio + '&minMarketCap=' + cap;
      if (minPrice) scanUrl += '&minPrice=' + minPrice;
      if (maxPrice) scanUrl += '&maxPrice=' + maxPrice;
      if (minVol) scanUrl += '&minVol=' + encodeURIComponent(minVol);
      if (scanMode === 'sectors' && selectedSectors.length > 0) {
        scanUrl += '&sectors=' + encodeURIComponent(selectedSectors.join(','));
      } else if (scanMode === 'nasdaq100') {
        scanUrl += '&list=nasdaq100';
      } else if (scanMode === 'sp500') {
        scanUrl += '&list=sp500';
      }
      fetch(scanUrl, { headers: { Authorization: 'Bearer ' + getToken() } })
        .then(function (r) {
          if (r.status === 401) {
            setShowAuthModal(true);
            throw new Error('Sign in to run a scan');
          }
          if (r.status === 403)
            return r.json().then(function (d) {
              throw Object.assign(new Error(d.error || 'Limit reached'), { code: d.code });
            });
          if (!r.ok)
            return r.json().then(function (d) {
              throw new Error(d.error || 'Scan failed');
            });
          return r.json();
        })
        .then(function (d) {
          setResults(d.results);
          setScanTime(d.scanTime);
          setScanDataStatus(d.dataStatus || null);
          setScanDataAsOf(d.dataAsOf || d.scanTime || null);
          setMarketClosed(!!d.marketClosed);
          setFromCache(!!d.fromCache);
          setCacheAge(d.cacheAge || 0);
          setScanMeta({ tier: d.tier, isPremium: d.isPremium, premium: d.premium, free: d.free });
          track('scan_run', { scanMode: scanMode || 'all', resultCount: d.results ? d.results.length : 0 });
        })
        .catch(function (e) {
          if (e.code === 'SCAN_LIMIT') {
            if (isPremium) openUpgradeModal();
            else setShowTrialEndedModal(true);
            return;
          }
          setError(e.message);
        })
        .finally(function () {
          setScanning(false);
          setProgress(null);
          clearInterval(poll.current);
          poll.current = null;
        });
    },
    [
      minRatio,
      minCap,
      minPrice,
      maxPrice,
      minVol,
      scanMode,
      selectedSectors,
      isPremium,
      scanMeta,
      user,
      getToken,
      setShowAuthModal,
      setScanning,
      setError,
      setProgress,
      setLiveResults,
      setRestoredFromLastScan,
      setResults,
      setScanTime,
      setScanDataStatus,
      setScanDataAsOf,
      setMarketClosed,
      setFromCache,
      setCacheAge,
      setShowTrialEndedModal,
      setScanMeta,
      openUpgradeModal,
    ]
  );

  const handleSort = function (f) {
    setSortDir(sortField === f ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc');
    setSortField(f);
  };

  const handleSortDoubleClick = function () {
    setSortField('volumeRatio');
    setSortDir('desc');
  };

  const filtered = results
    ? results.filter(function (r) {
        if (search) {
          var q = search.toLowerCase();
          if (!r.symbol.toLowerCase().includes(q) && !(r.name || '').toLowerCase().includes(q)) return false;
        }
        if (sectorFilter !== 'All' && r.sector !== sectorFilter) return false;
        if (minPrice && r.price < parseFloat(minPrice)) return false;
        if (maxPrice && r.price > parseFloat(maxPrice)) return false;
        /* New filters */
        if (minChange && r.change < parseFloat(minChange)) return false;
        if (maxChange && r.change > parseFloat(maxChange)) return false;
        if (exchangeFilter !== 'All' && r.exchange !== exchangeFilter) return false;
        if (minVol) {
          var minVolNum = parseVolInput(minVol);
          if (minVolNum > 0 && r.volume < minVolNum) return false;
        }
        return true;
      })
    : [];

  const sorted = [].concat(filtered).sort(function (a, b) {
    var av = a[sortField],
      bv = b[sortField];
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  // The public marketing page shown to logged-out visitors at "/" — Capi
  // (below) is an in-app tool with nothing to do until someone has an
  // account, so it stays hidden here instead of floating over the page's
  // own "Start free" CTAs.
  var isGuestLanding = location.pathname === '/' && !user;

  return (
    <>
      <Toast message={toastMsg} show={toastShow} onClose={() => setToastShow(false)} />

      <PilotGate user={user} onAccept={acceptPilotTerms} onSignOut={logout} />

      {showAuthModal && (
        <Suspense fallback={null}>
          <AuthModal initialScreen={authInitialScreen} onClose={() => setShowAuthModal(false)} />
        </Suspense>
      )}

      <PushPermissionPrompt user={user} canNotify={eliteAccess} />
      <InstallPrompt />

      {showUpgradeModal && (
        <UpgradeModal
          userTier={userTier}
          trialEnded={upgradeContext === 'trial-ended'}
          onClose={() => setShowUpgradeModal(false)}
        />
      )}
      {showTrialEndedModal && (
        <TrialEndedModal
          onClose={() => setShowTrialEndedModal(false)}
          onUpgrade={() => {
            setShowTrialEndedModal(false);
            openUpgradeModal('trial-ended');
          }}
        />
      )}

      {alertModalSymbol && (
        <AlertThresholdModal
          symbol={alertModalSymbol}
          current={alertLevels[alertModalSymbol]}
          currentPrice={alertModalPrice}
          onClose={() => setAlertModalSymbol(null)}
          onSave={(alertData) => {
            setAlertLevel(alertModalSymbol, alertData);
            setAlertModalSymbol(null);
          }}
          onRemove={() => {
            removeAlertLevel(alertModalSymbol);
            setAlertModalSymbol(null);
          }}
        />
      )}

      {!isGuestLanding && !isMobile && (
        <Suspense fallback={null}>
          <ChatWidget
            user={user}
            isElite={eliteAccess}
            trialEnded={trialEnded}
            getToken={getToken}
            onRequireAuth={() => setShowAuthModal(true)}
            onTrialEnded={onTrialEnded}
          />
        </Suspense>
      )}

      {welcomeTier && (
        <Suspense fallback={null}>
          <WelcomeTierModal
            tier={welcomeTier}
            confirmed={userTier === welcomeTier}
            eliteUpgradeAvailable={user ? user.elite_upgrade_available : false}
            onClose={() => setWelcomeTier(null)}
          />
        </Suspense>
      )}

      {scheduledScanNotif && (
        <Suspense fallback={null}>
          <ScheduledScanResultsModal
            notification={scheduledScanNotif}
            onClose={() => setScheduledScanNotif(null)}
            isInWatchlist={isInWatchlist}
            toggleWatchlistTicker={toggleWatchlistTicker}
          />
        </Suspense>
      )}

      {isGuestLanding ? (
        <Suspense fallback={<div className="page-loading">Loading…</div>}>
          <LandingPage onGetStarted={landingGetStarted} />
        </Suspense>
      ) : (
        <div className="app">
          <Topbar
            user={user}
            isElite={isElite}
            isPremium={isPremium}
            isTrial={eliteAccess && !isElite}
            logout={logout}
            page={page}
            results={results}
            scanning={scanning}
            scanMeta={scanMeta}
            onUpgrade={() => openUpgradeModal()}
            onSignIn={() => setShowAuthModal(true)}
            notificationsEnabled={notificationsEnabled}
            showAlertPanel={showAlertPanel}
            onBellClick={handleBellClick}
            unreadCount={unreadCount}
            alertHistory={alertHistory}
            onClearAll={clearAllAlerts}
            onClosePanel={() => setShowAlertPanel(false)}
            onRemoveAlert={removeAlertFromHistory}
            onOpenNotification={openScheduledNotification}
            onToggleNotifications={toggleNotifications}
            getToken={getToken}
            onPasswordChanged={(token, userData) => login(token, userData)}
            onAccountDeleted={logout}
            onOpenScheduling={openSchedulingFromProfile}
            canNotify={canNotify}
            pushSupported={pushSupported}
            notificationApiSupported={notificationApiSupported}
            notificationPermission={notificationPermission}
            pushEnabled={pushEnabled}
            pushBusy={pushBusy}
            pushError={pushError}
            onEnablePush={enablePush}
            onDisablePush={disablePush}
            setPage={setPage}
          />

          <Routes>
            <Route path="/" element={<Navigate to="/scanner" replace />} />

            <Route
              path="/ma"
              element={
                <Suspense fallback={<div className="page-loading">Loading…</div>}>
                  <MAScannerPage
                    onSignIn={() => openAuthModal('login')}
                    onCreateAccount={() => openAuthModal('signup')}
                    onUpgrade={() => openUpgradeModal()}
                    onTrialEnded={onTrialEnded}
                    isInWatchlist={isInWatchlist}
                    toggleWatchlistTicker={toggleWatchlistTicker}
                    alertLevels={alertLevels}
                    promptCreateAlert={promptCreateAlert}
                  />
                </Suspense>
              }
            />

            <Route
              path="/flow"
              element={
                <Suspense fallback={<div className="page-loading">Loading…</div>}>
                  <MoneyFlow
                    setShowUpgradeModal={setShowUpgradeModal}
                    onSignIn={() => openAuthModal('login')}
                    onCreateAccount={() => openAuthModal('signup')}
                    onTrialEnded={onTrialEnded}
                    alertLevels={alertLevels}
                    promptCreateAlert={promptCreateAlert}
                  />
                </Suspense>
              }
            />

            <Route
              path="/fundamentals"
              element={
                <Suspense fallback={<div className="page-loading">Loading…</div>}>
                  <FundamentalsPage
                    onUpgrade={() => openUpgradeModal()}
                    onSignIn={() => openAuthModal('login')}
                    onCreateAccount={() => openAuthModal('signup')}
                  />
                </Suspense>
              }
            />

            <Route
              path="/watchlist"
              element={
                <WatchlistPage
                  watchlist={watchlist}
                  watchlistData={watchlistData}
                  watchlistLoading={watchlistLoading}
                  watchlistError={watchlistError}
                  refreshWatchlist={refreshWatchlist}
                  toggleWatchlistTicker={toggleWatchlistTicker}
                  setWatchlistError={setWatchlistError}
                  canNotify={canNotify}
                  user={user}
                  pushSupported={pushSupported}
                  pushEnabled={pushEnabled}
                  pushBusy={pushBusy}
                  pushError={pushError}
                  enablePush={enablePush}
                  disablePush={disablePush}
                  setShowUpgradeModal={setShowUpgradeModal}
                  alertLevels={alertLevels}
                  promptCreateAlert={promptCreateAlert}
                  onRequireAuth={() => openAuthModal('login')}
                  onCreateAccount={() => openAuthModal('signup')}
                />
              }
            />

            <Route
              path="/scanner"
              element={
                <ScannerPage
                  scanning={scanning}
                  progress={progress}
                  liveResults={liveResults}
                  error={error}
                  setError={setError}
                  startScan={startScan}
                  isPremium={premiumFeatureAccess}
                  isElite={eliteAccess}
                  setShowUpgradeModal={setShowUpgradeModal}
                  results={results}
                  setResults={setResults}
                  setScanTime={setScanTime}
                  scanMode={scanMode}
                  setScanMode={setScanMode}
                  selectedSectors={selectedSectors}
                  setSelectedSectors={setSelectedSectors}
                  toggleSector={toggleSector}
                  minRatio={minRatio}
                  setMinRatio={setMinRatio}
                  minCap={minCap}
                  setMinCap={setMinCap}
                  minVol={minVol}
                  setMinVol={setMinVol}
                  showPresetPanel={showPresetPanel}
                  setShowPresetPanel={setShowPresetPanel}
                  presetName={presetName}
                  setPresetName={setPresetName}
                  savePreset={savePreset}
                  presets={presets}
                  loadPreset={loadPreset}
                  deletePreset={deletePreset}
                  marketClosed={marketClosed}
                  scanTime={scanTime}
                  scanDataStatus={scanDataStatus}
                  scanDataAsOf={scanDataAsOf}
                  fromCache={fromCache}
                  cacheAge={cacheAge}
                  restoredFromLastScan={restoredFromLastScan}
                  sorted={sorted}
                  sortField={sortField}
                  sortDir={sortDir}
                  handleSort={handleSort}
                  handleSortDoubleClick={handleSortDoubleClick}
                  alertLevels={alertLevels}
                  promptCreateAlert={promptCreateAlert}
                  isInWatchlist={isInWatchlist}
                  toggleWatchlistTicker={toggleWatchlistTicker}
                  scanMeta={scanMeta}
                  maxFreeSectors={MAX_FREE_SECTORS}
                  maxPremiumSectors={MAX_PREMIUM_SECTORS}
                  sectorLimit={sectorLimit}
                  user={user}
                  getToken={getToken}
                  openChart={openChart}
                  onUpgrade={() => openUpgradeModal()}
                  onSignIn={() => setShowAuthModal(true)}
                  onCreateAccount={() => openAuthModal('signup')}
                  radarEvent={radarEvent}
                />
              }
            />

            <Route
              path="/policy"
              element={
                <Suspense fallback={<div className="page-loading">Loading…</div>}>
                  <PolicyPage />
                </Suspense>
              }
            />

            <Route
              path="/accessibility"
              element={
                <Suspense fallback={<div className="page-loading">Loading…</div>}>
                  <AccessibilityStatementPage />
                </Suspense>
              }
            />

            <Route path="*" element={<Navigate to="/scanner" replace />} />
          </Routes>

          <footer className="site-footer">
            <div className="site-footer-col">
              <button className="site-footer-link" onClick={() => setPage('policy')}>
                Privacy Policy
              </button>
              <p className="site-footer-disclaimer">
                Info & Education Only. Not intended as investment advice. Market data may be delayed or estimated.
              </p>
            </div>
          </footer>
        </div>
      )}

      {chartOpen && (
        <Suspense fallback={null}>
          <ChartModal symbol={chartSymbol} name={chartName} onClose={closeChart} />
        </Suspense>
      )}

      {liveAlert && (
        <div className="live-alert-toast" role="status" aria-live="polite">
          <span className="live-alert-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              width="17"
              height="17"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </span>
          <div className="live-alert-body">
            <span className="live-alert-kicker">LIVE ALERT</span>
            <strong>{liveAlert.title}</strong>
            <span>{liveAlert.body}</span>
          </div>
          <button
            className="live-alert-close"
            type="button"
            aria-label="Dismiss live alert"
            onClick={() => setLiveAlert(null)}
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}

export default App;
