const CACHE_NAME = 'cashup-v4';
const ASSETS = [
  '/financas/',
  '/financas/index.html',
  '/financas/manifest.json',
  '/financas/icon-192.png',
  '/financas/icon-512.png'
];

// ── Install ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clear old caches ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: network first, cache fallback ──
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('firebase') || e.request.url.includes('google')) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── Periodic Background Sync ──
self.addEventListener('periodicsync', e => {
  if (e.tag === 'cashup-check-bills') {
    e.waitUntil(checkAndNotify());
  }
});

// ── Push notifications ──
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'Ca$h Up', {
      body: data.body || 'Você tem vencimentos hoje!',
      icon: '/financas/icon-192.png',
      badge: '/financas/icon-192.png',
      vibrate: [200, 100, 200],
      data: { url: '/financas/' }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || '/financas/'));
});

// ── Core: read IndexedDB and fire notification ──
async function checkAndNotify() {
  try {
    const bills = await readBillsFromIDB();
    if (!bills.length) return;

    const today = new Date();
    const todayDay = today.getDate();
    const todayStr = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(todayDay).padStart(2, '0');

    const due = [];

    for (const b of bills) {
      if (b.type === 'sub' || b.type === 'debt') {
        if (b.dueDay === todayDay) due.push(b.name + ' — ' + formatBRL(b.amount));
      } else if (b.type === 'rec') {
        if (b.dueDate === todayStr) due.push(b.name + ' — ' + formatBRL(b.amount));
        // Also check if it's recurring and falls today
        else if (b.freq && b.dueDate < todayStr) {
          const next = calcNextDate(b.dueDate, b.freq);
          if (next === todayStr) due.push(b.name + ' — ' + formatBRL(b.amount));
        }
      }
    }

    if (due.length > 0) {
      await self.registration.showNotification('Ca$h Up — Vencimentos Hoje 📅', {
        body: due.join('\n'),
        icon: '/financas/icon-192.png',
        badge: '/financas/icon-192.png',
        vibrate: [300, 100, 300],
        tag: 'cashup-bills-' + todayStr,
        renotify: false,
        data: { url: '/financas/' }
      });
    }
  } catch(err) {
    console.error('[SW] checkAndNotify error:', err);
  }
}

function readBillsFromIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('cashup_bills', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('bills', { keyPath: 'id' });
    req.onsuccess = e => {
      const db = e.target.result;
      const tx = db.transaction('bills', 'readonly');
      const store = tx.objectStore('bills');
      const all = store.getAll();
      all.onsuccess = () => resolve(all.result || []);
      all.onerror = () => resolve([]);
    };
    req.onerror = () => resolve([]);
  });
}

function formatBRL(v) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function calcNextDate(dateStr, freq) {
  const d = new Date(dateStr + 'T12:00:00');
  if (freq === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (freq === 'weekly') d.setDate(d.getDate() + 7);
  else if (freq === 'biweekly') d.setDate(d.getDate() + 14);
  else if (freq === 'quarterly') d.setMonth(d.getMonth() + 3);
  else if (freq === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else return null;
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
