// Runs inline from _document, outside the JS bundle, so a page whose chunk failed to load
// (cached HTML pointing at an older build) still gets a way out of the SSR loading screen.
export const BOOT_GUARD_RELOAD_KEY = 'dmm:chunkReload';
export const BOOT_GUARD_FALLBACK_ID = 'dmm-boot-fallback';
export const BOOT_GUARD_TIMEOUT_MS = 15000;

export const BOOT_GUARD_SCRIPT = `(function(){
var K='${BOOT_GUARD_RELOAD_KEY}',ID='${BOOT_GUARD_FALLBACK_ID}';
function fallback(){
if(window.__dmmHydrated||document.getElementById(ID))return;
if(!document.body)return document.addEventListener('DOMContentLoaded',fallback);
var d=document.createElement('div'),b=document.createElement('button');
d.id=ID;
d.style.cssText='position:fixed;left:0;right:0;bottom:16px;padding:0 16px;text-align:center;z-index:2147483647;color:#fff;font:14px sans-serif';
d.appendChild(document.createTextNode('DMM did not finish loading. '));
b.textContent='Reload';
b.style.cssText='margin-left:8px;padding:4px 12px;border:1px solid #fff;border-radius:4px;background:#1f2937;color:#fff;cursor:pointer';
b.onclick=function(){try{sessionStorage.removeItem(K)}catch(e){}location.reload()};
d.appendChild(b);
document.body.appendChild(d);
}
window.addEventListener('error',function(e){
var t=e.target;
if(window.__dmmHydrated||!t||t.tagName!=='SCRIPT'||String(t.src).indexOf('/_next/static/')<0)return;
try{if(sessionStorage.getItem(K))return fallback();sessionStorage.setItem(K,'1')}catch(x){return fallback()}
location.reload();
},true);
setTimeout(fallback,${BOOT_GUARD_TIMEOUT_MS});
})();`;

/** Called once the app has mounted: a healthy load never reloads or shows the fallback. */
export function markHydrated() {
	(window as Window & { __dmmHydrated?: boolean }).__dmmHydrated = true;
	try {
		sessionStorage.removeItem(BOOT_GUARD_RELOAD_KEY);
	} catch {}
	document.getElementById(BOOT_GUARD_FALLBACK_ID)?.remove();
}
