const PREFIX='fhl-offline-';
let preparing=null;
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
async function inventory(){const r=await fetch(new URL('./offline-assets.json',self.registration.scope),{cache:'no-store'});if(!r.ok)throw new Error('缓存清单无法读取');return r.json();}
async function prepare(){
  const manifest=await inventory(), name=PREFIX+manifest.version,cache=await caches.open(name);
  for(const asset of manifest.assets){const url=new URL(asset,self.registration.scope);if(!await cache.match(url)){
    const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error('资源未就绪：'+asset);await cache.put(url,r);
  }}
  await cache.put(new URL('./__ready__',self.registration.scope),new Response('ready'));
  for(const old of await caches.keys())if(old.startsWith(PREFIX)&&old!==name)await caches.delete(old);
  return manifest.version;
}
self.addEventListener('message',event=>{
  const port=event.ports[0];
  if(event.data==='PREPARE')event.waitUntil((async()=>{try{preparing??=prepare().finally(()=>{preparing=null;});const v=await preparing;port.postMessage({ok:true,version:v});}catch(e){port.postMessage({ok:false,error:String(e.message||e)});}})());
  if(event.data==='STATUS')event.waitUntil((async()=>{let ready=false;for(const name of await caches.keys())if(name.startsWith(PREFIX)){const c=await caches.open(name);if(await c.match(new URL('./__ready__',self.registration.scope)))ready=true;}port.postMessage({ok:true,ready});})());
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  event.respondWith((async()=>{
    const request=event.request;
    if(request.mode==='navigate'){
      try{return await fetch(request);}catch{const r=await caches.match(new URL('./index.html',self.registration.scope),{ignoreVary:true});return r??new Response('请联网完成离线准备',{status:503});}
    }
    return (await caches.match(request,{ignoreVary:true}))??fetch(request);
  })());
});
