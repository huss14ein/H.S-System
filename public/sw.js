const CACHE_NAME = 'hs-finance-v1';
const STATIC_CACHE_NAME = 'hs-finance-static-v1';
const DYNAMIC_CACHE_NAME = 'hs-finance-dynamic-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  // Add other critical static assets
];

const API_CACHE_ROUTES = [
  '/api/transactions',
  '/api/budgets',
  '/api/goals',
  '/api/portfolios',
  '/api/accounts'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('Service Worker: Static assets cached');
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== STATIC_CACHE_NAME && 
                cacheName !== DYNAMIC_CACHE_NAME &&
                cacheName !== CACHE_NAME) {
              console.log('Service Worker: Deleting old cache', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('Service Worker: Activated');
        return self.clients.claim();
      })
  );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Handle different types of requests
  if (url.origin === self.location.origin) {
    // Handle same-origin requests
    if (url.pathname.startsWith('/api/')) {
      // API requests - network first, then cache
      event.respondWith(handleApiRequest(request));
    } else {
      // Static assets - cache first, then network
      event.respondWith(handleStaticRequest(request));
    }
  } else {
    // Handle external requests (e.g., fonts, APIs)
    event.respondWith(handleExternalRequest(request));
  }
});

// Handle API requests with network-first strategy
async function handleApiRequest(request) {
  try {
    // Try network first
    const networkResponse = await fetch(request);
    
    // Cache the response if successful
    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    // Fallback to cache
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return offline fallback for specific API routes
    if (request.url.includes('/api/transactions')) {
      return new Response(JSON.stringify({
        error: 'Offline - showing cached data',
        data: await getCachedTransactions()
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({
      error: 'Network unavailable',
      offline: true
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Handle static requests with cache-first strategy
async function handleStaticRequest(request) {
  const cachedResponse = await caches.match(request);
  
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    // Return offline page for navigation requests
    if (request.mode === 'navigate') {
      return caches.match('/offline.html') || 
             new Response('Offline - Please check your connection', {
               status: 503,
               headers: { 'Content-Type': 'text/html' }
             });
    }
    
    throw error;
  }
}

// Handle external requests
async function handleExternalRequest(request) {
  try {
    const networkResponse = await fetch(request);
    
    // Cache external resources if they're cacheable
    if (networkResponse.ok && isCacheable(request)) {
      const cache = await caches.open(DYNAMIC_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    // Try to serve from cache
    return caches.match(request);
  }
}

// Check if request is cacheable
function isCacheable(request) {
  const url = new URL(request.url);
  
  // Cache fonts, images, and some external APIs
  return url.hostname.includes('fonts.googleapis.com') ||
         url.hostname.includes('fonts.gstatic.com') ||
         url.hostname.includes('api.finnhub.io') ||
         request.destination === 'image' ||
         request.destination === 'font';
}

// Get cached transactions for offline fallback
async function getCachedTransactions() {
  try {
    const cache = await caches.open(DYNAMIC_CACHE_NAME);
    const cachedResponse = await cache.match('/api/transactions');
    
    if (cachedResponse) {
      const data = await cachedResponse.json();
      return data.data || [];
    }
    
    return [];
  } catch (error) {
    return [];
  }
}

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync-transactions') {
    event.waitUntil(syncOfflineTransactions());
  }
});

// Sync offline transactions when back online
async function syncOfflineTransactions() {
  try {
    const offlineActions = await getOfflineActions();
    
    for (const action of offlineActions) {
      try {
        await fetch(action.url, {
          method: action.method,
          headers: action.headers,
          body: action.body
        });
        
        // Remove synced action from offline storage
        await removeOfflineAction(action.id);
      } catch (error) {
        console.error('Failed to sync action:', action, error);
      }
    }
  } catch (error) {
    console.error('Background sync failed:', error);
  }
}

// Get offline actions from IndexedDB
async function getOfflineActions() {
  // This would integrate with IndexedDB for offline storage
  // For now, return empty array
  return [];
}

// Remove synced action from IndexedDB
async function removeOfflineAction(actionId) {
  // This would remove the action from IndexedDB
  // For now, do nothing
}

// Push notification event
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    
    const options = {
      body: data.body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
      vibrate: [100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
        primaryKey: data.primaryKey || 1
      },
      actions: [
        {
          action: 'explore',
          title: 'View Details',
          icon: '/icons/checkmark.png'
        },
        {
          action: 'close',
          title: 'Close',
          icon: '/icons/xmark.png'
        }
      ]
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  }
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'explore') {
    event.waitUntil(
      clients.openWindow(event.notification.data.url || '/')
    );
  }
});

console.log('Service Worker: Loaded');
