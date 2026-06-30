/* Scratch service worker — push notifications + Home Screen install.
 * Served as a real file at the site root so its scope covers admin.html (and index.html).
 * Keep this file at the web root; a service worker can only control pages within its own path scope.
 */

// Bump this string whenever you change the SW so browsers pick up the new version.
const SW_VERSION = 'scratch-sw-v1';

self.addEventListener('install', (event) => {
  // Activate the new SW immediately rather than waiting for old tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take control of any open clients right away.
  event.waitUntil(self.clients.claim());
});

/* A push arrives as an encrypted payload from the Supabase Edge Function.
 * Expected JSON shape (see supabase/functions/send-push):
 *   { "title": "...", "body": "...", "url": "/admin.html", "tag": "inbox" }
 */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {
    try { data = { title: 'Scratch', body: event.data ? event.data.text() : '' }; } catch (e2) { data = {}; }
  }
  const title = data.title || 'Scratch';
  const options = {
    body: data.body || '',
    icon: 'app-assets/scratch-icon-192.png',
    badge: 'app-assets/scratch-icon-192.png',
    // Group notifications of the same kind so a flood collapses into one.
    tag: data.tag || 'scratch',
    renotify: true,
    data: { url: data.url || './admin.html' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

/* Tapping a notification focuses an open tab (or opens one) and navigates to the target. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './admin.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) { try { client.navigate(target); } catch (e) {} }
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
