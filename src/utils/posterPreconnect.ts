import { OFFICIAL_HOST } from './officialDmm';

// Runs inline from _document. debridmediamanager.com loads posters from posters0-9, so it warms
// those connections early; a self-hosted copy never asks them (see officialDmm) and adds none.
export const POSTER_PRECONNECT_SCRIPT = `(function(){
if(!${OFFICIAL_HOST}.test(location.hostname))return;
for(var i=0;i<10;i++){
var o='https://posters'+i+'.debridmediamanager.com',d=document.createElement('link'),p=document.createElement('link');
d.rel='dns-prefetch';d.href=o;document.head.appendChild(d);
p.rel='preconnect';p.href=o;p.crossOrigin='anonymous';document.head.appendChild(p);
}
})();`;
