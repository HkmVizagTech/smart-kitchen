// A Super Admin booking on a route's behalf, end to end.
//
// Admins do not book for themselves — they cover a route whose booker is away.
// So the route must be named (no auto-assign), the order has to read as
// admin-placed everywhere the kitchen and verification see it, and the admin
// is the one who closes it out afterwards. Covering two routes on the same day
// is the one case where the one-order-per-person-per-day rule must not bite.
//
//   node test/admin-on-behalf.test.mjs      (needs the API on :4200 and the seed)

const API = process.env.API_URL || process.env.API || 'http://127.0.0.1:4200';
const PASSWORD = process.env.TEST_PASSWORD || 'devpass';
let pass=0,fail=0; const ck=(o,l)=>o?(pass++,console.log('PASS ',l)):(fail++,console.log('FAIL ',l));
async function login(u){for(let i=0;i<6;i++){const r=await fetch(`${API}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identifier:u,password: PASSWORD})});const d=await r.json().catch(()=>({}));if(r.ok&&d.token)return d.token;if(r.status!==429)throw new Error(`${u}: ${r.status}`);const w=Number(String(d.error??'').match(/(\d+) second/)?.[1]??10)+1;await new Promise(x=>setTimeout(x,w*1000));}}
const call=(t,p,o={})=>fetch(API+p,{...o,headers:{'content-type':'application/json',authorization:`Bearer ${t}`,...(o.headers||{})}});
const admin=await login('admin'), kitchen=await login('kitchen'), b3=await login('booker3');
const T=new Date(Date.now()+864e5).toISOString().slice(0,10);
const units=await(await call(admin,'/admin/units')).json();
const u3=units.find(u=>u.name==='Unit-3');
const menu=await(await call(admin,`/menu?date=${T}&session=BREAKFAST`)).json();
const slots={}; menu.slots.forEach(s=>{ if(s.group) slots[s.group]=40; });

const r=await call(admin,'/orders',{method:'POST',body:JSON.stringify({date:T,session:'BREAKFAST',slots,unitId:u3.id})});
const rj=await r.json();
ck(r.ok && rj.assignedUnit==='Unit-3', `admin books Unit-3 on its behalf (${r.status}, ${rj.assignedUnit})`);

const mine=await(await call(admin,'/bookings/recent')).json();
const row=mine.find(o=>o.id===rj.id);
ck(row?.onBehalf===true, 'the order is flagged as placed on a route\'s behalf');
ck(row?.placedBy?.name==='Super Admin', `and names who placed it (${row?.placedBy?.name})`);

const kOrders=await(await call(kitchen,`/orders?date=${T}&session=BREAKFAST`)).json();
const kRow=kOrders.find(o=>o.id===rj.id);
ck(kRow?.bookedBy?.role==='SUPER_ADMIN', 'the kitchen sees it was booked by an admin');

const b3list=await(await call(b3,'/bookings/recent')).json();
ck(!b3list.some(o=>o.id===rj.id), 'another booker does not see it in their own list');
const peek=await call(b3,`/orders/${rj.id}/closeout-items`);
ck(peek.status===403, `and cannot close it out (${peek.status})`);
const adminPeek=await call(admin,`/orders/${rj.id}/closeout-items`);
ck(adminPeek.status===200, `the admin who booked it can (${adminPeek.status})`);

// covering a second route the same day must not trip the one-per-day rule
const u5=units.find(u=>u.name==='Visakha');
const r2=await call(admin,'/orders',{method:'POST',body:JSON.stringify({date:T,session:'BREAKFAST',slots,unitId:u5.id})});
ck(r2.ok, `the admin can also cover a second route the same day (${r2.status})`);

console.log(`\n${fail===0?'All':pass+'/'+(pass+fail)} checks passed${fail?` — ${fail} FAILED`:'.'}`);
process.exit(fail?1:0);
