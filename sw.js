const PREFIX='fhl-offline-',CONTROL='fhl-control-v2';
let preparing=null;
const url=path=>new URL(path,self.registration.scope).href;
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
async function readState(){
  const control=await caches.open(CONTROL),response=await control.match(url('./__state__'));
  if(response)return response.json();
  // Adopt a completed v1 cache without changing stored business data.
  for(const name of (await caches.keys()).reverse())if(name.startsWith(PREFIX)) {
    const cache=await caches.open(name);if(await cache.match(url('./__ready__'))){const m=await cache.match(url('./offline-assets.json'));return {active:m?await m.json():{version:name.slice(PREFIX.length),appVersion:'1.0.0'}};}
  }
  return {};
}
async function writeState(state){await (await caches.open(CONTROL)).put(url('./__state__'),new Response(JSON.stringify(state)));}
async function completed(release){
  if(!release)return false;
  const cache=await caches.open(PREFIX+release.version);
  if(!await cache.match(url('./__ready__')))return false;
  const response=await cache.match(url('./offline-assets.json'));
  if(!response)return release.appVersion==='1.0.0';
  const manifest=await response.json();
  if(!Array.isArray(manifest.assets))return false;
  for(const asset of manifest.assets)if(!await cache.match(url(asset)))return false;
  return true;
}
async function inventory(){const r=await fetch(url('./offline-assets.json'),{cache:'no-store'});if(!r.ok)throw new Error('缓存清单无法读取');const m=await r.json();if(!m.version||!m.appVersion||!Array.isArray(m.assets))throw new Error('缓存清单无效');return m;}
async function prepare(){
  const state=await readState(),manifest=await inventory(),cache=await caches.open(PREFIX+manifest.version);
  for(const asset of manifest.assets) {
    const target=url(asset);if(new URL(target).origin!==self.location.origin||!target.startsWith(self.registration.scope))throw new Error('缓存资源地址无效');
    if(!await cache.match(target)){const r=await fetch(target,{cache:'no-store'});if(!r.ok)throw new Error('资源未就绪：'+asset);await cache.put(target,r);}
  }
  await cache.put(url('./offline-assets.json'),new Response(JSON.stringify(manifest)));
  await cache.put(url('./__ready__'),new Response('ready'));
  state.staged={version:manifest.version,appVersion:manifest.appVersion,buildId:manifest.buildId};await writeState(state);
  return state;
}
async function activate(version){
  const state=await readState(),release=state.staged?.version===version?state.staged:state.active?.version===version?state.active:null;
  if(!await completed(release))throw new Error('新版资源尚未完整缓存');
  await writeState({active:release,previous:state.active?.version!==version?state.active:state.previous});
  // Retain previous releases for open tabs and failed-update recovery.
  return {active:release};
}
const status=async state=>({ok:true,ready:await completed(state.active),version:state.active?.version,appVersion:state.active?.appVersion,buildId:state.active?.buildId,stagedVersion:state.staged?.version,stagedAppVersion:state.staged?.appVersion,stagedBuildId:state.staged?.buildId});
self.addEventListener('message',event=>{
  const port=event.ports[0],legacy=typeof event.data==='string',type=legacy?event.data:event.data?.type;
  event.waitUntil((async()=>{try{
    if(type==='STATUS')return port?.postMessage(await status(await readState()));
    if(type==='PREPARE'){
      preparing??=prepare().finally(()=>{preparing=null;});let state=await preparing;
      if(legacy)state=await activate(state.staged.version);
      return port?.postMessage(await status(state));
    }
    if(type==='ACTIVATE')return port?.postMessage(await status(await activate(event.data.version)));
    port?.postMessage({ok:false,error:'不支持的离线操作'});
  }catch(e){port?.postMessage({ok:false,error:String(e.message||e)});}})());
});
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET'||new URL(request.url).origin!==self.location.origin)return;
  if(new URL(request.url).pathname.endsWith('/offline-assets.json'))return;
  event.respondWith((async()=>{
    const state=await readState();
    if(request.mode==='navigate'){
      if(state.active){const cached=await (await caches.open(PREFIX+state.active.version)).match(url('./index.html'));if(cached)return cached;}
      try{return await fetch(request);}catch{return new Response('请联网完成离线准备',{status:503});}
    }
    const cached=await caches.match(request,{ignoreVary:true});return cached??fetch(request);
  })());
});
