/* KALIMAT data layer: shared by the storefront (index.html) and the admin (admin.html). */
(function(){
var C=window.KCFG||(window.KCFG={}),H=(C.SUPABASE_URL||"").replace(/\/$/,""),A=C.SUPABASE_ANON_KEY||"",SHOP=C.SHOP_ID||"";
var LOCAL=/^(store\.|lang$|adminLang$)/,ANON_INS=["orders","customers","customerDemands"],SK="kdb.session";
var MODE=window.KMODE||(/^\/admin/.test(location.pathname)?"admin":"shop");
var cache={},shadow={},subs=[],busy=0,chain=Promise.resolve(),loaded=false,upl={};
function emit(){subs.forEach(function(f){try{f()}catch(e){}})}
function ok(){return!!(H&&A&&SHOP)}
function cp(v){return v===undefined?v:JSON.parse(JSON.stringify(v))}
function rid(x){return String((x&&(x.id||x.name))||JSON.stringify(x))}
function sess(){try{return JSON.parse(localStorage.getItem(SK))}catch(e){return null}}
function setSess(s){try{s?localStorage.setItem(SK,JSON.stringify(s)):localStorage.removeItem(SK)}catch(e){}}
function mk(d,email){return{at:d.access_token,rt:d.refresh_token,exp:d.expires_at||Math.floor(Date.now()/1000)+(d.expires_in||3600),email:email}}
/* ---- errors: every failure becomes a clear message for the person; nothing is swallowed ---- */
var errSubs=[],again=false;
function KErr(code,msg){var e=new Error(msg);e.code=code;return e}
function say(m){console.error("[kdb]",m);if(errSubs.length)errSubs.forEach(function(f){try{f(m)}catch(x){}});else try{window.toast&&window.toast(m)}catch(x){}}
async function token(){var s=sess();if(!s)return null;if(s.exp-60<Date.now()/1000){try{var r=await fetch(H+"/auth/v1/token?grant_type=refresh_token",{method:"POST",headers:{apikey:A,"Content-Type":"application/json"},body:JSON.stringify({refresh_token:s.rt})});var d=await r.json();if(!r.ok)throw 0;s=mk(d,s.email);setSess(s)}catch(e){setSess(null);return null}}return s.at}
async function api(p,o){o=o||{};var t=await token(),h=Object.assign({apikey:A,Authorization:"Bearer "+(t||A),"Content-Type":"application/json"},o.headers||{}),r;
try{r=await fetch(H+p,Object.assign({},o,{headers:h}))}catch(e){throw KErr("network","No connection. Your change was not saved.")}
if(!r.ok){var m="";try{var b=JSON.parse(await r.text());m=b.message||b.msg||""}catch(e){}
if(r.status===401||r.status===403)throw KErr("auth","Your session has expired or you do not have permission. Please sign in again.");
if(r.status===409)throw KErr("conflict","That record already exists.");
if(r.status>=500)throw KErr("server","The server had a problem. Your change was not saved. Please try again.");
throw KErr("rejected","The server rejected the change"+(m?": "+m:"")+".")}
var x=await r.text();return x?JSON.parse(x):null}
/* read every page: the API returns at most 1000 rows per request */
async function pages(path,o){var out=[],step=1000;for(var off=0;;off+=step){var pg=await api(path+(path.indexOf("?")<0?"?":"&")+"limit="+step+"&offset="+off,o);if(!pg||!pg.length)break;out=out.concat(pg);if(pg.length<step)break}return out}
/* images: any data:image/... inside a record is uploaded to Cloudinary and replaced by its URL before saving */
async function cld(d){if(upl[d])return upl[d];if(!C.CLOUDINARY_CLOUD_NAME||!C.CLOUDINARY_UPLOAD_PRESET)throw new Error("cloudinary_not_configured");var fd=new FormData();fd.append("file",d);fd.append("upload_preset",C.CLOUDINARY_UPLOAD_PRESET);var r=await fetch("https://api.cloudinary.com/v1_1/"+C.CLOUDINARY_CLOUD_NAME+"/image/upload",{method:"POST",body:fd});if(!r.ok)throw new Error("cloudinary "+r.status);var j=await r.json();return upl[d]=j.secure_url.replace("/upload/","/upload/f_auto,q_auto/")}
async function walk(o){if(typeof o==="string")return o.slice(0,11)==="data:image/"?cld(o):o;if(Array.isArray(o)){var a=[];for(var i=0;i<o.length;i++)a.push(await walk(o[i]));return a}if(o&&typeof o==="object"){var r={};for(var k in o)r[k]=await walk(o[k]);return r}return o}
function swap(n,id,y){var c=cache[n];if(Array.isArray(c)){for(var i=0;i<c.length;i++)if(rid(c[i])===id){c[i]=y;break}}else if(id==="_")cache[n]=y;emit()}
async function push(n,v){var adm=!!sess(),sh=shadow[n]=shadow[n]||{};
if(!adm&&ANON_INS.indexOf(n)<0){if(MODE==="admin")throw KErr("auth","Please sign in again to save your changes.");console.warn("[kdb] shoppers cannot change",n);return{ok:true,skipped:true}}
var rows=Array.isArray(v)?v.map(function(x){return[rid(x),x]}):[["_",v]],seen={},saved=0,deleted=0;
for(var i=0;i<rows.length;i++){var id=rows[i][0],x=rows[i][1],j=JSON.stringify(x);seen[id]=1;if(sh[id]===j)continue;if(!adm&&sh[id]!==undefined)continue;
var y=await walk(x),yj=JSON.stringify(y);
var res=await api("/rest/v1/records"+(adm?"?on_conflict=shop_id,coll,id":""),{method:"POST",headers:{Prefer:(adm?"resolution=merge-duplicates,return=representation":"return=minimal")},body:JSON.stringify({shop_id:SHOP,coll:n,id:id,data:y})});
if(adm&&!(res&&res.length))throw KErr("not_saved","The database did not confirm the save. Please try again.");
sh[id]=yj;saved++;if(yj!==j)swap(n,id,y)}
if(adm&&Array.isArray(v))for(var k in sh)if(!seen[k]){var q="shop_id=eq."+encodeURIComponent(SHOP)+"&coll=eq."+encodeURIComponent(n)+"&id=eq."+encodeURIComponent(k);
var del=await api("/rest/v1/records?"+q,{method:"DELETE",headers:{Prefer:"return=representation"}});
if(!(del&&del.length)){var still=await api("/rest/v1/records?"+q+"&select=id");if(still&&still.length)throw KErr("delete_failed","The item was not deleted: the database refused the change.")}
delete sh[k];deleted++}
return{ok:true,saved:saved,deleted:deleted}}
function rd(n,f){if(LOCAL.test(n)){try{var r=localStorage.getItem("kal."+n);return r?JSON.parse(r):f}catch(e){return f}}return cache[n]===undefined?f:cp(cache[n])}
/* wr() returns a promise: it resolves only after the database confirmed the save and rejects (with a clear message) if it did not.
   On failure the screen is put back to what the database really holds. Callers that ignore the promise still get the message. */
function wr(n,v){if(LOCAL.test(n)){try{localStorage.setItem("kal."+n,JSON.stringify(v))}catch(e){}return Promise.resolve({ok:true,local:true})}
if(!ok()){var ce=KErr("config","The app is not connected to its database.");say(ce.message);return Promise.reject(ce)}
cache[n]=cp(v);emit();busy++;var c=cp(v);
var p=chain.then(function(){return push(n,c)}).then(function(r){busy--;if(again&&!busy){again=false;load()}return r},function(e){busy--;say(e.message);return load(true).then(function(){throw e})});
chain=p.catch(function(){});p.catch(function(){});return p}
async function load(force){if(!ok())return;if(busy&&!force){again=true;return}try{var q="shop_id=eq."+encodeURIComponent(SHOP),adm=!!sess(),ps=[pages("/rest/v1/records?"+q+"&select=coll,id,data&order=coll.asc,id.asc")];
if(!adm)ps.push(pages("/rest/v1/rpc/public_products?order=id.asc",{method:"POST",body:JSON.stringify({p_shop:SHOP})}));
var rs=await Promise.all(ps),rows=rs[0];
if(!adm)rows=rows.concat(rs[1].map(function(r){return{coll:"products",id:r.id,data:r.data}}));
var nc={},ns={};rows.forEach(function(r){if(r.id==="_")nc[r.coll]=r.data;else(nc[r.coll]=nc[r.coll]||[]).push(r.data);(ns[r.coll]=ns[r.coll]||{})[r.id]=JSON.stringify(r.data)});
shadow=ns;if(JSON.stringify(nc)!==JSON.stringify(cache)){cache=nc;emit()}}catch(e){console.error("[kdb] load",e)}}
async function fn(b){var r=await fetch(H+"/functions/v1/kal-admin",{method:"POST",headers:{apikey:A,"Content-Type":"application/json"},body:JSON.stringify(b)}),d=null;try{d=await r.json()}catch(e){}return{ok:r.ok,s:r.status,d:d}}
async function status(email){var r=await fn({action:"status",email:email});if(!r.ok)throw new Error("status");return!!(r.d&&r.d.enrolled)}
async function enroll(email,key){var r=await fn({action:"enroll",email:email,setup_key:key});return r.ok&&r.d&&r.d.qr?r.d:null}
async function login(email,code){var r=await fn({action:"login",email:email,code:code});if(r.s===429)return"locked";if(!r.ok||!r.d||!r.d.token_hash)return false;
var v=await fetch(H+"/auth/v1/verify",{method:"POST",headers:{apikey:A,"Content-Type":"application/json"},body:JSON.stringify({type:"magiclink",token_hash:r.d.token_hash})}),d=null;try{d=await v.json()}catch(e){}
if(!v.ok||!d||!d.access_token)return false;setSess(mk(d,email));await load();return true}
function rpc(fn,args){var p=chain.then(function(){return api("/rest/v1/rpc/"+fn,{method:"POST",body:JSON.stringify(args)})}).catch(function(e){say(e.message)}).then(function(){return load()});chain=p.catch(function(){});return p}
if(!ok())console.warn("[kdb] config.js is empty: add SUPABASE_URL, SUPABASE_ANON_KEY and SHOP_ID.");
var ready=load().then(function(){loaded=true;emit()});
setInterval(load,20000);document.addEventListener("visibilitychange",function(){if(!document.hidden)load()});
window.KDB={onError:function(f){errSubs.push(f)},token:token,rd:rd,wr:wr,on:function(f){subs.push(f)},status:status,enroll:enroll,login:login,rpc:rpc,load:load,ready:ready,session:function(){var s=sess();return s?s.email:null},signOut:function(){setSess(null);load()},get loaded(){return loaded}};
})();
