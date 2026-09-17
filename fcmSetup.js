/**
 * config/fcmSetup.js — Firebase Cloud Messaging (push notifications).
 *
 * STATUS: intentionally a documented stub. True background push requires:
 *   1. A Firebase project + web push certificates (VAPID keypair).
 *   2. `npm i firebase` and initialise the FCM SDK in the client.
 *   3. A push server that delivers via the FCM v1 HTTP API.
 *
 * The app TODAY delivers notifications through the Notification API +
 * Service Worker (sw.js) whenever the browser/PWA is running, which covers
 * the common "app open in another tab / installed PWA" cases with zero
 * third-party keys. Fill in the values below and wire the FCM SDK to get
 * full background push.
 */
module.exports = {
  fcm: {
    enabled: false,
    // Firebase console → Project settings → Cloud Messaging → Web Push certificates
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
    serviceWorkerPath: '/firebase-messaging-sw.js',
  },
};
