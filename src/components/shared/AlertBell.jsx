import React from 'react'

function formatAlertTime(iso) {
  var d = new Date(iso);
  var now = new Date();
  var diffMs = now - d;
  var diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return diffMin + "m ago";
  if (diffMin < 1440) return Math.floor(diffMin / 60) + "h ago";
  return d.toLocaleDateString();
}

/* Notification bell + alert-history dropdown — desktop-notification alerts
   for local ticker/threshold matches (browser Notification API), separate
   from the Elite-only server-driven push pipeline in usePushSubscription. */
function AlertBell(props) {
  var notificationsEnabled = props.notificationsEnabled;
  var showAlertPanel = props.showAlertPanel;
  var onBellClick = props.onBellClick;
  var unreadCount = props.unreadCount;
  var alertHistory = props.alertHistory;
  var onClearAll = props.onClearAll;
  var onClosePanel = props.onClosePanel;
  var onRemoveAlert = props.onRemoveAlert;
  var onToggleNotifications = props.onToggleNotifications;

  return React.createElement("div", { style: { position: "relative" } },
    React.createElement("button", {
      className: "notif-bell" + (notificationsEnabled ? " active" : "") + (showAlertPanel ? " open" : ""),
      onClick: onBellClick,
      title: "Alert history"
    },
      React.createElement("svg", { viewBox: "0 0 24 24", width: 15, height: 15, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
        React.createElement("path", { d: "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" }),
        React.createElement("path", { d: "M13.73 21a2 2 0 0 1-3.46 0" })
      ),
      unreadCount > 0 && React.createElement("span", { className: "notif-badge" }, unreadCount > 99 ? "99+" : unreadCount)
    ),
    showAlertPanel && React.createElement("div", { className: "alert-panel" },
      React.createElement("div", { className: "alert-panel-header" },
        React.createElement("span", null, "Alert History"),
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
          alertHistory.length > 0 && React.createElement("button", {
            className: "alert-panel-clear",
            onClick: onClearAll
          }, "Clear all"),
          React.createElement("button", { className: "alert-panel-close", onClick: onClosePanel }, "\xd7")
        )
      ),
      alertHistory.length === 0
        ? React.createElement("div", { className: "alert-panel-empty" },
            React.createElement("svg", { viewBox: "0 0 24 24", width: 28, height: 28, fill: "none", stroke: "#3f3f46", strokeWidth: 1.5, style: { marginBottom: 10 } },
              React.createElement("path", { d: "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" }),
              React.createElement("path", { d: "M13.73 21a2 2 0 0 1-3.46 0" })
            ),
            React.createElement("div", null, "No alerts yet"),
            React.createElement("div", { style: { fontSize: 11, color: "#3f3f46", marginTop: 4 } }, "Alerts fire when stocks cross your volume thresholds")
          )
        : React.createElement("div", { className: "alert-panel-list" },
            alertHistory.map(function(alert) {
              return React.createElement("div", { key: alert.id, className: "alert-hist-item" },
                React.createElement("div", { className: "alert-hist-left" },
                  React.createElement("div", { className: "alert-hist-top" },
                    React.createElement("span", { className: "alert-panel-sym" }, alert.sym),
                    React.createElement("span", { className: "alert-hist-time" }, formatAlertTime(alert.time))
                  ),
                  React.createElement("div", { className: "alert-hist-body" }, alert.body)
                ),
                React.createElement("button", {
                  className: "alert-panel-del",
                  onClick: function() { onRemoveAlert(alert.id); }
                }, "\xd7")
              );
            })
          ),
      React.createElement("div", { className: "alert-panel-footer" },
        React.createElement("button", {
          className: "alert-panel-toggle" + (notificationsEnabled ? " on" : ""),
          onClick: onToggleNotifications
        },
          React.createElement("span", { className: "alert-toggle-dot" }),
          notificationsEnabled ? "Notifications on" : "Enable notifications"
        )
      )
    )
  );
}

export default AlertBell
