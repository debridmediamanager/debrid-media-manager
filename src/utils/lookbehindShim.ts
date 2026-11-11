// Runs inline from _document, before any bundle. Safari before 16.4 (iOS 15 and older)
// throws on any regex with lookbehind, `(?<=…)` or `(?<!…)`, and the filename parsers
// build hundreds of them, some at runtime. There, and only there, RegExp retries a
// failing pattern with its lookbehind groups dropped: a looser match instead of a crash.
// lookbehind-fallback.js turns the bundles' lookbehind literals into RegExp calls.
export const LOOKBEHIND_SHIM_SCRIPT = `(function(){
var N=window.RegExp;
try{new N('(?<=a)b');return}catch(e){}
function cls(p,i){for(i++;i<p.length;i++){if(p[i]==='\\\\')i++;else if(p[i]===']')return i}return i}
function strip(p){
var o='',i,j,d;
for(i=0;i<p.length;i++){
var c=p[i],h=p.substr(i,4);
if(c==='\\\\'){o+=p.substr(i,2);i++}
else if(c==='['){j=cls(p,i);o+=p.slice(i,j+1);i=j}
else if(h==='(?<='||h==='(?<!'){for(d=0;i<p.length;i++){if(p[i]==='\\\\')i++;else if(p[i]==='[')i=cls(p,i);else if(p[i]==='(')d++;else if(p[i]===')'&&--d===0)break}}
else o+=c}
return o}
function R(p,f){
if(!(this instanceof R)&&p instanceof N&&f===undefined)return p;
try{return new N(p,f)}catch(e){
var s=p instanceof N?p.source:String(p),l=strip(s);
if(l===s)throw e;
return new N(l,f)}}
R.prototype=N.prototype;
Object.setPrototypeOf(R,N);
window.RegExp=R;
})();`;
