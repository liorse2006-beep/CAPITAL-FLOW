import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import Toast from './components/shared/Toast';
import useSSE from './hooks/useSSE';
import useScanQuota from './hooks/useScanQuota';
import usePushSubscription from './hooks/usePushSubscription';
import { parseVolInput } from './utils/format';
import { categoryQuota } from './utils/quota';
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
const PolicyPage = lazy(() => import('./pages/PolicyPage'));
const AuthModal = lazy(() => import('./components/Auth/AuthModal'));

/* ── Main App ── */
function App() {
  const { user, logout, getToken, authError, clearAuthError, pendingGoogleToken, acceptPilotTerms, refreshUser } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);

  const [theme, setTheme] = useState('dark');
  const navigate = useNavigate();
  const location = useLocation();
  // Derived from the URL rather than its own state — keeps every existing
  // `page === 'x'` / `setPage('x')` call site unchanged while making page
  // navigation a real, bookmarkable, back/forward-able browser route.
  const page = location.pathname === '/' ? 'scanner' : location.pathname.slice(1).split('/')[0];
  function setPage(p) {
    navigate(p === 'scanner' ? '/' : '/' + p);
  }

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
  const [currentTicker, setCurrentTicker] = useState('');
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
    return isElite ? Infinity : isPremium ? MAX_PREMIUM_SECTORS : MAX_FREE_SECTORS;
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
  const [marketClosed, setMarketClosed] = useState(false);
  const [sortField, setSortField] = useState('volumeRatio');
  const [sortDir, setSortDir] = useState('desc');
  const [minRatio, setMinRatio] = useState('1.5');
  const [minCap, setMinCap] = useState('1');
  const [search, setSearch] = useState('');
  const [sectorFilter, setSectorFilter] = useState('All');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [error, setError] = useState(null);
  const poll = useRef(null);

  /* ── Chart modal state ── */
  const [chartOpen, setChartOpen] = useState(false);
  const [chartSymbol, setChartSym] = useState('');
  const [chartName, setChartName] = useState('');

  function openChart(sym, name) {
    setChartSym(sym);
    setChartName(name || sym);
    setChartOpen(true);
  }
  function closeChart() {
    setChartOpen(false);
  }

  /* ── SSE — real-time background scan updates ── */
  const [sseConnected, setSseConnected] = useState(false);
  const [liveAlert, setLiveAlert] = useState(null);

  // SSE only active for premium users — token sent as query param (EventSource has no headers)
  var sseToken = isPremium ? getToken() : null;
  useSSE(
    sseToken ? '/api/stream?token=' + encodeURIComponent(sseToken) : null,
    {
      connected: () => setSseConnected(true),
      ping: () => {},
      'auth-error': () => setSseConnected(false),
      'scan-update': (d) => {
        if (d.results) {
          window.__bgScanResults = d.results;
          window.__bgScanTime = d.scanTime;
        }
      },
      alert: (d) => {
        addAlertToHistory(d.symbol, d.title, d.body);
        setLiveAlert(d);
        setTimeout(() => setLiveAlert(null), 6000);
      },
    },
    isPremium
  );

  /* ── Notification state ── */
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [showAlertPanel, setShowAlertPanel] = useState(false);
  const [alertHistory, setAlertHistory] = useState(function () {
    try {
      return JSON.parse(localStorage.getItem('vs-alert-history')) || [];
    } catch (e) {
      return [];
    }
  });
  const [unreadCount, setUnreadCount] = useState(function () {
    try {
      return parseInt(localStorage.getItem('vs-alert-unread') || '0', 10);
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
      localStorage.setItem('vs-alert-history', JSON.stringify(next));
      return next;
    });
    setUnreadCount(function (c) {
      var next = c + 1;
      localStorage.setItem('vs-alert-unread', String(next));
      return next;
    });
  }

  function removeAlertFromHistory(id) {
    setAlertHistory(function (prev) {
      var next = prev.filter(function (a) {
        return a.id !== id;
      });
      localStorage.setItem('vs-alert-history', JSON.stringify(next));
      return next;
    });
  }

  function clearAllAlerts() {
    setAlertHistory([]);
    localStorage.removeItem('vs-alert-history');
  }

  /* New filter state */
  const [minChange, setMinChange] = useState('');
  const [maxChange, setMaxChange] = useState('');
  const [exchangeFilter, setExchangeFilter] = useState('All');
  const [minVol, setMinVol] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

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

  // Notifications (push subscribe + watchlist alert thresholds) are Elite
  // features, opened up temporarily to a free account for as long as its
  // 7-day trial is active — NOT the daily scheduled-scan digest, which
  // stays strictly Elite (gated separately, see saveNotifTime/isElite below).
  var canNotify = isElite || (userTier === 'free' && !!(scanMeta && scanMeta.free && scanMeta.free.trialActive));

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
      return JSON.parse(localStorage.getItem('vs-presets')) || [];
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
    localStorage.setItem('vs-presets', JSON.stringify(updated));
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
    localStorage.setItem('vs-presets', JSON.stringify(updated));
  }

  /* ── Relative Volume Alert Levels — backed by the server so thresholds
     survive closing the tab and feed the push-notification pipeline.
     localStorage is kept only as an instant-paint cache. ── */
  const [alertLevels, setAlertLevels] = useState(function () {
    try {
      return JSON.parse(localStorage.getItem('vs-alert-levels')) || {};
    } catch (e) {
      return {};
    }
  });
  const alertFired = useRef({});

  useEffect(
    function () {
      if (!canNotify) return;
      fetch('/api/watchlist-alerts', { headers: { Authorization: 'Bearer ' + getToken() } })
        .then(function (r) {
          return r.ok ? r.json() : {};
        })
        .then(function (d) {
          setAlertLevels(d || {});
          localStorage.setItem('vs-alert-levels', JSON.stringify(d || {}));
        })
        .catch(function () {});
    },
    [canNotify]
  );

  function setAlertLevel(symbol, threshold) {
    var val = parseFloat(threshold);
    if (!(val > 0)) return;
    var updated = Object.assign({}, alertLevels);
    updated[symbol] = val;
    setAlertLevels(updated);
    localStorage.setItem('vs-alert-levels', JSON.stringify(updated));
    if (canNotify) {
      fetch('/api/watchlist-alerts/' + symbol, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
        body: JSON.stringify({ minRatio: val }),
      }).catch(function () {});
    }
  }

  function removeAlertLevel(symbol) {
    var updated = Object.assign({}, alertLevels);
    delete updated[symbol];
    delete alertFired.current[symbol];
    setAlertLevels(updated);
    localStorage.setItem('vs-alert-levels', JSON.stringify(updated));
    if (canNotify) {
      fetch('/api/watchlist-alerts/' + symbol, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + getToken() },
      }).catch(function () {});
    }
  }

  const [alertModalSymbol, setAlertModalSymbol] = useState(null);

  function promptCreateAlert(symbol) {
    if (!canNotify) {
      setShowUpgradeModal(true);
      return;
    }
    setAlertModalSymbol(symbol);
  }

  /* ── Push Notifications — real device push that fires even with the app
     closed. Delivery is driven server-side (server/services/webPush.js +
     scheduledDigest.js) against the same thresholds set above. Subscribing
     is opened up during the free trial (canNotify); the daily scheduled
     digest time below stays strictly Elite. ── */
  var { pushSupported, pushEnabled, pushBusy, pushError, checkSubscribed, enablePush, disablePush } =
    usePushSubscription();
  const [notifTime, setNotifTime] = useState('');

  useEffect(
    function () {
      if (!canNotify || !pushSupported) return;
      checkSubscribed();
    },
    [canNotify, pushSupported]
  );

  useEffect(
    function () {
      if (!isElite || !pushSupported) return;
      fetch('/api/push/notification-time', { headers: { Authorization: 'Bearer ' + getToken() } })
        .then(function (r) {
          return r.ok ? r.json() : {};
        })
        .then(function (d) {
          setNotifTime((d && d.time) || '');
        })
        .catch(function () {});
    },
    [isElite, pushSupported]
  );

  function saveNotifTime(time) {
    setNotifTime(time);
    fetch('/api/push/notification-time', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
      body: JSON.stringify({ time: time || null }),
    }).catch(function () {});
  }

  /* ── Watchlist ── */
  const [watchlist, setWatchlist] = useState(function () {
    try {
      return JSON.parse(localStorage.getItem('vs-watchlist')) || [];
    } catch (e) {
      return [];
    }
  });
  const [watchlistData, setWatchlistData] = useState(null);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState(null);

  function toggleWatchlistTicker(symbol) {
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
      localStorage.setItem('vs-watchlist', JSON.stringify(next));
      return next;
    });
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
    fetch('/api/watchlist-quotes?symbols=' + watchlist.join(','), { headers: { Authorization: 'Bearer ' + getToken() } })
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
  useEffect(
    function () {
      if (showUpgradeModal) track('upgrade_modal_shown', { tier: userTier, page: page });
    },
    [showUpgradeModal]
  );

  /* ── Pagination ── */
  var visibleCountState = useState(50);
  var visibleCount = visibleCountState[0];
  var setVisibleCount = visibleCountState[1];

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

  // Whop's hosted checkout redirects back here after EVERY checkout
  // attempt — success or cancelled/failed alike — appending its own
  // ?status=success|error (see server/routes/checkout.js's redirectUrl,
  // which deliberately doesn't bake in an assumed outcome). Only a real
  // "success" status gets the celebratory toast; anything else is treated
  // as "nothing happened," matching reality. The tier upgrade itself lands
  // via the server-side webhook, which can trail this redirect by a
  // moment, so refresh a couple of times rather than trusting the first
  // fetch.
  useEffect(
    function () {
      var status = new URLSearchParams(location.search).get('status');
      if (!status) return;
      navigate(location.pathname, { replace: true });
      if (status !== 'success') return;
      showToast('Payment received! Upgrading your account…');
      refreshUser();
      var retry = setTimeout(refreshUser, 3000);
      return function () {
        clearTimeout(retry);
      };
    },
    [location.search]
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

  useEffect(function () {
    document.documentElement.setAttribute('data-theme', 'dark');
  }, []);

  useEffect(function () {
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
        }
      })
      .catch(function () {});
  }, [user]);

  useEffect(
    function () {
      setVisibleCount(50);
    },
    [results]
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
                  var body = '$' + stock.price.toFixed(2) + '  ·  ' + stock.volumeRatio + 'x avg volume';
                  addAlertToHistory(sym, title, body);
                  if (window.Notification && Notification.permission === 'granted') {
                    new Notification(title, { body: body, icon: '/favicon.svg', tag: sym });
                  }
                  playBeep();
                });
              }
            }
            prevResults.current = currentTickers;

            var levels = {};
            try {
              levels = JSON.parse(localStorage.getItem('vs-alert-levels')) || {};
            } catch (e) {}
            d.results.forEach(function (stock) {
              var threshold = levels[stock.symbol];
              if (!threshold) return;
              if (stock.volumeRatio >= threshold && !alertFired.current[stock.symbol]) {
                alertFired.current[stock.symbol] = true;
                var title = 'Alert: ' + stock.symbol + ' hit ' + stock.volumeRatio + 'x';
                var body = 'Crossed your ' + threshold + 'x threshold · $' + stock.price.toFixed(2);
                addAlertToHistory(stock.symbol, title, body);
                if (window.Notification && Notification.permission === 'granted') {
                  new Notification(title, { body: body, icon: '/favicon.svg', tag: 'alert-' + stock.symbol });
                }
                playBeep();
              } else if (stock.volumeRatio < threshold) {
                alertFired.current[stock.symbol] = false;
              }
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

  function handleBellClick() {
    var opening = !showAlertPanel;
    setShowAlertPanel(opening);
    if (opening) {
      setUnreadCount(0);
      localStorage.setItem('vs-alert-unread', '0');
      if (!notificationsEnabled) {
        if (window.Notification && Notification.permission === 'default') {
          Notification.requestPermission().then(function (perm) {
            if (perm === 'granted') setNotificationsEnabled(true);
          });
        } else if (!window.Notification || Notification.permission === 'granted') {
          setNotificationsEnabled(true);
        }
      }
    }
  }

  function toggleNotifications() {
    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      prevResults.current = null;
    } else {
      if (window.Notification && Notification.permission === 'default') {
        Notification.requestPermission().then(function (perm) {
          if (perm === 'granted') setNotificationsEnabled(true);
        });
      } else {
        setNotificationsEnabled(true);
      }
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
      setProgress({ processed: 0, total: 1, found: 0 });
      setLiveResults([]);
      setCurrentTicker('');

      poll.current = setInterval(function () {
        fetch('/api/progress', { headers: { Authorization: 'Bearer ' + getToken() } })
          .then(function (r) {
            return r.json();
          })
          .then(function (d) {
            if (d.progress) setProgress(d.progress);
            if (d.liveResults && d.liveResults.length) setLiveResults(d.liveResults);
            if (!d.running) clearInterval(poll.current);
          })
          .catch(function () {});
      }, 600);

      var cap = parseFloat(minCap) * 1e9;
      var scanUrl = '/api/scan?minVolumeRatio=' + minRatio + '&minMarketCap=' + cap;
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
          setMarketClosed(!!d.marketClosed);
          setScanMeta({ tier: d.tier, isPremium: d.isPremium, premium: d.premium, free: d.free });
          track('scan_run', { scanMode: scanMode || 'all', resultCount: d.results ? d.results.length : 0 });
        })
        .catch(function (e) {
          if (e.code === 'SCAN_LIMIT') {
            if (isPremium) setShowUpgradeModal(true);
            else setShowTrialEndedModal(true);
            return;
          }
          setError(e.message);
        })
        .finally(function () {
          setScanning(false);
          setProgress(null);
          clearInterval(poll.current);
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
      setScanMeta,
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

  const allSectors = results
    ? []
        .concat(
          new Set(
            results
              .map(function (r) {
                return r.sector;
              })
              .filter(Boolean)
              .filter(function (s) {
                return s !== 'N/A';
              })
          )
        )
        .sort()
    : [];
  /* Deduplicate sectors since spread on Set doesn't work in all Babel envs */
  var sectorSet = {};
  if (results) {
    results.forEach(function (r) {
      if (r.sector && r.sector !== 'N/A') sectorSet[r.sector] = true;
    });
  }
  var uniqueSectors = Object.keys(sectorSet).sort();

  return (
    <>
      <Toast message={toastMsg} show={toastShow} onClose={() => setToastShow(false)} />

      <PilotGate user={user} onAccept={acceptPilotTerms} onSignOut={logout} />

      {showAuthModal && (
        <Suspense fallback={null}>
          <AuthModal onClose={() => setShowAuthModal(false)} />
        </Suspense>
      )}

      <PushPermissionPrompt user={user} />
      <InstallPrompt />


      {showUpgradeModal && <UpgradeModal userTier={userTier} onClose={() => setShowUpgradeModal(false)} />}
      {showTrialEndedModal && (
        <TrialEndedModal
          onClose={() => setShowTrialEndedModal(false)}
          onUpgrade={() => {
            setShowTrialEndedModal(false);
            setShowUpgradeModal(true);
          }}
        />
      )}

      {alertModalSymbol && (
        <AlertThresholdModal
          symbol={alertModalSymbol}
          current={alertLevels[alertModalSymbol]}
          onClose={() => setAlertModalSymbol(null)}
          onSave={(num) => {
            setAlertLevel(alertModalSymbol, num);
            setAlertModalSymbol(null);
          }}
          onRemove={() => {
            removeAlertLevel(alertModalSymbol);
            setAlertModalSymbol(null);
          }}
        />
      )}

      <div className="app">
        <Topbar
          user={user}
          isElite={isElite}
          isPremium={isPremium}
          getToken={getToken}
          logout={logout}
          page={page}
          results={results}
          scanning={scanning}
          scanMeta={scanMeta}
          onNewScan={() => {
            setResults(null);
            setScanTime(null);
          }}
          onUpgrade={() => setShowUpgradeModal(true)}
          onSignIn={() => setShowAuthModal(true)}
          notificationsEnabled={notificationsEnabled}
          showAlertPanel={showAlertPanel}
          onBellClick={handleBellClick}
          unreadCount={unreadCount}
          alertHistory={alertHistory}
          onClearAll={clearAllAlerts}
          onClosePanel={() => setShowAlertPanel(false)}
          onRemoveAlert={removeAlertFromHistory}
          onToggleNotifications={toggleNotifications}
          setPage={setPage}
          watchlistCount={watchlist.length}
        />

        <Routes>
          <Route path="/" element={<Navigate to="/scanner" replace />} />

          <Route
            path="/ma"
            element={
              <Suspense fallback={<div className="page-loading">Loading…</div>}>
                <MAScannerPage
                  onOpenChart={openChart}
                  onSignIn={() => setShowAuthModal(true)}
                  onUpgrade={() => setShowUpgradeModal(true)}
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
                  theme={theme}
                  setShowUpgradeModal={setShowUpgradeModal}
                  onSignIn={() => setShowAuthModal(true)}
                  onTrialEnded={onTrialEnded}
                  alertLevels={alertLevels}
                  promptCreateAlert={promptCreateAlert}
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
                openChart={openChart}
                setWatchlistError={setWatchlistError}
                isElite={isElite}
                canNotify={canNotify}
                user={user}
                pushSupported={pushSupported}
                pushEnabled={pushEnabled}
                pushBusy={pushBusy}
                pushError={pushError}
                enablePush={enablePush}
                disablePush={disablePush}
                notifTime={notifTime}
                saveNotifTime={saveNotifTime}
                setShowUpgradeModal={setShowUpgradeModal}
                getToken={getToken}
                onAccountDeleted={() => {
                  logout();
                  showToast('Your account has been permanently deleted.');
                  navigate('/');
                }}
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
                isPremium={isPremium}
                isElite={isElite}
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
                minPrice={minPrice}
                setMinPrice={setMinPrice}
                maxPrice={maxPrice}
                setMaxPrice={setMaxPrice}
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
                sorted={sorted}
                visibleCount={visibleCount}
                setVisibleCount={setVisibleCount}
                sortField={sortField}
                sortDir={sortDir}
                handleSort={handleSort}
                handleSortDoubleClick={handleSortDoubleClick}
                alertLevels={alertLevels}
                promptCreateAlert={promptCreateAlert}
                isInWatchlist={isInWatchlist}
                toggleWatchlistTicker={toggleWatchlistTicker}
                openChart={openChart}
                scanMeta={scanMeta}
                maxFreeSectors={MAX_FREE_SECTORS}
                maxPremiumSectors={MAX_PREMIUM_SECTORS}
                sectorLimit={sectorLimit}
                user={user}
                onUpgrade={() => setShowUpgradeModal(true)}
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

      {chartOpen && (
        <Suspense fallback={null}>
          <ChartModal symbol={chartSymbol} name={chartName} onClose={closeChart} />
        </Suspense>
      )}

      {liveAlert && (
        <div className="live-alert-toast">
          <span className="live-alert-icon">🔔</span>
          <div className="live-alert-body">
            <strong>{liveAlert.title}</strong>
            <span>{liveAlert.body}</span>
          </div>
          <button className="live-alert-close" onClick={() => setLiveAlert(null)}>
            ✕
          </button>
        </div>
      )}
    </>
  );
}

export default App;
