import React from 'react';

var SCAN_TYPE_LABEL = {
  capitalFlow: 'Capital Flow Scan',
  maScanner: 'MA Scanner',
  sectorMoving: 'Hot Sectors',
};

// A watchlist threshold alert is genuinely about one ticker, so its symbol
// belongs in the header. A scheduled scan's notification is a digest of
// however many results it found ("N stocks moving right now") — showing one
// arbitrary ticker as the headline misrepresents it as being about that
// stock specifically, so those get a scan-type label instead.
function alertHeadline(alert) {
  if (alert.sym) return alert.sym;
  if (alert.scanType) return SCAN_TYPE_LABEL[alert.scanType] || 'Scheduled Scan';
  return 'Daily Digest';
}

function formatAlertTime(iso) {
  var d = new Date(iso);
  var now = new Date();
  var diffMs = now - d;
  var diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return diffMin + 'm ago';
  if (diffMin < 1440) return Math.floor(diffMin / 60) + 'h ago';
  return d.toLocaleDateString();
}

/* Notification bell + alert-history dropdown — desktop-notification alerts
   for local ticker/threshold matches (browser Notification API), separate
   from the server-driven push pipeline in usePushSubscription. */
function AlertBell(props) {
  var notificationsEnabled = props.notificationsEnabled;
  var showAlertPanel = props.showAlertPanel;
  var onBellClick = props.onBellClick;
  var unreadCount = props.unreadCount;
  var alertHistory = props.alertHistory;
  var onClearAll = props.onClearAll;
  var onClosePanel = props.onClosePanel;
  var onRemoveAlert = props.onRemoveAlert;
  var onOpenNotification = props.onOpenNotification;
  var onToggleNotifications = props.onToggleNotifications;

  return React.createElement(
    'div',
    { style: { position: 'relative' } },
    React.createElement(
      'button',
      {
        className: 'notif-bell' + (notificationsEnabled ? ' active' : '') + (showAlertPanel ? ' open' : ''),
        onClick: onBellClick,
        title: 'Alert history',
        'aria-label': 'Alert history' + (unreadCount > 0 ? ', ' + unreadCount + ' unread' : ''),
        'aria-expanded': showAlertPanel,
      },
      React.createElement(
        'span',
        { className: 'notif-bell-icon', 'aria-hidden': true },
        React.createElement(
          'svg',
          {
            viewBox: '0 0 24 24',
            width: 15,
            height: 15,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          React.createElement('path', { d: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' }),
          React.createElement('path', { d: 'M13.73 21a2 2 0 0 1-3.46 0' })
        )
      ),
      unreadCount > 0 &&
        React.createElement('span', { className: 'notif-badge' }, unreadCount > 99 ? '99+' : unreadCount)
    ),
    showAlertPanel &&
      React.createElement(
        'div',
        { className: 'alert-panel', role: 'dialog', 'aria-label': 'Notifications' },
        React.createElement(
          'div',
          { className: 'alert-panel-header' },
          React.createElement(
            'div',
            { className: 'alert-panel-heading' },
            React.createElement('span', { className: 'alert-panel-kicker' }, 'CAPITAL FLOW'),
            React.createElement('strong', { className: 'alert-panel-title' }, 'Notifications')
          ),
          React.createElement(
            'div',
            { className: 'alert-panel-header-actions' },
            alertHistory.length > 0 &&
              React.createElement('span', { className: 'alert-panel-count' }, alertHistory.length),
            alertHistory.length > 0 &&
              React.createElement(
                'button',
                {
                  className: 'alert-panel-clear',
                  onClick: onClearAll,
                },
                'Clear all'
              ),
            React.createElement(
              'button',
              { className: 'alert-panel-close', onClick: onClosePanel, 'aria-label': 'Close alert history' },
              '\xd7'
            )
          )
        ),
        alertHistory.length === 0
          ? React.createElement(
              'div',
              { className: 'alert-panel-empty' },
              React.createElement(
                'svg',
                {
                  className: 'alert-panel-empty-icon',
                  viewBox: '0 0 24 24',
                  width: 28,
                  height: 28,
                  fill: 'none',
                  stroke: '#3f3f46',
                  strokeWidth: 1.5,
                  style: { marginBottom: 10 },
                },
                React.createElement('path', { d: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' }),
                React.createElement('path', { d: 'M13.73 21a2 2 0 0 1-3.46 0' })
              ),
              React.createElement('div', { className: 'alert-panel-empty-title' }, 'No alerts yet'),
              React.createElement(
                'div',
                { className: 'alert-panel-empty-subtitle' },
                'Alerts fire when stocks cross your volume thresholds'
              )
            )
          : React.createElement(
              'div',
              { className: 'alert-panel-list', role: 'list', 'aria-label': 'Alert history' },
              alertHistory.map(function (alert) {
                return React.createElement(
                  'div',
                  { key: alert.id, className: 'alert-hist-item', role: 'listitem' },
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      className: 'alert-hist-left',
                      onClick: function () {
                        if (onOpenNotification) onOpenNotification(alert.id);
                      },
                    },
                    React.createElement(
                      'div',
                      { className: 'alert-hist-top' },
                      React.createElement('span', { className: 'alert-panel-sym' }, alertHeadline(alert)),
                      React.createElement('span', { className: 'alert-hist-time' }, formatAlertTime(alert.time))
                    ),
                    React.createElement('div', { className: 'alert-hist-body' }, alert.body)
                  ),
                  React.createElement(
                    'button',
                    {
                      className: 'alert-panel-del',
                      onClick: function () {
                        onRemoveAlert(alert.id);
                      },
                      'aria-label': 'Dismiss alert for ' + alertHeadline(alert),
                    },
                    '\xd7'
                  )
                );
              })
            ),
        React.createElement(
          'div',
          { className: 'alert-panel-footer' },
          React.createElement(
            'button',
            {
              className: 'alert-panel-toggle' + (notificationsEnabled ? ' on' : ''),
              onClick: onToggleNotifications,
            },
            React.createElement('span', { className: 'alert-toggle-dot' }),
            notificationsEnabled ? 'Notifications on' : 'Enable notifications'
          )
        )
      )
  );
}

export default AlertBell;
