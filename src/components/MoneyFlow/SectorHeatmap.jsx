import React, { useRef, useState, useEffect } from 'react'
import { fmt } from '../../utils/format'

export default function SectorHeatmap(props) {
  var flowData = props.flowData || [];
  var etfMap = props.etfMap || {};
  var onSectorClick = props.onSectorClick || function() {};

  var forceUpdate = useState(0)[1];
  var tickRef = useRef(0);

  // Animation tick for pulsing cells
  useEffect(function() {
    var raf;
    function tick() {
      tickRef.current = (tickRef.current + 1) % 120;
      if (tickRef.current % 4 === 0) forceUpdate(function(n) { return n + 1; });
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return function() { cancelAnimationFrame(raf); };
  }, []);

  function getChangeColor(change) {
    if (change >= 3)  return "#22C55E";
    if (change >= 1)  return "rgba(34,197,94,0.6)";
    if (change >= 0)  return "rgba(34,197,94,0.2)";
    if (change >= -1) return "rgba(239,68,68,0.2)";
    if (change >= -3) return "rgba(239,68,68,0.6)";
    return "#EF4444";
  }

  function getTextColor(change) {
    if (Math.abs(change) >= 1) return "#E4E4E7";
    return "#A0A0A8";
  }

  function getChangeBg(change) {
    if (change >= 3)  return "rgba(34,197,94,0.18)";
    if (change >= 1)  return "rgba(34,197,94,0.10)";
    if (change >= 0)  return "rgba(34,197,94,0.05)";
    if (change >= -1) return "rgba(239,68,68,0.05)";
    if (change >= -3) return "rgba(239,68,68,0.10)";
    return "rgba(239,68,68,0.18)";
  }

  // Build sorted cells with volume-based sizing
  var cells = flowData.map(function(d) {
    var info = etfMap[d.symbol] || {};
    return {
      symbol: d.symbol,
      name: info.name || d.symbol,
      color: info.color || "#444",
      change: typeof d.change === "number" ? d.change : 0,
      volume: typeof d.volume === "number" ? d.volume : 0,
      avgVolume: typeof d.avgVolume === "number" ? d.avgVolume : 0,
      volRatio: typeof d.volRatio === "number" ? d.volRatio : 1,
      flow: d.flow || "neutral",
      price: d.price,
      dayHigh: d.dayHigh,
      dayLow: d.dayLow,
      prevClose: d.prevClose,
      lastSession: !!d.lastSession,
      desc: info.desc || "",
    };
  });

  // Show "last session" banner when market is closed and server fell back to prior-day data
  var showingLastSession = cells.length > 0 && cells.some(function(c) { return c.lastSession; });

  if (!cells.length) {
    return React.createElement("div", {
      style: {
        background: "var(--bg-1)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "32px",
        textAlign: "center",
        color: "var(--text-2)",
        fontSize: 13,
        fontFamily: "var(--mono)",
        letterSpacing: "0.05em",
      }
    }, "NO SECTOR DATA — RUN A SCAN TO POPULATE THE HEATMAP");
  }

  // Sort by volume descending so biggest cells come first
  cells.sort(function(a, b) { return b.volume - a.volume; });

  var maxVol = cells[0] ? cells[0].volume : 1;
  var minVol = cells[cells.length - 1] ? cells[cells.length - 1].volume : 0;
  var volRange = maxVol - minVol || 1;

  // Assign column span 1–3 based on relative volume
  function getColSpan(cell) {
    var ratio = (cell.volume - minVol) / volRange;
    if (ratio > 0.7) return 3;
    if (ratio > 0.35) return 2;
    return 1;
  }

  // Pulse opacity for high volRatio cells
  var t = tickRef.current / 120; // 0..1 cycle
  var pulse = Math.sin(t * Math.PI * 2) * 0.5 + 0.5; // 0..1

  var cellNodes = cells.map(function(cell) {
    var isHovered = false; // hover interactions disabled — cards render static
    var isPulsing = cell.volRatio > 1.5;
    var changeColor = getChangeColor(cell.change);
    var changeBg = getChangeBg(cell.change);
    var colSpan = getColSpan(cell);
    var changeSign = cell.change >= 0 ? "+" : "";
    var flowIcon = cell.flow === "inflow" ? "▲" : cell.flow === "outflow" ? "▼" : "■";
    var flowColor = cell.flow === "inflow" ? "#22C55E" : cell.flow === "outflow" ? "#EF4444" : "#71717A";

    // Glow intensity for pulsing
    var glowAlpha = isPulsing ? (0.15 + pulse * 0.25) : 0;
    var borderAlpha = isPulsing ? (0.3 + pulse * 0.4) : (isHovered ? 0.4 : 0.08);
    var glowColor = cell.change >= 0
      ? "rgba(34,197,94," + glowAlpha + ")"
      : "rgba(239,68,68," + glowAlpha + ")";
    var borderColor = isPulsing
      ? (cell.change >= 0 ? "rgba(34,197,94," + borderAlpha + ")" : "rgba(239,68,68," + borderAlpha + ")")
      : (isHovered ? "rgba(245,158,11,0.5)" : "rgba(255,255,255,0.08)");

    var cellStyle = {
      gridColumn: "span " + colSpan,
      background: changeBg,
      border: "1px solid " + borderColor,
      borderRadius: "var(--radius)",
      padding: colSpan === 3 ? "14px 16px" : colSpan === 2 ? "12px 14px" : "10px 10px",
      cursor: "pointer",
      position: "relative",
      overflow: "hidden",
      transition: "transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease",
      transform: isHovered ? "translateY(-2px) scale(1.01)" : "translateY(0) scale(1)",
      boxShadow: isHovered
        ? "0 6px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(245,158,11,0.3)"
        : isPulsing
          ? "0 0 " + (8 + pulse * 14) + "px " + glowColor
          : "none",
      minHeight: colSpan === 3 ? 100 : colSpan === 2 ? 84 : 72,
    };

    var accentBarColor = cell.change >= 0 ? "#22C55E" : "#EF4444";

    return React.createElement("div", {
      key: cell.symbol,
      className: "sector-heatmap-cell",
      style: cellStyle,
      onClick: function() { onSectorClick(cell); },
    },
      // Top accent bar
      React.createElement("div", {
        style: {
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: "linear-gradient(90deg, " + accentBarColor + " 0%, transparent 100%)",
          opacity: isPulsing ? (0.5 + pulse * 0.5) : 0.35,
        }
      }),

      // Main content
      React.createElement("div", { style: { position: "relative", zIndex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" } },

        // Header row
        React.createElement("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 } },
          React.createElement("div", {},
            React.createElement("div", {
              style: {
                fontSize: colSpan === 3 ? 13 : 11,
                fontWeight: 700,
                color: "var(--text-0)",
                letterSpacing: "0.01em",
                lineHeight: 1.2,
                marginBottom: 2,
              }
            }, cell.name),
            React.createElement("div", {
              style: {
                fontSize: 10,
                fontFamily: "var(--mono)",
                color: "var(--text-2)",
                letterSpacing: "0.08em",
              }
            }, cell.symbol)
          ),

          // VolRatio badge
          cell.volRatio > 1.0 && React.createElement("div", {
            style: {
              fontSize: 9,
              fontFamily: "var(--mono)",
              fontWeight: 600,
              color: cell.volRatio > 2 ? "#F59E0B" : cell.volRatio > 1.5 ? "#FBBF24" : "var(--text-2)",
              background: cell.volRatio > 2 ? "rgba(245,158,11,0.15)" : cell.volRatio > 1.5 ? "rgba(245,158,11,0.08)" : "rgba(255,255,255,0.05)",
              border: "1px solid " + (cell.volRatio > 2 ? "rgba(245,158,11,0.4)" : cell.volRatio > 1.5 ? "rgba(245,158,11,0.2)" : "rgba(255,255,255,0.08)"),
              borderRadius: 3,
              padding: "1px 5px",
              letterSpacing: "0.04em",
              flexShrink: 0,
            }
          }, cell.volRatio.toFixed(1) + "x")
        ),

        // Change % — large display
        React.createElement("div", {
          style: {
            fontSize: colSpan === 3 ? 22 : colSpan === 2 ? 18 : 15,
            fontWeight: 700,
            fontFamily: "var(--mono)",
            color: changeColor,
            lineHeight: 1,
            marginBottom: 4,
            letterSpacing: "-0.02em",
          }
        }, changeSign + cell.change.toFixed(2) + "%"),

        // Footer row — volume and flow (always shown) / extra on hover
        React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } },
          React.createElement("div", {
            style: {
              fontSize: 9,
              fontFamily: "var(--mono)",
              color: "var(--text-2)",
              letterSpacing: "0.04em",
            }
          }, "VOL " + fmt(cell.volume)),

          React.createElement("div", {
            style: {
              fontSize: 9,
              fontFamily: "var(--mono)",
              color: flowColor,
              display: "flex",
              alignItems: "center",
              gap: 3,
              letterSpacing: "0.04em",
            }
          },
            React.createElement("span", { style: { fontSize: 8 } }, flowIcon),
            React.createElement("span", {}, cell.flow.toUpperCase())
          )
        )
      )
    );
  });

  // Header bar
  var totalInflow  = cells.filter(function(c) { return c.flow === "inflow"; }).length;
  var totalOutflow = cells.filter(function(c) { return c.flow === "outflow"; }).length;
  var avgChange    = cells.reduce(function(s, c) { return s + c.change; }, 0) / (cells.length || 1);
  var avgSign      = avgChange >= 0 ? "+" : "";

  return React.createElement("div", {
    style: {
      background: "var(--bg-1)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius)",
      overflow: "hidden",
    }
  },

    // Panel header
    React.createElement("div", {
      className: "sector-heatmap-header",
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-2)",
        flexWrap: "wrap",
        rowGap: 8,
      }
    },
      React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
        React.createElement("div", {
          style: {
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#22C55E",
            boxShadow: "0 0 6px #22C55E",
            animation: "pulse-dot 2s ease-in-out infinite",
          }
        }),
        React.createElement("span", {
          style: {
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.12em",
            color: "var(--text-0)",
            fontFamily: "var(--mono)",
          }
        }, "SECTOR FLOW HEATMAP"),
        React.createElement("span", {
          style: {
            fontSize: 10,
            color: "var(--text-2)",
            fontFamily: "var(--mono)",
            letterSpacing: "0.06em",
          }
        }, cells.length + " SECTORS")
      ),

      // Summary stats
      React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 16 } },
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 5 } },
          React.createElement("span", { style: { fontSize: 9, color: "var(--text-2)", fontFamily: "var(--mono)", letterSpacing: "0.06em" } }, "AVG CHG"),
          React.createElement("span", {
            style: {
              fontSize: 11,
              fontFamily: "var(--mono)",
              fontWeight: 700,
              color: avgChange >= 0 ? "#22C55E" : "#EF4444",
              letterSpacing: "0.03em",
            }
          }, avgSign + avgChange.toFixed(2) + "%")
        ),
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 5 } },
          React.createElement("span", { style: { width: 6, height: 6, borderRadius: "50%", background: "#22C55E", display: "inline-block" } }),
          React.createElement("span", { style: { fontSize: 10, color: "var(--text-1)", fontFamily: "var(--mono)" } }, totalInflow + " IN")
        ),
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 5 } },
          React.createElement("span", { style: { width: 6, height: 6, borderRadius: "50%", background: "#EF4444", display: "inline-block" } }),
          React.createElement("span", { style: { fontSize: 10, color: "var(--text-1)", fontFamily: "var(--mono)" } }, totalOutflow + " OUT")
        ),
        React.createElement("div", { style: { fontSize: 9, color: "var(--text-3)", fontFamily: "var(--mono)", letterSpacing: "0.04em" } }, "CELL SIZE = VOLUME")
      )
    ),

    // Last-session banner (shown when market is closed and data is from prior day)
    showingLastSession && React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 14px",
        background: "rgba(113,113,122,0.08)",
        borderBottom: "1px solid rgba(113,113,122,0.2)",
        fontSize: 11,
        fontFamily: "var(--mono)",
        color: "var(--text-2)",
        letterSpacing: "0.06em",
      }
    },
      React.createElement("span", { style: { fontSize: 12 } }, "🕐"),
      "MARKET CLOSED — showing last session data"
    ),

    // Grid
    React.createElement("div", {
      className: "sector-heatmap-grid",
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(6, 1fr)",
        gap: 4,
        padding: 8,
        background: "var(--bg-0)",
      }
    }, cellNodes),

    // Legend bar
    React.createElement("div", {
      className: "sector-heatmap-legend",
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        padding: "8px 14px",
        borderTop: "1px solid var(--border)",
        background: "var(--bg-2)",
        flexWrap: "wrap",
        rowGap: 8,
      }
    },
      [
        { color: "#22C55E",                   label: "≥ +3%" },
        { color: "rgba(34,197,94,0.6)",        label: "+1–3%" },
        { color: "rgba(34,197,94,0.2)",        label: "0–1%" },
        { color: "rgba(239,68,68,0.2)",        label: "0 – −1%" },
        { color: "rgba(239,68,68,0.6)",        label: "−1 – −3%" },
        { color: "#EF4444",                   label: "≤ −3%" },
      ].map(function(item) {
        return React.createElement("div", {
          key: item.label,
          style: { display: "flex", alignItems: "center", gap: 5 }
        },
          React.createElement("div", {
            style: {
              width: 10,
              height: 10,
              borderRadius: 2,
              background: item.color,
              border: "1px solid rgba(255,255,255,0.1)",
            }
          }),
          React.createElement("span", {
            style: {
              fontSize: 9,
              color: "var(--text-2)",
              fontFamily: "var(--mono)",
              letterSpacing: "0.04em",
            }
          }, item.label)
        );
      })
    )
  );
}
