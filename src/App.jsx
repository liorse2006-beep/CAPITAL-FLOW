import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import Toast from './components/shared/Toast'
import InlineSparkline from './components/shared/InlineSparkline'
import useSSE from './hooks/useSSE'
import useScanQuota from './hooks/useScanQuota'
import usePushSubscription from './hooks/usePushSubscription'
import { fmt, parseVolInput, friendlyError } from './utils/format'
import { categoryQuota } from './utils/quota'
import { COLORS, SECTOR_ETFS } from './constants'
import { useAuth } from './context/AuthContext'
import ScanLoader from './components/shared/ScanLoader'
import PushPermissionPrompt from './components/shared/PushPermissionPrompt'
import UpgradeModal from './components/shared/UpgradeModal'
import AlertBell from './components/shared/AlertBell'

/* Code-split: none of these are needed for the very first paint (the default
   "scanner" tab). Splitting them into their own chunks means a user who
   never opens Sector Moving, MA Scanner, a chart, the policy page, or the
   auth modal never pays to download that code at all. */
const MoneyFlow      = lazy(() => import('./components/MoneyFlow/MoneyFlow'))
const ChartModal      = lazy(() => import('./components/Chart/ChartModal'))
const MAScannerPage   = lazy(() => import('./components/MAScanner/MAScannerPage'))
const PolicyPage      = lazy(() => import('./pages/PolicyPage'))
const AuthModal       = lazy(() => import('./components/Auth/AuthModal'))

/* ── Main App ── */
function App() {
  const { user, logout, getToken, authError, clearAuthError, pendingGoogleToken, acceptPilotTerms } = useAuth()
  const [showAuthModal, setShowAuthModal] = useState(false)

  const [theme, setTheme] = useState("dark");
  const [page, setPage] = useState("scanner");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState(null);
  const [liveResults, setLiveResults] = useState([]);
  const [currentTicker, setCurrentTicker] = useState("");
  const [selectedSectors, setSelectedSectors] = useState([]);
  const [scanMode, setScanMode] = useState(null);
  var ALL_SECTORS = ["Technology","Financials","Health Care","Consumer Discretionary","Consumer Staples","Energy","Industrials","Materials","Real Estate","Utilities","Communication Services","Semiconductors"];
  var MAX_FREE_SECTORS = 2;
  var MAX_PREMIUM_SECTORS = 5;
  /* Per-tier cap on how many sectors can be scanned in one "By Sector" run —
     Free: 2, Premium: 5, Elite: unlimited. Computed as a function (not a
     plain var) because isElite/isPremium aren't assigned yet at this point
     in the render — called only after they're set, same pattern the rest of
     this component already relies on for closures like toggleSector. */
  function sectorLimit() {
    return isElite ? Infinity : (isPremium ? MAX_PREMIUM_SECTORS : MAX_FREE_SECTORS);
  }
  function toggleSector(s) {
    setSelectedSectors(function(prev) {
      if (prev.indexOf(s) >= 0) return prev.filter(function(x) { return x !== s; });
      var limit = sectorLimit();
      if (prev.length >= limit) {
        showToast(
          isPremium
            ? "Premium lets you scan up to " + MAX_PREMIUM_SECTORS + " sectors at once — upgrade to Elite for unlimited."
            : "Free lets you scan up to " + MAX_FREE_SECTORS + " sectors at once — upgrade for more."
        );
        return prev;
      }
      return prev.concat([s]);
    });
  }
  const [scanTime, setScanTime] = useState(null);
  const [marketClosed, setMarketClosed] = useState(false);
  const [sortField, setSortField] = useState("volumeRatio");
  const [sortDir, setSortDir] = useState("desc");
  const [minRatio, setMinRatio] = useState("1.5");
  const [minCap, setMinCap] = useState("1");
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState("All");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [error, setError] = useState(null);
  const poll = useRef(null);

  /* ── Chart modal state ── */
  const [chartOpen, setChartOpen]   = useState(false);
  const [chartSymbol, setChartSym]  = useState('');
  const [chartName, setChartName]   = useState('');

  function openChart(sym, name) { setChartSym(sym); setChartName(name || sym); setChartOpen(true); }
  function closeChart() { setChartOpen(false); }

  /* ── SSE — real-time background scan updates ── */
  const [sseConnected, setSseConnected] = useState(false);
  const [liveAlert, setLiveAlert]       = useState(null);

  // SSE only active for premium users — token sent as query param (EventSource has no headers)
  var sseToken = isPremium ? getToken() : null;
  useSSE(sseToken ? '/api/stream?token=' + encodeURIComponent(sseToken) : null, {
    connected:     ()  => setSseConnected(true),
    ping:          ()  => {},
    'auth-error':  ()  => setSseConnected(false),
    'scan-update': (d) => {
      if (d.results) {
        window.__bgScanResults = d.results;
        window.__bgScanTime    = d.scanTime;
      }
    },
    alert: (d) => {
      addAlertToHistory(d.symbol, d.title, d.body);
      setLiveAlert(d);
      setTimeout(() => setLiveAlert(null), 6000);
    },
  }, isPremium);

  /* ── Notification state ── */
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [showAlertPanel, setShowAlertPanel] = useState(false);
  const [alertHistory, setAlertHistory] = useState(function() {
    try { return JSON.parse(localStorage.getItem("vs-alert-history")) || []; } catch(e) { return []; }
  });
  const [unreadCount, setUnreadCount] = useState(function() {
    try { return parseInt(localStorage.getItem("vs-alert-unread") || "0", 10); } catch(e) { return 0; }
  });
  const prevResults = useRef(null);
  const notifPoll = useRef(null);

  function addAlertToHistory(sym, title, body) {
    var entry = { id: Date.now() + Math.random(), sym: sym, title: title, body: body, time: new Date().toISOString() };
    setAlertHistory(function(prev) {
      var next = [entry].concat(prev).slice(0, 100);
      localStorage.setItem("vs-alert-history", JSON.stringify(next));
      return next;
    });
    setUnreadCount(function(c) {
      var next = c + 1;
      localStorage.setItem("vs-alert-unread", String(next));
      return next;
    });
  }

  function removeAlertFromHistory(id) {
    setAlertHistory(function(prev) {
      var next = prev.filter(function(a) { return a.id !== id; });
      localStorage.setItem("vs-alert-history", JSON.stringify(next));
      return next;
    });
  }

  function clearAllAlerts() {
    setAlertHistory([]);
    localStorage.removeItem("vs-alert-history");
  }

  /* New filter state */
  const [minChange, setMinChange] = useState("");
  const [maxChange, setMaxChange] = useState("");
  const [exchangeFilter, setExchangeFilter] = useState("All");
  const [minVol, setMinVol] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  /* ── Subscription tier — authoritative source is user.tier from the DB.
        Never read from localStorage; the server enforces this independently. ── */
  var isPremium = !!(user && user.is_premium);
  var userTier  = user ? (user.tier || "free") : "free";
  var isElite   = userTier === "elite";

  /* ── Scan Presets ── */
  const [presets, setPresets] = useState(function() {
    try { return JSON.parse(localStorage.getItem("vs-presets")) || []; } catch(e) { return []; }
  });
  const [presetName, setPresetName] = useState("");
  const [showPresetPanel, setShowPresetPanel] = useState(false);

  function savePreset() {
    if (!presetName.trim()) return;
    var preset = {
      name: presetName.trim(),
      minRatio: minRatio, minCap: minCap,
      minPrice: minPrice, maxPrice: maxPrice, minVol: minVol
    };
    var updated = [].concat(presets, [preset]);
    setPresets(updated);
    localStorage.setItem("vs-presets", JSON.stringify(updated));
    setPresetName("");
    setShowPresetPanel(false);
  }

  function loadPreset(p) {
    setMinRatio(p.minRatio || "1.5");
    setMinCap(p.minCap || "1");
    setMinPrice(p.minPrice || "");
    setMaxPrice(p.maxPrice || "");
    setMinVol(p.minVol || "");
  }

  function deletePreset(idx) {
    var updated = presets.filter(function(_, i) { return i !== idx; });
    setPresets(updated);
    localStorage.setItem("vs-presets", JSON.stringify(updated));
  }

  /* ── Relative Volume Alert Levels — backed by the server so thresholds
     survive closing the tab and feed the push-notification pipeline.
     localStorage is kept only as an instant-paint cache. ── */
  const [alertLevels, setAlertLevels] = useState(function() {
    try { return JSON.parse(localStorage.getItem("vs-alert-levels")) || {}; } catch(e) { return {}; }
  });
  const alertFired = useRef({});

  useEffect(function() {
    if (!isElite) return;
    fetch("/api/watchlist-alerts", { headers: { Authorization: "Bearer " + getToken() } })
      .then(function(r) { return r.ok ? r.json() : {}; })
      .then(function(d) {
        setAlertLevels(d || {});
        localStorage.setItem("vs-alert-levels", JSON.stringify(d || {}));
      })
      .catch(function() {});
  }, [isElite]);

  function setAlertLevel(symbol, threshold) {
    var val = parseFloat(threshold);
    if (!(val > 0)) return;
    var updated = Object.assign({}, alertLevels);
    updated[symbol] = val;
    setAlertLevels(updated);
    localStorage.setItem("vs-alert-levels", JSON.stringify(updated));
    if (isElite) {
      fetch("/api/watchlist-alerts/" + symbol, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + getToken() },
        body: JSON.stringify({ minRatio: val }),
      }).catch(function() {});
    }
  }

  function removeAlertLevel(symbol) {
    var updated = Object.assign({}, alertLevels);
    delete updated[symbol];
    delete alertFired.current[symbol];
    setAlertLevels(updated);
    localStorage.setItem("vs-alert-levels", JSON.stringify(updated));
    if (isElite) {
      fetch("/api/watchlist-alerts/" + symbol, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + getToken() },
      }).catch(function() {});
    }
  }

  function promptCreateAlert(symbol) {
    if (!isElite) { setShowUpgradeModal(true); return; }
    var current = alertLevels[symbol];
    var input = window.prompt(
      "Alert " + symbol + " when volume ratio reaches (x)" + (current ? " — currently " + current + "x" : ""),
      current || ""
    );
    if (input === null) return;
    if (input.trim() === "") { removeAlertLevel(symbol); return; }
    setAlertLevel(symbol, input);
  }

  /* ── Push Notifications — real device push that fires even with the app
     closed. Delivery is driven server-side (server/services/webPush.js +
     scheduledDigest.js) against the same thresholds set above. Elite only. ── */
  var { pushSupported, pushEnabled, pushBusy, pushError, checkSubscribed, enablePush, disablePush } = usePushSubscription();
  const [notifTime, setNotifTime] = useState("");

  useEffect(function() {
    if (!isElite || !pushSupported) return;
    checkSubscribed();
    fetch("/api/push/notification-time", { headers: { Authorization: "Bearer " + getToken() } })
      .then(function(r) { return r.ok ? r.json() : {}; })
      .then(function(d) { setNotifTime((d && d.time) || ""); })
      .catch(function() {});
  }, [isElite]);

  function saveNotifTime(time) {
    setNotifTime(time);
    fetch("/api/push/notification-time", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + getToken() },
      body: JSON.stringify({ time: time || null }),
    }).catch(function() {});
  }

  /* ── Watchlist ── */
  const [watchlist, setWatchlist] = useState(function() {
    try { return JSON.parse(localStorage.getItem("vs-watchlist")) || []; } catch(e) { return []; }
  });
  const [watchlistData, setWatchlistData] = useState(null);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState(null);

  function toggleWatchlistTicker(symbol) {
    setWatchlist(function(prev) {
      var idx = prev.indexOf(symbol);
      var next;
      if (idx >= 0) {
        next = prev.filter(function(s) { return s !== symbol; });
      } else {
        next = [].concat(prev, [symbol]);
      }
      localStorage.setItem("vs-watchlist", JSON.stringify(next));
      return next;
    });
  }

  function isInWatchlist(symbol) {
    return watchlist.indexOf(symbol) >= 0;
  }

  function refreshWatchlist() {
    if (watchlist.length === 0) { setWatchlistData(null); return; }
    setWatchlistLoading(true);
    setWatchlistError(null);
    fetch("/api/watchlist-quotes?symbols=" + watchlist.join(","))
      .then(function(r) {
        if (!r.ok) return r.json().then(function(d) { throw new Error((d && d.error) ? d.error : "Fetch failed"); });
        return r.json();
      })
      .then(function(d) { setWatchlistData(d.results); })
      .catch(function(e) { setWatchlistError(e.message || "Failed to load quotes"); })
      .finally(function() { setWatchlistLoading(false); });
  }

  /* ── Shared free-scan quota (3 total, across Capital Flow, Sector Moving, and MA Scanner) ── */
  const { scanMeta, setScanMeta, refreshQuota } = useScanQuota();
  // Re-sync whenever the user switches tabs too, not just on first mount —
  // otherwise the topbar counter can go stale after spending a scan on a
  // different page (e.g. MA Scanner) without a full reload.
  useEffect(function() { refreshQuota(); }, [refreshQuota, page]);

  /* ── Upgrade modal ── */
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  /* ── Filter nudge banner ── */
  const [showFilterNudge, setShowFilterNudge] = useState(false);
  const filterNudgeTimer = useRef(null);
  function triggerFilterNudge() {
    setShowFilterNudge(true);
  }

  /* ── Pagination ── */
  var visibleCountState = useState(50);
  var visibleCount = visibleCountState[0];
  var setVisibleCount = visibleCountState[1];

  /* Toast state */
  const [toastMsg, setToastMsg] = useState("");
  const [toastShow, setToastShow] = useState(false);
  const toastTimeout = useRef(null);


  function showToast(msg) {
    setToastMsg(msg);
    setToastShow(true);
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(function() { setToastShow(false); }, 5000);
  }

  // Welcome toast after Google OAuth callback
  const prevUserRef = useRef(null);
  useEffect(function() {
    if (user && !prevUserRef.current) {
      var wasGoogleAuth = sessionStorage.getItem('google_auth_pending');
      if (wasGoogleAuth) {
        sessionStorage.removeItem('google_auth_pending');
        showToast('Signed in as ' + user.email);
      }
    }
    prevUserRef.current = user;
  }, [user]);

  // Show toast if Google OAuth failed, or if this session was signed out
  // because the account logged in on another device (one active device at
  // a time, enforced server-side).
  useEffect(function() {
    if (authError === 'session_replaced') {
      showToast('You were signed out because this account logged in on another device.');
      clearAuthError();
    } else if (authError) {
      showToast('Google sign-in failed — please try again.');
      clearAuthError();
    }
  }, [authError]);

  // Open AuthModal automatically when Google OAuth returns (show consent screen)
  useEffect(function() {
    if (pendingGoogleToken) {
      setShowAuthModal(true);
    }
  }, [pendingGoogleToken]);

  useEffect(function() {
    document.documentElement.setAttribute("data-theme", "dark");
  }, []);

  useEffect(function() {
    fetch("/api/last-results").then(function(r) { return r.json(); }).then(function(d) {
      if (d.results && d.results.length) { setResults(d.results); setScanTime(d.scanTime); }
    }).catch(function() {});
  }, []);

  useEffect(function() {
    setVisibleCount(50);
  }, [results]);

  /* ── Notification helpers ── */
  function playBeep() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {}
  }

  function isMarketHours() {
    var now = new Date();
    var etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
    var et = new Date(etStr);
    var day = et.getDay();
    if (day === 0 || day === 6) return false;
    var mins = et.getHours() * 60 + et.getMinutes();
    return mins >= 570 && mins < 960;
  }

  useEffect(function() {
    if (!notificationsEnabled) {
      if (notifPoll.current) clearInterval(notifPoll.current);
      return;
    }

    function checkForNewTickers() {
      if (!isMarketHours()) return;
      fetch("/api/last-results").then(function(r) { return r.json(); }).then(function(d) {
        if (!d.results || !d.results.length) return;
        var currentTickers = d.results.map(function(r) { return r.symbol; });
        var prev = prevResults.current;
        if (prev !== null) {
          var newTickers = currentTickers.filter(function(sym) { return prev.indexOf(sym) === -1; });
          if (newTickers.length > 0) {
            newTickers.forEach(function(sym) {
              var stock = d.results.find(function(r) { return r.symbol === sym; });
              if (!stock) return;
              var title = "Volume Alert: " + sym;
              var body = "$" + stock.price.toFixed(2) + "  ·  " + stock.volumeRatio + "x avg volume";
              addAlertToHistory(sym, title, body);
              if (window.Notification && Notification.permission === "granted") {
                new Notification(title, { body: body, icon: "/favicon.svg", tag: sym });
              }
              playBeep();
            });
          }
        }
        prevResults.current = currentTickers;

        var levels = {};
        try { levels = JSON.parse(localStorage.getItem("vs-alert-levels")) || {}; } catch(e) {}
        d.results.forEach(function(stock) {
          var threshold = levels[stock.symbol];
          if (!threshold) return;
          if (stock.volumeRatio >= threshold && !alertFired.current[stock.symbol]) {
            alertFired.current[stock.symbol] = true;
            var title = "Alert: " + stock.symbol + " hit " + stock.volumeRatio + "x";
            var body = "Crossed your " + threshold + "x threshold · $" + stock.price.toFixed(2);
            addAlertToHistory(stock.symbol, title, body);
            if (window.Notification && Notification.permission === "granted") {
              new Notification(title, { body: body, icon: "/favicon.svg", tag: "alert-" + stock.symbol });
            }
            playBeep();
          } else if (stock.volumeRatio < threshold) {
            alertFired.current[stock.symbol] = false;
          }
        });
      }).catch(function() {});
    }

    checkForNewTickers();
    notifPoll.current = setInterval(checkForNewTickers, 60000);

    return function() {
      if (notifPoll.current) clearInterval(notifPoll.current);
    };
  }, [notificationsEnabled]);

  function handleBellClick() {
    var opening = !showAlertPanel;
    setShowAlertPanel(opening);
    if (opening) {
      setUnreadCount(0);
      localStorage.setItem("vs-alert-unread", "0");
      if (!notificationsEnabled) {
        if (window.Notification && Notification.permission === "default") {
          Notification.requestPermission().then(function(perm) {
            if (perm === "granted") setNotificationsEnabled(true);
          });
        } else if (!window.Notification || Notification.permission === "granted") {
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
      if (window.Notification && Notification.permission === "default") {
        Notification.requestPermission().then(function(perm) {
          if (perm === "granted") setNotificationsEnabled(true);
        });
      } else {
        setNotificationsEnabled(true);
      }
    }
  }

  const startScan = useCallback(function() {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    if (!isPremium && categoryQuota(scanMeta, "capitalFlow").exhausted) {
      setShowUpgradeModal(true);
      return;
    }

    setScanning(true);
    setError(null);
    setProgress({ processed: 0, total: 1, found: 0 });
    setLiveResults([]);
    setCurrentTicker("");

    poll.current = setInterval(function() {
      fetch("/api/progress").then(function(r) { return r.json(); }).then(function(d) {
        if (d.progress) setProgress(d.progress);
        if (d.liveResults && d.liveResults.length) setLiveResults(d.liveResults);
        if (!d.running) clearInterval(poll.current);
      }).catch(function() {});
    }, 600);

    var cap = parseFloat(minCap) * 1e9;
    var scanUrl = "/api/scan?minVolumeRatio=" + minRatio + "&minMarketCap=" + cap;
    if (minPrice) scanUrl += "&minPrice=" + minPrice;
    if (maxPrice) scanUrl += "&maxPrice=" + maxPrice;
    if (minVol) scanUrl += "&minVol=" + encodeURIComponent(minVol);
    if (scanMode === "sectors" && selectedSectors.length > 0) {
      scanUrl += "&sectors=" + encodeURIComponent(selectedSectors.join(","));
    } else if (scanMode === "nasdaq100") {
      scanUrl += "&list=nasdaq100";
    } else if (scanMode === "sp500") {
      scanUrl += "&list=sp500";
    }
    fetch(scanUrl, { headers: { Authorization: "Bearer " + getToken() } }).then(function(r) {
      if (r.status === 401) { setShowAuthModal(true); throw new Error("Sign in to run a scan"); }
      if (r.status === 403) return r.json().then(function(d) { throw Object.assign(new Error(d.error || "Limit reached"), { code: d.code }); });
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || "Scan failed"); });
      return r.json();
    }).then(function(d) {
      setResults(d.results);
      setScanTime(d.scanTime);
      setMarketClosed(!!d.marketClosed);
      setScanMeta({ tier: d.tier, isPremium: d.isPremium, premium: d.premium, free: d.free });
    }).catch(function(e) {
      if (e.code === "SCAN_LIMIT") { setShowUpgradeModal(true); return; }
      setError(e.message);
    }).finally(function() {
      setScanning(false);
      setProgress(null);
      clearInterval(poll.current);
    });
  }, [minRatio, minCap, minPrice, maxPrice, minVol, scanMode, selectedSectors, isPremium, scanMeta, user, getToken, setScanMeta]);

  const handleSort = function(f) {
    setSortDir(sortField === f ? (sortDir === "asc" ? "desc" : "asc") : "desc");
    setSortField(f);
  };

  const handleSortDoubleClick = function() {
    setSortField("volumeRatio");
    setSortDir("desc");
  };


  const filtered = results ? results.filter(function(r) {
    if (search) {
      var q = search.toLowerCase();
      if (!r.symbol.toLowerCase().includes(q) && !(r.name || "").toLowerCase().includes(q)) return false;
    }
    if (sectorFilter !== "All" && r.sector !== sectorFilter) return false;
    if (minPrice && r.price < parseFloat(minPrice)) return false;
    if (maxPrice && r.price > parseFloat(maxPrice)) return false;
    /* New filters */
    if (minChange && r.change < parseFloat(minChange)) return false;
    if (maxChange && r.change > parseFloat(maxChange)) return false;
    if (exchangeFilter !== "All" && r.exchange !== exchangeFilter) return false;
    if (minVol) {
      var minVolNum = parseVolInput(minVol);
      if (minVolNum > 0 && r.volume < minVolNum) return false;
    }
    return true;
  }) : [];

  const sorted = [].concat(filtered).sort(function(a, b) {
    var av = a[sortField], bv = b[sortField];
    if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === "asc" ? av - bv : bv - av;
  });

  const allSectors = results ? [].concat(new Set(results.map(function(r) { return r.sector; }).filter(Boolean).filter(function(s) { return s !== "N/A"; }))).sort() : [];
  /* Deduplicate sectors since spread on Set doesn't work in all Babel envs */
  var sectorSet = {};
  if (results) {
    results.forEach(function(r) {
      if (r.sector && r.sector !== "N/A") sectorSet[r.sector] = true;
    });
  }
  var uniqueSectors = Object.keys(sectorSet).sort();

  const TH = function(props) {
    return (
      <th className={sortField === props.field ? "active" : ""} onClick={function() { if (isPremium) handleSort(props.field); }} onDoubleClick={function() { if (isPremium) handleSortDoubleClick(); }} style={isPremium ? {} : { cursor: "default" }}>
        {props.label}{sortField === props.field && isPremium && <span className="sort-icon">{sortDir === "asc" ? "▲" : "▼"}</span>}
      </th>
    );
  };

  return (
    React.createElement(React.Fragment, null,

      React.createElement(Toast, { message: toastMsg, show: toastShow, onClose: function() { setToastShow(false); } }),

      /* Pilot confidentiality gate — blocks the app until a pilot tester accepts */
      !!(user && user.is_pilot) && !user.pilot_terms_accepted_at && React.createElement("div", {
        className: "upgrade-overlay", style: { zIndex: 10000 }
      },
        React.createElement("div", { className: "upgrade-modal", style: { maxWidth: 460 } },
          React.createElement("h2", { className: "upgrade-title" }, "Pilot Program — Confidential"),
          React.createElement("p", { className: "upgrade-desc", style: { textAlign: "left", lineHeight: 1.6 } },
            "You've been given early access to Capital Flow as part of a limited pilot. ",
            "This access is personal to your account — please don't share your login, ",
            "and treat the product, its design, and its data as confidential. ",
            "Your feedback is exactly what we're here for — thank you for trying it out."
          ),
          React.createElement("button", {
            className: "upgrade-cta",
            onClick: function() { acceptPilotTerms(); }
          }, "I Agree — Continue"),
          React.createElement("p", { className: "upgrade-sub" },
            React.createElement("a", { href: "#", onClick: function(e) { e.preventDefault(); logout(); } }, "Sign out instead")
          )
        )
      ),

      /* Pilot watermark — traceable if a screenshot ever leaks */
      !!(user && user.is_pilot) && user.pilot_terms_accepted_at && React.createElement("div", {
        style: {
          position: "fixed", bottom: 10, right: 12, zIndex: 9999,
          fontSize: 10, fontFamily: "var(--mono)", letterSpacing: "0.04em",
          color: "rgba(168,85,247,0.55)", background: "rgba(168,85,247,0.08)",
          border: "1px solid rgba(168,85,247,0.2)", borderRadius: 100,
          padding: "3px 10px", pointerEvents: "none", userSelect: "none",
        }
      }, "PILOT · CONFIDENTIAL · " + user.email),

      showAuthModal && React.createElement(Suspense, { fallback: null },
        React.createElement(AuthModal, { onClose: function() { setShowAuthModal(false); } })
      ),

      React.createElement(PushPermissionPrompt, { user: user }),

      showUpgradeModal && React.createElement(UpgradeModal, { userTier: userTier, onClose: function() { setShowUpgradeModal(false); } }),

      React.createElement("div", { className: "app" },
        /* ── Topbar ── */
        React.createElement("header", { className: "topbar" },
          React.createElement("div", { className: "topbar-left" },
            React.createElement("div", { className: "logo-mark" },
              React.createElement("div", { className: "logo-bar" }),
              React.createElement("div", { className: "logo-bar" }),
              React.createElement("div", { className: "logo-bar" })
            ),
            React.createElement("div", { className: "logo-text" },
              React.createElement("h1", null,
                React.createElement("strong", null, "Capital"),
                " Flow"
              ),
            )
          ),
          React.createElement("div", { className: "topbar-right" },
            isElite
              ? React.createElement("span", { className: "topbar-premium-badge tier-elite" }, "ELITE EDITION")
              : isPremium
                ? React.createElement(React.Fragment, null,
                    React.createElement("span", { className: "topbar-premium-badge tier-premium" }, "PREMIUM"),
                    React.createElement("button", {
                      className: "topbar-upgrade-btn",
                      onClick: function() { setShowUpgradeModal(true); }
                    }, "Upgrade to Elite")
                  )
                : user
                  ? React.createElement("button", {
                      className: "topbar-upgrade-btn",
                      onClick: function() { setShowUpgradeModal(true); }
                    },
                      React.createElement("svg", { width: 11, height: 11, viewBox: "0 0 24 24", fill: "currentColor" },
                        React.createElement("path", { d: "M13 2L3 14h9l-1 8 10-12h-9l1-8z" })
                      ),
                      "Upgrade Subscription"
                    )
                  : React.createElement(React.Fragment, null,
                    React.createElement("button", {
                      className: "topbar-upgrade-btn",
                      onClick: function() { setShowAuthModal(true); }
                    },
                      React.createElement("svg", { width: 11, height: 11, viewBox: "0 0 24 24", fill: "currentColor" },
                        React.createElement("path", { d: "M13 2L3 14h9l-1 8 10-12h-9l1-8z" })
                      ),
                      "Upgrade Subscription"
                    ),
                    React.createElement("button", {
                      className: "topbar-signin-btn",
                      onClick: function() { setShowAuthModal(true); }
                    }, "Sign In")
                  ),
            user && user.is_admin && React.createElement("button", {
              className: "topbar-admin-btn",
              onClick: function() { window.open('/admin?jwt=' + getToken(), '_blank'); },
              title: "Admin Panel"
            }, "Admin"),
            user && React.createElement("button", {
              className: "topbar-logout-btn",
              onClick: logout,
              title: "Sign out"
            }, "Log Out"),
            React.createElement(AlertBell, {
              notificationsEnabled: notificationsEnabled,
              showAlertPanel: showAlertPanel,
              onBellClick: handleBellClick,
              unreadCount: unreadCount,
              alertHistory: alertHistory,
              onClearAll: clearAllAlerts,
              onClosePanel: function() { setShowAlertPanel(false); },
              onRemoveAlert: removeAlertFromHistory,
              onToggleNotifications: toggleNotifications,
            }),
            page === "scanner" && results && !scanning && React.createElement(React.Fragment, null,
              React.createElement("button", { className: "scan-btn", onClick: function() { setResults(null); setScanTime(null); } },
                "New Scan"
              ),
              !isPremium && scanMeta && scanMeta.tier === "premium" && React.createElement("span", { className: "scan-limit-topbar" },
                (scanMeta.premium ? scanMeta.premium.used : 0) + "/5 today"
              ),
              !isPremium && scanMeta && scanMeta.tier === "free" && React.createElement("span", { className: "scan-limit-topbar" },
                categoryQuota(scanMeta, "capitalFlow").exhausted ? "Trial used" : "1 free scan"
              )
            )
          )
        ),

        /* ── Nav Tabs ── */
        React.createElement("nav", { className: "nav-tabs" },
          React.createElement("button", { className: "nav-tab " + (page === "scanner" ? "active" : ""), onClick: function() { setPage("scanner"); } },
            "Capital Flow"
          ),
          React.createElement("button", { className: "nav-tab " + (page === "flow" ? "active" : ""), onClick: function() { setPage("flow"); } },
            "Sector Moving"
          ),
          React.createElement("button", { className: "nav-tab " + (page === "ma" ? "active" : ""), onClick: function() { setPage("ma"); } },
            "MA Scanner"
          ),
          React.createElement("button", { className: "nav-tab " + (page === "watchlist" ? "active" : ""), onClick: function() { setPage("watchlist"); } },
            "Watchlist",
            watchlist.length > 0 && React.createElement("span", { className: "tab-badge" }, watchlist.length)
          ),
        ),

        /* ── Pages ── */
        page === "ma" && React.createElement(Suspense, { fallback: React.createElement("div", { className: "page-loading" }, "Loading…") },
          React.createElement(MAScannerPage, { onOpenChart: openChart, onSignIn: function() { setShowAuthModal(true); } })
        ),

        page === "flow" && React.createElement(Suspense, { fallback: React.createElement("div", { className: "page-loading" }, "Loading…") },
          React.createElement(MoneyFlow, { theme: theme, setShowUpgradeModal: setShowUpgradeModal, onSignIn: function() { setShowAuthModal(true); } })
        ),

        /* ── Watchlist Page ── */
        page === "watchlist" && React.createElement("div", { className: "page-content" },
          React.createElement("div", { className: "flow-header" },
            React.createElement("div", null,
              React.createElement("h2", { className: "flow-title" }, "Watchlist"),
              React.createElement("p", { className: "flow-sub" }, "Track your favorite tickers across sessions")
            ),
            React.createElement("div", { style: { display: "flex", gap: 8 } },
              watchlist.length > 0 && React.createElement("button", { className: "scan-btn", onClick: refreshWatchlist, disabled: watchlistLoading },
                watchlistLoading ? React.createElement(React.Fragment, null, React.createElement("div", { className: "spinner" }), " Refreshing...") : "Refresh Quotes"
              )
            )
          ),

          /* ── Notification Settings — Elite only; push/scheduled-scan/alert-thresholds are what "no notifications" excludes for Premium ── */
          user && !isElite && React.createElement("div", { className: "notif-settings-panel notif-settings-upsell" },
            React.createElement("div", { className: "notif-settings-row" },
              React.createElement("div", null,
                React.createElement("div", { className: "notif-settings-title" }, "Push Notifications & Scheduled Scans"),
                React.createElement("div", { className: "notif-settings-sub" }, "Elite feature — get notified the instant a ticker crosses your threshold, even with the app closed.")
              ),
              React.createElement("button", { className: "notif-toggle-btn", onClick: function() { setShowUpgradeModal(true); } }, "Upgrade to Elite")
            )
          ),

          isElite && React.createElement("div", { className: "notif-settings-panel" },
            React.createElement("div", { className: "notif-settings-row" },
              React.createElement("div", null,
                React.createElement("div", { className: "notif-settings-title" }, "Push Notifications"),
                React.createElement("div", { className: "notif-settings-sub" },
                  "Get notified the moment a watchlist ticker crosses its alert threshold — even when the app is closed."
                )
              ),
              !pushSupported
                ? React.createElement("span", { className: "notif-settings-unsupported" }, "Not supported in this browser")
                : React.createElement("button", {
                    className: "notif-toggle-btn" + (pushEnabled ? " on" : ""),
                    onClick: pushEnabled ? disablePush : enablePush,
                    disabled: pushBusy,
                  }, pushBusy ? "..." : (pushEnabled ? "Enabled" : "Enable"))
            ),
            pushError && React.createElement("div", { className: "notif-settings-error" }, pushError),
            pushSupported && pushEnabled && React.createElement("div", { className: "notif-settings-row" },
              React.createElement("div", null,
                React.createElement("div", { className: "notif-settings-title" }, "Daily Scan Time"),
                React.createElement("div", { className: "notif-settings-sub" }, "Pick a time (Israel time) — the app scans on its own and sends you a summary, no need to open it.")
              ),
              React.createElement("input", {
                type: "time",
                className: "notif-time-input",
                value: notifTime,
                onChange: function(e) { saveNotifTime(e.target.value); },
              })
            )
          ),

          watchlistError && React.createElement("div", { className: "error-bar error-bar-action" },
            React.createElement("div", { className: "error-bar-content" },
              React.createElement("span", null, watchlistError)
            ),
            React.createElement("div", { className: "error-bar-actions" },
              React.createElement("button", { className: "error-retry-btn", onClick: refreshWatchlist }, "Retry"),
              React.createElement("button", { className: "error-dismiss-btn", onClick: function() { setWatchlistError(null); } }, "Dismiss")
            )
          ),
          watchlist.length === 0 ? React.createElement("div", { className: "empty" },
            React.createElement("div", { className: "empty-icon" },
              React.createElement("svg", { viewBox: "0 0 24 24", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" },
                React.createElement("polygon", { points: "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" })
              )
            ),
            React.createElement("h2", null, "Your Watchlist is Empty"),
            React.createElement("p", null, "Run a scan and click the star icon next to any ticker to add it to your watchlist.")
          ) : React.createElement("div", { className: "table-card" },
            React.createElement("div", { className: "table-bar" },
              React.createElement("div", null,
                React.createElement("h2", null, watchlist.length + " Ticker" + (watchlist.length !== 1 ? "s" : "")),
                React.createElement("span", { className: "table-bar-sub" }, watchlistData ? "Last refreshed " + new Date().toLocaleTimeString() : "Click Refresh to load latest quotes")
              )
            ),
            React.createElement("div", { className: "table-wrap" },
              React.createElement("table", null,
                React.createElement("thead", null,
                  React.createElement("tr", null,
                    React.createElement("th", { style: { width: 36 } }, ""),
                    React.createElement("th", null, "Ticker"),
                    React.createElement("th", null, "Name"),
                    React.createElement("th", null, "Price"),
                    React.createElement("th", null, "Change"),
                    React.createElement("th", null, "Vol Ratio"),
                    React.createElement("th", null, "Mkt Cap"),
                    React.createElement("th", { style: { width: 40 } }, "")
                  )
                ),
                React.createElement("tbody", null,
                  watchlist.map(function(sym) {
                    var d = watchlistData ? watchlistData.find(function(r) { return r.symbol === sym; }) : null;
                    return React.createElement("tr", { key: sym },
                      React.createElement("td", null,
                        React.createElement("button", {
                          className: "star-btn starred",
                          onClick: function() { toggleWatchlistTicker(sym); },
                          title: "Remove from watchlist"
                        },
                          React.createElement("svg", { viewBox: "0 0 24 24", width: 14, height: 14, fill: "var(--accent)", stroke: "var(--accent)", strokeWidth: 2 },
                            React.createElement("polygon", { points: "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" })
                          )
                        )
                      ),
                      React.createElement("td", { className: "col-ticker" },
                        React.createElement("div", { className: "ticker-cell" },
                          React.createElement("img", {
                            className: "ticker-logo",
                            src: "https://assets.parqet.com/logos/symbol/" + sym,
                            alt: "", width: 18, height: 18,
                            onError: function(e) { e.target.style.display = "none"; }
                          }),
                          sym
                        )
                      ),
                      d ? React.createElement(React.Fragment, null,
                        React.createElement("td", { className: "col-name" }, d.name),
                        React.createElement("td", null, "$" + d.price.toFixed(2)),
                        React.createElement("td", { className: d.change >= 0 ? "col-pos" : "col-neg" },
                          (d.change >= 0 ? "+" : "") + d.change.toFixed(2) + "%"
                        ),
                        React.createElement("td", null,
                          d.volumeRatio > 0 ? React.createElement("span", {
                            className: "ratio-pill " + (d.volumeRatio >= 5 ? "hot" : d.volumeRatio >= 2 ? "warm" : "ok")
                          }, d.volumeRatio + "x") : "—"
                        ),
                        React.createElement("td", null, d.marketCap ? fmt(d.marketCap) : "—")
                      ) : watchlistLoading ? React.createElement(React.Fragment, null,
                        React.createElement("td", null, React.createElement("span", { className: "skel skel-text" })),
                        React.createElement("td", null, React.createElement("span", { className: "skel skel-num" })),
                        React.createElement("td", null, React.createElement("span", { className: "skel skel-num" })),
                        React.createElement("td", null, React.createElement("span", { className: "skel skel-pill" })),
                        React.createElement("td", null, React.createElement("span", { className: "skel skel-num" }))
                      ) : React.createElement(React.Fragment, null,
                        React.createElement("td", { className: "col-name", style: { color: "var(--text-3)" } }, watchlistData ? "Not found" : "—"),
                        React.createElement("td", null, "—"),
                        React.createElement("td", null, "—"),
                        React.createElement("td", null, "—"),
                        React.createElement("td", null, "—")
                      ),
                      React.createElement("td", { style: { display: "flex", gap: 4, alignItems: "center" } },
                        React.createElement("button", {
                          className: "chart-open-btn",
                          onClick: function() { openChart(sym, d ? d.name : sym); },
                          title: "Open chart"
                        }, "📈"),
                        React.createElement("button", {
                          className: "star-btn-remove",
                          onClick: function() { toggleWatchlistTicker(sym); },
                          title: "Remove"
                        }, "\xd7")
                      )
                    );
                  })
                )
              )
            ),
            /* Mobile watchlist cards */
            React.createElement("div", { className: "mobile-cards" },
              watchlist.map(function(sym) {
                var d = watchlistData ? watchlistData.find(function(r) { return r.symbol === sym; }) : null;
                return React.createElement("div", { key: sym, className: "mobile-card ratio-ok" },
                  React.createElement("div", { className: "mobile-card-top" },
                    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
                      React.createElement("button", {
                        className: "star-btn starred",
                        onClick: function() { toggleWatchlistTicker(sym); }
                      },
                        React.createElement("svg", { viewBox: "0 0 24 24", width: 14, height: 14, fill: "var(--accent)", stroke: "var(--accent)", strokeWidth: 2 },
                          React.createElement("polygon", { points: "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" })
                        )
                      ),
                      React.createElement("span", { className: "mobile-card-ticker" }, sym),
                      d && React.createElement("span", { className: "mobile-card-name" }, d.name),
                      !d && watchlistLoading && React.createElement("span", { className: "skel skel-text" })
                    )
                  ),
                  d && React.createElement("div", { className: "mobile-card-mid" },
                    React.createElement("span", { className: "mobile-card-price" }, "$" + d.price.toFixed(2)),
                    React.createElement("span", { className: "mobile-card-change " + (d.change >= 0 ? "pos" : "neg") },
                      (d.change >= 0 ? "+" : "") + d.change.toFixed(2) + "%"
                    )
                  ),
                  !d && watchlistLoading && React.createElement("div", { className: "mobile-card-mid" },
                    React.createElement("span", { className: "skel skel-num" }),
                    React.createElement("span", { className: "skel skel-num" })
                  ),
                  d && React.createElement("div", { className: "mobile-card-bottom" },
                    React.createElement("span", { className: "mobile-card-ratio" },
                      d.volumeRatio > 0 ? React.createElement("span", { className: "ratio-pill " + (d.volumeRatio >= 5 ? "hot" : d.volumeRatio >= 2 ? "warm" : "ok") }, d.volumeRatio + "x") : "—"
                    ),
                    React.createElement("span", { className: "mobile-card-vol" }, d.marketCap ? fmt(d.marketCap) : "")
                  )
                );
              })
            ),
            watchlistLoading && React.createElement("div", { className: "table-footer" }, "Loading quotes...")
          )
        ),

        page === "scanner" && React.createElement("div", { className: "page-content" },

          /* Scanning: Radar + Live Results Feed */
          scanning && progress && (
            React.createElement("div", { className: "scan-live-wrap" },

              /* Radar */
              React.createElement("div", { className: "scan-radar-section" },
                React.createElement("div", { className: "scan-radar" },
                  React.createElement("div", { className: "radar-ring ring-1" }),
                  React.createElement("div", { className: "radar-ring ring-2" }),
                  React.createElement("div", { className: "radar-ring ring-3" }),
                  React.createElement("div", { className: "radar-sweep" }),
                  liveResults.length > 0 && liveResults.slice(-5).map(function(r, i) {
                    var angle = (i * 72 + 30) * Math.PI / 180;
                    var dist = 25 + (i % 3) * 15;
                    var x = 50 + Math.cos(angle) * dist;
                    var y = 50 + Math.sin(angle) * dist;
                    return React.createElement("div", {
                      key: r.symbol, className: "radar-blip",
                      style: { left: x + "%", top: y + "%" }
                    }, r.symbol);
                  })
                ),
                React.createElement("div", { className: "radar-info" },
                  React.createElement("div", { className: "radar-pct" }, Math.round(progress.processed / progress.total * 100) + "%"),
                  React.createElement("div", { className: "radar-stat" }, "Scanning the market..."),
                  React.createElement("div", { className: "radar-stat accent" }, progress.found + " volume spike" + (progress.found !== 1 ? "s" : "") + " detected")
                )
              ),

              /* Scan loader — ticker tape + live match count */
              React.createElement(ScanLoader, {
                label: "FULL SCAN",
                matches: progress.found || 0,
                statusMessages: [
                  "Scanning the market for unusual volume…",
                  "Cross-referencing live price and volume data…",
                  "Checking every sector for movement…",
                  "Comparing against historical averages…",
                ],
              }),

              /* Live Results Feed */
              liveResults.length > 0 && React.createElement("div", { className: "live-feed" },
                React.createElement("div", { className: "live-feed-header" },
                  React.createElement("span", { className: "live-dot" }),
                  React.createElement("span", null, "Live Results")
                ),
                React.createElement("div", { className: "live-feed-list" },
                  liveResults.slice().reverse().map(function(r) {
                    return React.createElement("div", { key: r.symbol, className: "live-feed-card" },
                      React.createElement("div", { className: "live-feed-left" },
                        React.createElement("span", { className: "live-feed-sym" }, r.symbol),
                        React.createElement("span", { className: "live-feed-name" }, r.name)
                      ),
                      React.createElement("div", { className: "live-feed-right" },
                        React.createElement("span", { className: "live-feed-ratio" }, r.volumeRatio + "x"),
                        React.createElement("span", { className: "live-feed-price" }, "$" + r.price.toFixed(2)),
                        React.createElement("span", { className: r.change >= 0 ? "live-feed-chg up" : "live-feed-chg down" },
                          (r.change >= 0 ? "+" : "") + r.change.toFixed(2) + "%"
                        )
                      )
                    );
                  })
                )
              )
            )
          ),

          error && React.createElement("div", { className: "error-bar error-bar-action" },
            React.createElement("div", { className: "error-bar-content" },
              React.createElement("svg", { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", style: { flexShrink: 0 } },
                React.createElement("circle", { cx: "12", cy: "12", r: "10" }),
                React.createElement("line", { x1: "12", y1: "8", x2: "12", y2: "12" }),
                React.createElement("line", { x1: "12", y1: "16", x2: "12.01", y2: "16" })
              ),
              React.createElement("span", null, friendlyError(error))
            ),
            React.createElement("div", { className: "error-bar-actions" },
              error !== "Scan already in progress" && React.createElement("button", { className: "error-retry-btn", onClick: function() { setError(null); startScan(); } }, "Retry"),
              React.createElement("button", { className: "error-dismiss-btn", onClick: function() { setError(null); } }, "Dismiss")
            )
          ),

          /* Filter nudge banner — shown above the filters (both the pre-scan
             scan-filters-panel and the post-scan filter-strip trigger it) */
          showFilterNudge && React.createElement("div", { className: "filter-nudge" },
            React.createElement("span", null, "Custom filters require Premium — but you can still run a scan with default settings!"),
            React.createElement("button", { className: "filter-nudge-upgrade", onClick: function() { setShowFilterNudge(false); setShowUpgradeModal(true); } }, "Upgrade $19.90 — Lifetime Access"),
            React.createElement("button", { className: "filter-nudge-close", onClick: function() { setShowFilterNudge(false); } }, "\xd7")
          ),

          /* Scan mode selector — shown before scanning, FIRST thing user sees */
          !results && !scanning && React.createElement("div", { className: "scan-mode-wrap" },
            React.createElement("div", { className: "scan-mode-header" },
              React.createElement("h2", { className: "scan-mode-title" }, "Select Universe"),
              React.createElement("p", { className: "scan-mode-sub" }, "Choose which stocks to scan for unusual volume activity")
            ),

            React.createElement("div", { className: "scan-filters-panel" },
              React.createElement("div", { className: "scan-filter-group", style: { "--filter-color": "#06B6D4" }, onClick: !isPremium ? function() { triggerFilterNudge(); } : undefined },
                React.createElement("span", { className: "scan-filter-label" }, "Min Ratio"),
                React.createElement("div", { className: "scan-filter-input-row" },
                  React.createElement("input", { className: "scan-filter-input", type: "number", step: "0.5", min: "1", value: minRatio, onChange: isPremium ? function(e) { setMinRatio(e.target.value); } : undefined, readOnly: !isPremium })
                )
              ),
              React.createElement("div", { className: "scan-filter-group", style: { "--filter-color": "#22C55E" }, onClick: !isPremium ? function() { triggerFilterNudge(); } : undefined },
                React.createElement("span", { className: "scan-filter-label" }, "Min Cap $B"),
                React.createElement("div", { className: "scan-filter-input-row" },
                  React.createElement("input", { className: "scan-filter-input", type: "number", step: "0.5", min: "0", value: minCap, onChange: isPremium ? function(e) { setMinCap(e.target.value); } : undefined, readOnly: !isPremium })
                )
              ),
              React.createElement("div", { className: "scan-filter-group", style: { "--filter-color": "#F59E0B" }, onClick: !isPremium ? function() { triggerFilterNudge(); } : undefined },
                React.createElement("span", { className: "scan-filter-label" }, "Min Vol"),
                React.createElement("div", { className: "scan-filter-input-row" },
                  React.createElement("input", { className: "scan-filter-input", type: "text", placeholder: "e.g. 1M", value: minVol, onChange: isPremium ? function(e) { setMinVol(e.target.value); } : undefined, readOnly: !isPremium })
                )
              )
            ),

            React.createElement("div", { className: "scan-mode-options" },
              (function() {
                var now = new Date();
                var etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
                var et = new Date(etStr);
                var day = et.getDay();
                var mins = et.getHours() * 60 + et.getMinutes();
                var mktOpen = day !== 0 && day !== 6 && mins >= 570 && mins < 960;
                var lastCount = results ? results.length : null;

                function makeCard(cfg) {
                  var isActive = scanMode === cfg.mode;
                  return React.createElement("button", {
                    key: cfg.mode,
                    className: "scan-mode-card" + (isActive ? " active" : ""),
                    onClick: cfg.onClick,
                    style: { "--card-color": cfg.color, "--card-rgb": cfg.rgb }
                  },
                    React.createElement("div", { className: "scan-mode-glow" }),
                    React.createElement("div", { className: "scan-mode-icon-wrap" }, cfg.icon),
                    React.createElement("div", { className: "scan-mode-label" }, cfg.label),
                    React.createElement("div", { className: "scan-mode-desc" }, cfg.desc),
                    (lastCount !== null || mktOpen) && React.createElement("div", { className: "scan-mode-data-strip" },
                      lastCount !== null && React.createElement("div", { className: "scan-mode-stat" },
                        React.createElement("span", { className: "scan-mode-stat-label" }, "LAST"),
                        React.createElement("span", {
                          className: "scan-mode-stat-val",
                          style: { color: lastCount > 0 ? "var(--accent)" : "var(--text-3)" }
                        }, lastCount + " spike" + (lastCount !== 1 ? "s" : ""))
                      ),
                      mktOpen && React.createElement("div", { className: "scan-mode-stat", style: { marginLeft: "auto" } },
                        React.createElement("div", { className: "scan-mode-live-dot" }),
                        React.createElement("span", { className: "scan-mode-stat-val", style: { color: "var(--green)" } }, "LIVE")
                      )
                    )
                  );
                }

                return [
                  makeCard({
                    mode: "all", color: "#06B6D4", rgb: "6,182,212",
                    label: "Full Scan", desc: "S&P 500 + NASDAQ 100 + all sectors combined",
                    meta: "~516 tickers", est: "~45 sec",
                    onClick: function() { setScanMode("all"); setSelectedSectors([]); },
                    icon: React.createElement("svg", { viewBox: "0 0 24 24", width: "24", height: "24", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" },
                      React.createElement("circle", { cx: "12", cy: "12", r: "10" }),
                      React.createElement("path", { d: "M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" })
                    )
                  }),
                  makeCard({
                    mode: "sp500", color: "#22C55E", rgb: "34,197,94",
                    label: "S&P 500", desc: "America's 500 largest public companies by market cap",
                    meta: "500 tickers", est: "~35 sec",
                    onClick: function() { setScanMode("sp500"); setSelectedSectors([]); },
                    icon: React.createElement("svg", { viewBox: "0 0 24 24", width: "24", height: "24", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" },
                      React.createElement("path", { d: "M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 9h.01M15 9h.01M9 13h.01M15 13h.01" })
                    )
                  }),
                  makeCard({
                    mode: "nasdaq100", color: "#3B82F6", rgb: "59,130,246",
                    label: "NASDAQ 100", desc: "Top 100 innovative and tech-dominant companies",
                    meta: "100 tickers", est: "~8 sec",
                    onClick: function() { setScanMode("nasdaq100"); setSelectedSectors([]); },
                    icon: React.createElement("svg", { viewBox: "0 0 24 24", width: "24", height: "24", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" },
                      React.createElement("polyline", { points: "22 12 18 12 15 21 9 3 6 12 2 12" })
                    )
                  }),
                  makeCard({
                    mode: "sectors", color: "#F59E0B", rgb: "245,158,11",
                    label: "By Sector", desc: "Target specific industries — top 5 holdings per sector",
                    meta: "5 per sector", est: "~5 sec",
                    onClick: function() { setScanMode("sectors"); },
                    icon: React.createElement("svg", { viewBox: "0 0 24 24", width: "24", height: "24", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" },
                      React.createElement("circle", { cx: "12", cy: "12", r: "10" }),
                      React.createElement("path", { d: "M12 2v10l7 4" }),
                      React.createElement("path", { d: "M12 12l-7 4" })
                    )
                  }),
                ];
              })()
            ),

            /* Sector grid — only when "By Sector" is selected */
            scanMode === "sectors" && React.createElement("div", { className: "sector-grid-wrap" },
              React.createElement("div", { className: "sector-grid-header" },
                React.createElement("span", null, "Select Sectors"),
                selectedSectors.length > 0 && React.createElement("button", { className: "sector-clear", onClick: function() { setSelectedSectors([]); } }, "Clear all")
              ),
              React.createElement("div", { className: "sector-grid" },
                ALL_SECTORS.map(function(s) {
                  var active = selectedSectors.indexOf(s) >= 0;
                  var iconMap = {
                    "Technology": React.createElement("svg", { viewBox: "0 0 24 24", width: 20, height: 20, fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" },
                      React.createElement("rect", { x: "2", y: "3", width: "20", height: "14", rx: "2" }),
                      React.createElement("path", { d: "M8 21h8M12 17v4" })
                    ),
                    "Financials": React.createElement("svg", { viewBox: "0 0 24 24", width: 20, height: 20, fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" },
                      React.createElement("path", { d: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" })
                    ),
                    "Health Care": React.createElement("svg", { viewBox: "0 0 24 24", width: 20, height: 20, fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" },
                      React.createElement("path", { d: "M22 12h-4l-3 9L9 3l-3 9H2" })
                    ),
                    "Consumer Discretionary": React.createElement("svg", { viewBox: "0 0 24 24", width: 20, height: 20, fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" },
                      React.createElement("circle", { cx: "9", cy: "21", r: "1" }),
                      React.createElement("circle", { cx: "20", cy: "21", r: "1" }),
                      React.createElement("path", { d: "M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" })
                    ),
                    "Consumer Staples": React.createElement("svg", { viewBox: "0 0 24 24", width: 20, height: 20, fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" },
                      React.createElement("path", { d: "M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0" })
                    ),
                    "Energy": React.createElement("svg", { viewBox: "0 0 24 24", width: 20, height: 20, fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" },
                      React.createElement("polygon", { points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2" })
                    ),
                    "Industrials": React.createElement("svg", { viewBox: "0 0 24 24", width: 20, height: 20, fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" },
                      React.createElement("path", { d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" })
                    ),
                    "Materials": React.createElement("svg", { viewBox: "0 0 24 24", width: 20, height: 20, fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" },
                      React.createElement("path", { d: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" }),
                      React.createElement("polyline", { points: "3.27 6.96 12 12.01 20.73 6.96" }),
                      React.createElement("line", { x1: "12", y1: "22.08", x2: "12", y2: "12" })
                    ),
                    "Real Estate": React.createElement("svg", { viewBox: "0 0 24 24", width: 20, height: 20, fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" },
                      React.createElement("path", { d: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" }),
                      React.createElement("polyline", { points: "9 22 9 12 15 12 15 22" })
                    ),
                    "Utilities": React.createElement("svg", { viewBox: "0 0 24 24", width: 20, height: 20, fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" },
                      React.createElement("circle", { cx: "12", cy: "12", r: "5" }),
                      React.createElement("path", { d: "M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" })
                    ),
                    "Communication Services": React.createElement("svg", { viewBox: "0 0 24 24", width: 20, height: 20, fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" },
                      React.createElement("path", { d: "M5.5 1.5A2.5 2.5 0 0 1 8 4v16a2.5 2.5 0 0 1-5 0V4a2.5 2.5 0 0 1 2.5-2.5z" }),
                      React.createElement("path", { d: "M12 8a4 4 0 0 1 0 8" }),
                      React.createElement("path", { d: "M16 4a8 8 0 0 1 0 16" })
                    ),
                    "Semiconductors": React.createElement("svg", { viewBox: "0 0 24 24", width: 20, height: 20, fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" },
                      React.createElement("rect", { x: "4", y: "4", width: "16", height: "16", rx: "2" }),
                      React.createElement("rect", { x: "9", y: "9", width: "6", height: "6" }),
                      React.createElement("path", { d: "M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" })
                    )
                  };
                  return React.createElement("button", {
                    key: s,
                    className: "sector-card" + (active ? " active" : ""),
                    onClick: function() { toggleSector(s); }
                  },
                    React.createElement("div", { className: "sector-card-glow" }),
                    React.createElement("div", { className: "sector-card-icon" }, iconMap[s] || null),
                    React.createElement("div", { className: "sector-card-name" }, s),
                    React.createElement("div", { className: "sector-card-count" }, "5 tickers")
                  );
                })
              ),
              selectedSectors.length === 0 && React.createElement("div", { className: "sector-hint" }, "No sectors selected — will scan top 5 from all sectors"),
              !isElite && React.createElement("div", { className: "sector-hint" },
                isPremium
                  ? "Premium: up to " + MAX_PREMIUM_SECTORS + " sectors. Upgrade to Elite for unlimited."
                  : "Free tier: up to " + MAX_FREE_SECTORS + " sectors. Upgrade for more."
              ),
              !isElite && selectedSectors.length >= sectorLimit() && React.createElement("div", { className: "sector-limit-badge" }, selectedSectors.length + "/" + sectorLimit() + " sectors selected")
            ),

            scanMode && React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, justifyContent: "center", marginTop: 8 } },
              React.createElement("button", {
                className: "scan-btn scan-mode-go",
                onClick: startScan,
                disabled: scanning
              },
                React.createElement("svg", { viewBox: "0 0 24 24", width: "16", height: "16", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", style: { marginRight: 8 } },
                  React.createElement("polygon", { points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2" })
                ),
                "Run Scan"
              ),
              !isPremium && scanMeta && React.createElement("span", { className: "scan-limit-topbar" },
                scanMeta.tier === "premium"
                  ? (scanMeta.premium ? scanMeta.premium.left : 5) + "/5 scans left today"
                  : categoryQuota(scanMeta, "capitalFlow").exhausted ? "Free trial used" : "1 free scan available"
              )
            )
          ),

          /* Filter strip — only shown after scan completes */
          results && !scanning && React.createElement("div", { className: "filter-strip" },
            React.createElement("div", { className: "filter-chip", onClick: !isPremium ? function() { triggerFilterNudge(); } : undefined },
              React.createElement("label", null, "Min Ratio"),
              React.createElement("input", { type: "number", step: "0.5", min: "1", value: minRatio, onChange: isPremium ? function(e) { setMinRatio(e.target.value); } : undefined, readOnly: !isPremium, style: !isPremium ? { cursor: "pointer" } : undefined })
            ),
            React.createElement("div", { className: "filter-chip", onClick: !isPremium ? function() { triggerFilterNudge(); } : undefined },
              React.createElement("label", null, "Min Cap $B"),
              React.createElement("input", { type: "number", step: "0.5", min: "0", value: minCap, onChange: isPremium ? function(e) { setMinCap(e.target.value); } : undefined, readOnly: !isPremium, style: !isPremium ? { cursor: "pointer" } : undefined })
            ),
            React.createElement("div", { className: "filter-chip", onClick: !isPremium ? function() { triggerFilterNudge(); } : undefined },
              React.createElement("label", null, "Price"),
              React.createElement("input", { type: "number", placeholder: "Min", min: "0", value: minPrice, onChange: isPremium ? function(e) { setMinPrice(e.target.value); } : undefined, readOnly: !isPremium, style: Object.assign({ width: 56 }, !isPremium ? { cursor: "pointer" } : {}) }),
              React.createElement("span", { style: { color: "var(--text-3)", fontSize: 10 } }, "–"),
              React.createElement("input", { type: "number", placeholder: "Max", min: "0", value: maxPrice, onChange: isPremium ? function(e) { setMaxPrice(e.target.value); } : undefined, readOnly: !isPremium, style: Object.assign({ width: 56 }, !isPremium ? { cursor: "pointer" } : {}) })
            ),
            React.createElement("div", { className: "filter-chip", onClick: !isPremium ? function() { triggerFilterNudge(); } : undefined },
              React.createElement("label", null, "Min Vol"),
              React.createElement("input", { type: "text", placeholder: "e.g. 1M", value: minVol, onChange: isPremium ? function(e) { setMinVol(e.target.value); } : undefined, readOnly: !isPremium, style: Object.assign({ width: 56 }, !isPremium ? { cursor: "pointer" } : {}) })
            ),
            React.createElement("button", {
              className: "filter-toggle" + (showPresetPanel ? " active" : ""),
              onClick: isPremium ? function() { setShowPresetPanel(!showPresetPanel); } : function() { triggerFilterNudge(); },
              style: { marginLeft: "auto" }
            }, "Create Preset")
          ),

          /* Preset panel */
          isPremium && showPresetPanel && React.createElement("div", { className: "preset-panel" },
            React.createElement("div", { className: "preset-save" },
              React.createElement("input", {
                type: "text", placeholder: "Preset name...", value: presetName,
                onChange: function(e) { setPresetName(e.target.value); },
                onKeyDown: function(e) { if (e.key === "Enter") savePreset(); },
                className: "preset-input"
              }),
              React.createElement("button", { className: "preset-save-btn", onClick: savePreset }, "Save")
            ),
            presets.length > 0 && React.createElement("div", { className: "preset-list" },
              presets.map(function(p, i) {
                return React.createElement("div", { key: i, className: "preset-item" },
                  React.createElement("button", { className: "preset-load", onClick: function() { loadPreset(p); } }, p.name),
                  React.createElement("span", { className: "preset-detail" },
                    "Ratio " + p.minRatio + " \xb7 Cap $" + p.minCap + "B"
                  ),
                  React.createElement("button", { className: "preset-del", onClick: function() { deletePreset(i); } }, "\xd7")
                );
              })
            )
          ),

          results && marketClosed && React.createElement("div", { className: "last-session-banner" },
            React.createElement("span", { className: "last-session-icon" }, "🕐"),
            React.createElement("span", null,
              "Market closed — showing last session data",
              scanTime && (" · " + new Date(scanTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))
            )
          ),

          results && (
            React.createElement("div", { className: "table-card" },
              React.createElement("div", { className: "table-bar" },
                React.createElement("div", null,
                  React.createElement("h2", null, sorted.length + " Result" + (sorted.length !== 1 ? "s" : "")),
                  scanTime && React.createElement("span", { className: "table-bar-sub" }, "Scanned " + new Date(scanTime).toLocaleString())
                ),
                sorted.length > 50 && React.createElement("span", { className: "load-more-count" },
                  "Showing " + Math.min(visibleCount, sorted.length) + " of " + sorted.length
                )
              ),

              sorted.length === 0 ? (
                React.createElement("div", { className: "no-match" }, "No stocks matched your filters.")
              ) : (
                React.createElement(React.Fragment, null,
                  /* Desktop table */
                  (function() {
                    var visibleResults = sorted.slice(0, visibleCount);
                    return React.createElement(React.Fragment, null,
                  React.createElement("div", { className: "table-wrap" },
                    React.createElement("table", null,
                      React.createElement("thead", null,
                        React.createElement("tr", null,
                          React.createElement("th", { style: { width: 40 } }, "#"),
                          React.createElement(TH, { label: "Ticker", field: "symbol" }),
                          React.createElement(TH, { label: "Name", field: "name" }),
                          React.createElement(TH, { label: "Price", field: "price" }),
                          React.createElement(TH, { label: "Change", field: "change" }),
                          React.createElement(TH, { label: "RVOL", field: "volumeRatio" }),
                          React.createElement("th", null, "Avg / Vol"),
                          React.createElement(TH, { label: "Sector", field: "sector" }),
                          React.createElement("th", { style: { width: 36 } }, "")
                        )
                      ),
                      React.createElement("tbody", null,
                        visibleResults.map(function(r, i) {
                          return React.createElement(React.Fragment, { key: r.symbol },
                            React.createElement("tr", null,
                              React.createElement("td", { className: "col-rank" }, i + 1),
                              React.createElement("td", { className: "col-ticker" },
                                React.createElement("div", { className: "ticker-cell" },
                                  React.createElement("img", {
                                    className: "ticker-logo",
                                    src: "https://assets.parqet.com/logos/symbol/" + r.symbol,
                                    alt: "",
                                    width: 18,
                                    height: 18,
                                    onError: function(e) { e.target.style.display = "none"; }
                                  }),
                                  r.symbol
                                )
                              ),
                              React.createElement("td", { className: "col-name", title: r.name }, r.name),
                              React.createElement("td", null, "$" + r.price.toFixed(2)),
                              React.createElement("td", { className: r.change >= 0 ? "col-pos" : "col-neg" },
                                (r.change >= 0 ? "+" : "") + r.change.toFixed(2) + "%"
                              ),
                              React.createElement("td", null,
                                (r.rvol && r.rvol > 0)
                                  ? React.createElement("div", { style: { display: "inline-flex", flexDirection: "column", alignItems: "center" } },
                                      React.createElement("span", { className: "vol-ratio-pill rvol-active" }, r.rvol + "x"),
                                      React.createElement("div", { className: "rvol-label" }, "RVOL")
                                    )
                                  : React.createElement("span", {
                                      className: "vol-hero" + (r.volumeRatio >= 5 ? " vol-extreme" : r.volumeRatio >= 3 ? " vol-high" : r.volumeRatio >= 2 ? " vol-moderate" : "")
                                    }, r.volumeRatio.toFixed(2) + "x")
                              ),
                              React.createElement("td", null,
                                React.createElement("span", { className: "vol-stack" },
                                  React.createElement("span", { className: "vol-stack-avg" }, fmt(r.avgVolume)),
                                  React.createElement("span", { className: "vol-stack-sep" }, "/"),
                                  React.createElement("span", { className: "vol-stack-cur" }, fmt(r.volume))
                                )
                              ),
                              React.createElement("td", null, React.createElement("span", { className: "sector-chip" }, r.sector)),
                              React.createElement("td", { style: { display: "flex", gap: 4, alignItems: "center" } },
                                React.createElement("a", {
                                  className: "chart-open-btn",
                                  href: "https://www.tradingview.com/chart/?symbol=" + r.symbol,
                                  target: "_blank",
                                  rel: "noopener noreferrer",
                                  title: "Open in TradingView"
                                },
                                  React.createElement("svg", { viewBox: "0 0 24 24", width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
                                    React.createElement("path", { d: "M3 3v18h18" }),
                                    React.createElement("path", { d: "M18.7 8l-5.1 5.1-4-4L3 15.6" })
                                  )
                                ),
                                React.createElement("button", {
                                  className: "alert-create-btn" + ((alertLevels && alertLevels[r.symbol]) ? " active" : ""),
                                  onClick: function() { promptCreateAlert(r.symbol); },
                                  title: (alertLevels && alertLevels[r.symbol]) ? "Alert set at " + alertLevels[r.symbol] + "x — click to edit" : "Create a volume alert"
                                },
                                  React.createElement("svg", { viewBox: "0 0 24 24", width: 12, height: 12, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
                                    React.createElement("path", { d: "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" }),
                                    React.createElement("path", { d: "M13.73 21a2 2 0 0 1-3.46 0" })
                                  ),
                                  (alertLevels && alertLevels[r.symbol]) ? alertLevels[r.symbol] + "x" : "Alert"
                                ),
                                React.createElement("button", {
                                  className: "star-btn" + (isInWatchlist(r.symbol) ? " starred" : ""),
                                  onClick: function(e) { e.stopPropagation(); toggleWatchlistTicker(r.symbol); },
                                  title: isInWatchlist(r.symbol) ? "Remove from watchlist" : "Add to watchlist"
                                },
                                  React.createElement("svg", { viewBox: "0 0 24 24", width: 14, height: 14, fill: isInWatchlist(r.symbol) ? "var(--accent)" : "none", stroke: isInWatchlist(r.symbol) ? "var(--accent)" : "var(--text-3)", strokeWidth: 2 },
                                    React.createElement("polygon", { points: "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" })
                                  )
                                )
                              )
                            )
                          );
                        })
                      )
                    )
                  ),
                  sorted.length > visibleCount && React.createElement("div", { className: "load-more-row" },
                    React.createElement("button", {
                      className: "load-more-btn",
                      onClick: function() { setVisibleCount(function(c) { return c + 50; }); }
                    },
                      "Load " + Math.min(50, sorted.length - visibleCount) + " more"
                    ),
                    React.createElement("span", { className: "load-more-count" },
                      visibleCount + " of " + sorted.length + " results shown"
                    )
                  )
                  );
                  })(),

                  /* Mobile cards */
                  React.createElement("div", { className: "mobile-cards" },
                    sorted.map(function(r, i) {
                      var ratioClass = r.volumeRatio >= 5 ? "ratio-hot" : r.volumeRatio >= 3.5 ? "ratio-warm" : "ratio-ok";
                      return React.createElement("div", { key: r.symbol, className: "mobile-card " + ratioClass },
                        React.createElement("div", { className: "mobile-card-top" },
                          React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
                            React.createElement("button", {
                              className: "star-btn" + (isInWatchlist(r.symbol) ? " starred" : ""),
                              onClick: function(e) { e.stopPropagation(); toggleWatchlistTicker(r.symbol); }
                            },
                              React.createElement("svg", { viewBox: "0 0 24 24", width: 14, height: 14, fill: isInWatchlist(r.symbol) ? "var(--accent)" : "none", stroke: isInWatchlist(r.symbol) ? "var(--accent)" : "var(--text-3)", strokeWidth: 2 },
                                React.createElement("polygon", { points: "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" })
                              )
                            ),
                            React.createElement("img", {
                              className: "ticker-logo",
                              src: "https://assets.parqet.com/logos/symbol/" + r.symbol,
                              alt: "",
                              width: 18,
                              height: 18,
                              onError: function(e) { e.target.style.display = "none"; }
                            }),
                            React.createElement("span", { className: "mobile-card-ticker" }, r.symbol),
                            React.createElement("span", { className: "mobile-card-name" }, r.name)
                          ),
                          React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 4 } },
                            React.createElement("a", {
                              className: "chart-open-btn",
                              href: "https://www.tradingview.com/chart/?symbol=" + r.symbol,
                              target: "_blank",
                              rel: "noopener noreferrer",
                              onClick: function(e) { e.stopPropagation(); },
                              title: "Open in TradingView"
                            },
                              React.createElement("svg", { viewBox: "0 0 24 24", width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
                                React.createElement("path", { d: "M3 3v18h18" }),
                                React.createElement("path", { d: "M18.7 8l-5.1 5.1-4-4L3 15.6" })
                              )
                            ),
                            React.createElement("button", {
                              className: "alert-create-btn" + ((alertLevels && alertLevels[r.symbol]) ? " active" : ""),
                              onClick: function(e) { e.stopPropagation(); promptCreateAlert(r.symbol); },
                              title: (alertLevels && alertLevels[r.symbol]) ? "Alert set at " + alertLevels[r.symbol] + "x — click to edit" : "Create a volume alert"
                            },
                              React.createElement("svg", { viewBox: "0 0 24 24", width: 12, height: 12, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
                                React.createElement("path", { d: "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" }),
                                React.createElement("path", { d: "M13.73 21a2 2 0 0 1-3.46 0" })
                              )
                            ),
                            React.createElement("span", { className: "mobile-card-rank" }, "#" + (i + 1))
                          )
                        ),
                        React.createElement("div", { className: "mobile-card-mid" },
                          React.createElement("span", { className: "mobile-card-price" }, "$" + r.price.toFixed(2)),
                          React.createElement("span", { className: "mobile-card-change " + (r.change >= 0 ? "pos" : "neg") },
                            (r.change >= 0 ? "+" : "") + r.change.toFixed(2) + "%"
                          )
                        ),
                        React.createElement("div", { className: "mobile-card-bottom" },
                          React.createElement("span", { className: "mobile-card-ratio" },
                            React.createElement("span", { className: "ratio-pill " + (r.volumeRatio >= 5 ? "hot" : r.volumeRatio >= 3.5 ? "warm" : "ok") },
                              r.volumeRatio + "x"
                            )
                          ),
                          React.createElement("span", { className: "mobile-card-vol" }, fmt(r.avgVolume) + " / " + fmt(r.volume)),
                          React.createElement("span", { className: "mobile-card-sector" },
                            React.createElement("span", { className: "sector-chip" }, r.sector)
                          )
                        )
                      );
                    })
                  )
                )
              )
            )
          )
        ),

        page === "policy" && React.createElement(Suspense, { fallback: React.createElement("div", { className: "page-loading" }, "Loading…") },
          React.createElement(PolicyPage, null)
        ),

        /* ── Footer ── */
        React.createElement("footer", { className: "site-footer" },
          React.createElement("button", { className: "site-footer-link", onClick: function() { setPage("policy"); } }, "Terms of Service")
        ),

      ),

      /* ── Chart Modal (global, rendered outside scroll container) ── */
      chartOpen && React.createElement(Suspense, { fallback: null },
        React.createElement(ChartModal, {
          symbol:  chartSymbol,
          name:    chartName,
          onClose: closeChart,
        })
      ),

      /* ── Live alert toast from SSE ── */
      liveAlert && React.createElement("div", { className: "live-alert-toast" },
        React.createElement("span", { className: "live-alert-icon" }, "🔔"),
        React.createElement("div", { className: "live-alert-body" },
          React.createElement("strong", null, liveAlert.title),
          React.createElement("span", null, liveAlert.body)
        ),
        React.createElement("button", { className: "live-alert-close", onClick: function() { setLiveAlert(null); } }, "✕")
      )
    )
  );
}

export default App
