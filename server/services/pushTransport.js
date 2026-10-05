const https = require('node:https');
const webpush = require('web-push');

// Use the provider library for encryption and VAPID, but own the transport:
// its socket timeout does not bound a trickling or prematurely closed body.
function sendNotification(subscription, payload, { agent, deadlineMs = 15000, maxResponseBytes = 65536 } = {}) {
  const details = webpush.generateRequestDetails(subscription, payload);
  return new Promise((resolve, reject) => {
    let request;
    let response;
    let done = false;
    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) {
        response?.destroy();
        request?.destroy();
        reject(error);
      } else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('Push delivery deadline exceeded')), deadlineMs);
    try {
      request = https.request(
        new URL(details.endpoint),
        {
          method: details.method,
          headers: details.headers,
          agent,
        },
        (incoming) => {
          response = incoming;
          let bytes = 0;
          incoming.on('data', (chunk) => {
            bytes += Buffer.byteLength(chunk);
            if (bytes > maxResponseBytes) finish(new Error('Push response exceeded its size limit'));
          });
          incoming.once('aborted', () => finish(new Error('Push response was interrupted')));
          incoming.once('error', () => finish(new Error('Push response failed')));
          incoming.once('close', () => {
            if (!incoming.complete) finish(new Error('Push response was incomplete'));
          });
          incoming.once('end', () => {
            const statusCode = incoming.statusCode;
            if (statusCode >= 200 && statusCode < 300) finish(null, { statusCode });
            else {
              const error = new Error('Push service rejected delivery');
              error.statusCode = statusCode;
              finish(error);
            }
          });
        }
      );
      request.once('error', () => finish(new Error('Push connection failed')));
      request.end(details.body);
    } catch (error) {
      finish(error);
    }
  });
}

module.exports = { sendNotification };
