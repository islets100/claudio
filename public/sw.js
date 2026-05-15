// Claudio Service Worker
var CACHE_NAME="claudio-v0.1.0";
var urlsToCache=["/","/css/app.css","/js/app.js"];

self.addEventListener("install",function(e){
  e.waitUntil(caches.open(CACHE_NAME).then(function(cache){
    return cache.addAll(urlsToCache);
  }));
});

self.addEventListener("fetch",function(e){
  e.respondWith(caches.match(e.request).then(function(r){
    return r||fetch(e.request).then(function(res){
      if(res.status===200){
        var clone=res.clone();
        caches.open(CACHE_NAME).then(function(c){c.put(e.request,clone);});
      }
      return res;
    });
  }));
});

self.addEventListener("activate",function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){return k!==CACHE_NAME;}).map(function(k){return caches.delete(k);}));
  }));
});