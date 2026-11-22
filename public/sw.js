const CACHE='bbcdm-static-v1';
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['/','/icon.svg','/manifest.webmanifest'])).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(self.clients.claim())});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;e.respondWith(fetch(e.request).then(res=>{if(res.ok&&new URL(e.request.url).pathname!=='/')caches.open(CACHE).then(cache=>cache.put(e.request,res.clone()));return res}).catch(()=>caches.match(e.request).then(cached=>cached||caches.match('/'))))});
