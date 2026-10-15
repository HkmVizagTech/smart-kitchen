// The menu editor, against a running API.
//
// Checks who may open it, that a weekly-plan edit sticks, that the two ways a
// day can be wrong are refused (two lines claiming Item 1; a lunch line with an
// item number), and that a one-day override wins for its date without touching
// the plan it sits on top of.
//
//   node test/menu-editor.test.mjs      (needs the API on :4200 and the seed)

const API = process.env.API_URL || 'http://127.0.0.1:4200';
// Accounts' passwords come from the seed run, so pass the one in use:
//   TEST_PASSWORD=... node test/menu-editor.test.mjs
const PASSWORD = process.env.TEST_PASSWORD || 'devpass';
let pass=0,fail=0; const ck=(o,l)=>o?(pass++,console.log('PASS ',l)):(fail++,console.log('FAIL ',l));
// Wait out the login rate limiter rather than reporting it as a failure.
async function login(u) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`${API}/auth/login`, { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ identifier:u, password:PASSWORD }) });
    const d = await r.json().catch(()=>({}));
    if (r.ok && d.token) return d.token;
    if (r.status !== 429) throw new Error(`login ${u}: ${r.status} ${d.error ?? ''}`);
    const w = Number(String(d.error??'').match(/(\d+) second/)?.[1] ?? 10) + 1;
    console.log(`      (rate limited, waiting ${w}s)`);
    await new Promise(res=>setTimeout(res, w*1000));
  }
  throw new Error(`login ${u}: still rate limited`);
}
const kt=await login('kitchen'), bk=await login('booking');
const call=(t,p,o={})=>fetch(API+p,{...o,headers:{'content-type':'application/json',authorization:`Bearer ${t}`,...(o.headers||{})}});

ck((await call(bk,'/menu-admin/options')).status===403, 'a booker cannot open the menu editor');
const opt=await(await call(kt,'/menu-admin/options')).json();
ck(opt.dishes.length>0, `options list ${opt.dishes.length} dishes, cycles ${JSON.stringify(opt.cycles)}`);

const plan=await(await call(kt,'/menu-admin/plan?session=BREAKFAST&week=1')).json();
ck(plan.days.length===7, 'plan comes back as seven days');
const tue=plan.days.find(d=>d.day==='TUE');
ck(tue.slots.map(s=>s.dish.name).join(',')==='Idly,Biryani,Wada', `Tuesday tiffin: ${tue.slots.map(s=>s.dish.name).join(', ')}`);

// swap Tuesday's Item 3 and save
const wada=opt.dishes.find(d=>d.name==='Wada'), poori=opt.dishes.find(d=>!d.accompaniment && d.name!=='Wada' && d.name!=='Idly' && d.name!=='Biryani');
const sambar=opt.dishes.find(d=>d.name==='Sambar');
const draft=tue.slots.map(s=>({group:s.group,dishId:s.dish.id,accompanimentIds:s.accompaniments.map(a=>a.id)}));
draft[2]={group:'ITEM3',dishId:poori.id,accompanimentIds:[sambar.id]};
let r=await call(kt,'/menu-admin/plan',{method:'PUT',body:JSON.stringify({session:'BREAKFAST',week:1,day:'TUE',slots:draft})});
ck(r.ok, `saved Tuesday with Item 3 = ${poori.name} (${r.status})`);
const plan2=await(await call(kt,'/menu-admin/plan?session=BREAKFAST&week=1')).json();
const tue2=plan2.days.find(d=>d.day==='TUE');
ck(tue2.slots[2].dish.name===poori.name, `Tuesday Item 3 is now ${tue2.slots[2].dish.name}`);
ck(tue2.slots[2].accompaniments[0]?.name==='Sambar', 'its accompaniment stuck');

// two lines claiming Item 1 is refused
r=await call(kt,'/menu-admin/plan',{method:'PUT',body:JSON.stringify({session:'BREAKFAST',week:1,day:'WED',
  slots:[{group:'ITEM1',dishId:wada.id,accompanimentIds:[]},{group:'ITEM1',dishId:poori.id,accompanimentIds:[]}]})});
ck(r.status===422, `two Item 1s refused (${r.status}: ${(await r.json()).error})`);

// lunch lines must not carry an item group
r=await call(kt,'/menu-admin/plan',{method:'PUT',body:JSON.stringify({session:'LUNCH',week:1,day:'WED',
  slots:[{group:'ITEM1',dishId:poori.id,accompanimentIds:[]}]})});
ck(r.status===422, `lunch with an item number refused (${r.status})`);

// one-day override, on a day nobody has booked
const d='2026-10-20';
let day=await(await call(kt,`/menu-admin/day?date=${d}&session=BREAKFAST`)).json();
ck(day.overridden===false, `${d} comes from the plan (${day.slots.map(s=>s.dish.name).join(', ')})`);
r=await call(kt,'/menu-admin/day',{method:'PUT',body:JSON.stringify({session:'BREAKFAST',date:d,
  slots:[{group:'ITEM1',dishId:wada.id,accompanimentIds:[sambar.id]}]})});
ck(r.ok, `pinned ${d} (${r.status})`);
day=await(await call(kt,`/menu-admin/day?date=${d}&session=BREAKFAST`)).json();
ck(day.overridden===true && day.slots.length===1 && day.slots[0].dish.name==='Wada', 'the override wins for that date');

// the plan for the same weekday is untouched
const plan3=await(await call(kt,'/menu-admin/plan?session=BREAKFAST&week=1')).json();
const same=plan3.days.find(x=>x.day==='TUE');
ck(same.slots.length===3, 'the weekly plan is untouched by a one-day change');

// A day some route has already booked cannot be re-planned: their order lines
// were written at booking time and a menu change now would not reach them.
// The test books that day itself rather than relying on one being there.
const TOM = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const bkMenu = await (await call(bk, `/menu?date=${TOM}&session=BREAKFAST`)).json();
const bkSlots = {}; (bkMenu.slots || []).forEach((x) => { if (x.group) bkSlots[x.group] = 5; });
const placed = await call(bk, '/orders', { method:'POST',
  body: JSON.stringify({ date: TOM, session:'BREAKFAST', slots: bkSlots }) });
ck(placed.status === 200 || placed.status === 409, `a route has booked ${TOM} (${placed.status})`);

r=await call(kt,'/menu-admin/day',{method:'PUT',body:JSON.stringify({session:'BREAKFAST',date:TOM,
  slots:[{group:'ITEM1',dishId:wada.id,accompanimentIds:[]}]})});
ck(r.status===409, `a day with orders on it is refused (${r.status})`);

// clear the override
r=await call(kt,`/menu-admin/day?date=${d}&session=BREAKFAST`,{method:'DELETE'});
ck(r.ok, 'override removed');
day=await(await call(kt,`/menu-admin/day?date=${d}&session=BREAKFAST`)).json();
ck(day.overridden===false && day.slots.length===3, 'the date falls back to the plan');

// put Tuesday back
draft[2]={group:'ITEM3',dishId:wada.id,accompanimentIds:tue.slots[2].accompaniments.map(a=>a.id)};
await call(kt,'/menu-admin/plan',{method:'PUT',body:JSON.stringify({session:'BREAKFAST',week:1,day:'TUE',slots:draft})});

console.log(`\n${fail===0?'All':pass+'/'+(pass+fail)} checks passed${fail?` — ${fail} FAILED`:'.'}`);
process.exit(fail?1:0);
