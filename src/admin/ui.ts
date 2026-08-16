// The /admin dashboard — one self-contained HTML page (no external assets).
// The page itself holds no data; every API call requires the ADMIN_KEY.

export const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>habitbot admin</title>
<style>
  :root { --bg:#0f1115; --card:#171a21; --line:#262b36; --txt:#e8ebf0; --dim:#9aa4b2; --acc:#4cc2ff; --ok:#3ecf8e; --warn:#f5a623; --bad:#ff6b6b; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--txt); font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; padding:16px; }
  h1 { font-size:18px; margin:0 0 2px; } h2 { font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--dim); margin:22px 0 8px; }
  .sub { color:var(--dim); font-size:12px; margin-bottom:14px; }
  .grid { display:grid; gap:10px; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
  .big { font-size:22px; font-weight:600; }
  .chip { display:inline-block; padding:1px 8px; border-radius:999px; font-size:11px; border:1px solid var(--line); margin:1px 2px; color:var(--dim); }
  .chip.ok { color:var(--ok); border-color:var(--ok); } .chip.warn { color:var(--warn); border-color:var(--warn); } .chip.bad { color:var(--bad); border-color:var(--bad); }
  button { background:#222835; color:var(--txt); border:1px solid var(--line); border-radius:8px; padding:6px 12px; cursor:pointer; font-size:13px; }
  button:hover { border-color:var(--acc); } button.primary { background:var(--acc); color:#04121c; font-weight:600; border:none; }
  button.danger { color:var(--bad); }
  input, select, textarea { background:#0f131b; color:var(--txt); border:1px solid var(--line); border-radius:7px; padding:6px 8px; font-size:13px; width:100%; font-family:inherit; }
  label { font-size:11px; color:var(--dim); display:block; margin-bottom:2px; }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .frm { display:grid; gap:8px; grid-template-columns:repeat(auto-fill,minmax(110px,1fr)); margin-top:8px; }
  .frm .wide { grid-column: span 2; }
  details { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 14px; margin-bottom:8px; }
  summary { cursor:pointer; font-weight:600; }
  .msg { border-bottom:1px solid var(--line); padding:6px 0; font-size:13px; }
  .msg .t { color:var(--dim); font-size:11px; margin-right:8px; }
  .in { color:var(--acc); } .out { color:var(--ok); }
  #toast { position:fixed; bottom:16px; right:16px; background:#222835; border:1px solid var(--acc); padding:10px 16px; border-radius:10px; display:none; }
  #gate { position:fixed; inset:0; background:var(--bg); display:flex; align-items:center; justify-content:center; z-index:10; }
  #gate .card { width:320px; }
  .bar { height:6px; background:#0f131b; border-radius:99px; overflow:hidden; margin-top:6px; }
  .bar i { display:block; height:100%; background:var(--acc); }
</style>
</head>
<body>
<div id="gate"><div class="card">
  <h1>habitbot admin</h1>
  <p class="sub">Enter the admin key</p>
  <input id="keyIn" type="password" placeholder="admin key">
  <div style="margin-top:10px"><button class="primary" onclick="saveKey()">Unlock</button></div>
  <p id="gateErr" class="sub" style="color:var(--bad)"></p>
</div></div>

<div id="app" style="display:none; max-width:1100px; margin:0 auto;">
  <div class="row" style="justify-content:space-between">
    <div><h1>habitbot admin</h1><div class="sub" id="who"></div></div>
    <div class="row">
      <button onclick="load()">↻ Refresh</button>
      <button onclick="localStorage.removeItem('hb_key');location.reload()">Lock</button>
    </div>
  </div>

  <h2>Today</h2>
  <div class="grid" id="cards"></div>

  <h2>Quick actions</h2>
  <div class="row card" style="padding:10px 14px">
    <button onclick="mode({soft:true})">🤍 Soft mode</button>
    <button onclick="mode({soft:false})">Soft off</button>
    <button onclick="mode({pause_hours:4})">⏸ Pause 4h</button>
    <button onclick="mode({pause_hours:0})">▶ Resume</button>
    <button onclick="tick()">⚡ Force tick</button>
    <span style="width:12px"></span>
    <select id="testSel" style="width:auto">
      <option>water</option><option>morning</option><option>vitamin</option>
      <option>escalate</option><option>coupon</option><option>report</option><option>soft</option>
    </select>
    <button onclick="testMsg()">Send test → my WhatsApp</button>
  </div>

  <h2>Habits</h2>
  <div id="habits"></div>
  <details><summary>➕ Add a habit</summary><div id="newHabit"></div></details>

  <h2>Reward coupons</h2>
  <div class="card">
    <div id="coupons"></div>
    <div class="frm" style="margin-top:12px">
      <div class="wide"><label>Title</label><input id="cTitle" placeholder="1x back massage"></div>
      <div><label>Trigger</label><select id="cTrig"><option value="streak_milestone">streak</option><option value="perfect_week">perfect week</option><option value="any">any milestone</option></select></div>
      <div><label>Value (e.g. 7)</label><input id="cVal" type="number" placeholder="7"></div>
      <div><label>Voice note file</label><input id="cMedia" placeholder="note1.ogg (optional)"></div>
      <div style="align-self:end"><button class="primary" onclick="addCoupon()">Stock it</button></div>
    </div>
  </div>

  <h2>Her settings</h2>
  <div class="card"><div class="frm">
    <div><label>Her name / nickname</label><input id="uN" placeholder="Priya"></div>
    <div><label>Wake start</label><input id="uWs"></div>
    <div><label>Wake end</label><input id="uWe"></div>
    <div><label>Persona</label><select id="uP"><option value="sassy">sassy</option><option value="sweet">sweet</option><option value="pet">pet</option></select></div>
    <div><label>Language</label><select id="uL"><option value="en">English</option><option value="hinglish">Hinglish</option></select></div>
  </div>
  <div style="margin-top:10px"><label>About her — everything the bot should know (inside jokes, what she loves, exam dates, your dynamic; one fact per line). Used with a light touch — never to guilt her.</label>
  <textarea id="uA" rows="6" placeholder="• she calls Rishabh 'Rishu'&#10;• obsessed with chai, hates plain water excuses&#10;• rewatching the same show for the 4th time&#10;• big exam on Sept 2 — go extra gentle that week"></textarea></div>
  <div class="row" style="margin-top:8px; justify-content:space-between">
    <span class="sub">She can also change persona/language herself by texting the bot. Quick add from WhatsApp: /note &lt;fact&gt;</span>
    <button class="primary" onclick="saveUser()">Save</button>
  </div></div>

  <h2>Recent messages</h2>
  <div class="card" id="log"></div>
</div>
<div id="toast"></div>

<script>
var S = null;
function key(){ return localStorage.getItem('hb_key') || ''; }
function saveKey(){ localStorage.setItem('hb_key', document.getElementById('keyIn').value.trim()); load(); }
function toast(t){ var el=document.getElementById('toast'); el.textContent=t; el.style.display='block'; setTimeout(function(){el.style.display='none';},2500); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }

function api(path, body){
  return fetch('/admin/api'+path, {
    method: body===undefined?'GET':'POST',
    headers: { 'Authorization':'Bearer '+key(), 'Content-Type':'application/json' },
    body: body===undefined?undefined:JSON.stringify(body)
  }).then(function(r){
    if (r.status===401){ show(false, 'Wrong key'); throw new Error('unauthorized'); }
    return r.json().then(function(j){ if(!r.ok){ toast('Error: '+(j.error||r.status)); throw new Error(j.error||r.status);} return j; });
  });
}
function show(app, err){
  document.getElementById('gate').style.display = app?'none':'flex';
  document.getElementById('app').style.display = app?'block':'none';
  if (err) document.getElementById('gateErr').textContent = err;
}

function load(){
  if (!key()) { show(false,''); return; }
  api('/overview').then(function(d){ S=d; show(true); render(); }).catch(function(){});
}

function render(){
  var p=S.player;
  document.getElementById('who').textContent = S.day+' · '+p.display_name+' · '+(p.persona||'not onboarded')+' / '+p.language+' · awake '+p.wake_start+'-'+p.wake_end;

  var cards='';
  S.habits.forEach(function(h){
    if(!h.active) return;
    var pct = Math.min(100, Math.round(100*h.done_today/h.target_count));
    var state = !h.due_today?'<span class="chip">not due today</span>' : h.skipped_today?'<span class="chip warn">skipped</span>' : h.complete_today?'<span class="chip ok">done ✓</span>':'<span class="chip">in progress</span>';
    cards += '<div class="card"><div class="row" style="justify-content:space-between"><b>'+esc(h.emoji+' '+h.name)+'</b>'+state+'</div>'
      +'<div class="big">'+h.done_today+'/'+h.target_count+' <span style="font-size:12px;color:var(--dim)">'+esc(h.unit)+'s</span></div>'
      +'<div class="bar"><i style="width:'+pct+'%"></i></div>'
      +'<div class="sub" style="margin:6px 0 0">streak '+h.streak+' · best '+h.best+'</div></div>';
  });
  cards += '<div class="card"><b>⭐ Overall</b><div class="big">'+S.points+' pts</div><div class="sub" style="margin-top:6px">perfect-day streak '+S.perfect_streak+'</div></div>';
  var flags='';
  flags += p.window_open?'<span class="chip ok">24h window open</span>':'<span class="chip warn">window closed</span>';
  if(p.soft) flags+='<span class="chip warn">soft mode</span>';
  if(p.paused_until) flags+='<span class="chip bad">paused</span>';
  if(!p.onboarded) flags+='<span class="chip bad">not onboarded</span>';
  cards += '<div class="card"><b>🛰 Bot state</b><div style="margin-top:8px">'+flags+'</div><div class="sub" style="margin-top:8px">sent today: '+(S.nudges_today.join(', ')||'nothing yet')+'</div></div>';
  document.getElementById('cards').innerHTML = cards;

  document.getElementById('habits').innerHTML = S.habits.map(function(h){ return habitCard(h,false); }).join('');
  document.getElementById('newHabit').innerHTML = habitCard({ id:'', name:'', emoji:'✨', active:1, schedule_type:'daily', interval_days:'', anchor_date:S.day, weekly_days:'', anchor_time:'', window_start:'', window_end:'', target_count:1, unit:'time', pacing:'once', nag_max_per_day:3, nag_min_gap_min:90, points:10 }, true);

  var cp='';
  S.coupons.forEach(function(cn){
    var chip = cn.status==='stocked'?'<span class="chip">stocked</span>':cn.status==='earned'?'<span class="chip ok">earned 🎉</span>':'<span class="chip warn">redeemed</span>';
    var del = cn.status==='stocked'?' <button class="danger" onclick="delCoupon('+cn.id+')">✕</button>':'';
    cp += '<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--line);padding:6px 0"><div>'+esc(cn.title)
      +' <span class="sub">('+esc(cn.trigger_type)+(cn.trigger_value?':'+cn.trigger_value:'')+(cn.media_ref?' · 🎙 '+esc(cn.media_ref):'')+')</span></div><div>'+chip+del+'</div></div>';
  });
  document.getElementById('coupons').innerHTML = cp || '<span class="sub">no coupons yet</span>';

  document.getElementById('uN').value=p.display_name||'';
  document.getElementById('uWs').value=p.wake_start; document.getElementById('uWe').value=p.wake_end;
  if(p.persona) document.getElementById('uP').value=p.persona;
  document.getElementById('uL').value=p.language;
  document.getElementById('uA').value=p.about||'';

  document.getElementById('log').innerHTML = S.messages.map(function(m){
    var d=new Date(m.created_at);
    return '<div class="msg"><span class="t">'+d.toLocaleString()+'</span><b class="'+m.direction+'">'+(m.direction==='in'?'her→':'bot→')+'</b> '
      +'<span class="sub">['+esc(m.kind)+(m.status!=='sent'&&m.status!=='received'?' · '+esc(m.status):'')+']</span> '+esc(m.body)+'</div>';
  }).join('') || '<span class="sub">no messages yet</span>';
}

function habitCard(h, isNew){
  var i = isNew?'new':h.id;
  function f(label, id, val, ph){ return '<div><label>'+label+'</label><input id="h_'+id+'_'+i+'" value="'+esc(val==null?'':val)+'" placeholder="'+(ph||'')+'"></div>'; }
  var head = isNew?'' : '<div class="row" style="justify-content:space-between"><b>'+esc(h.emoji+' '+h.name)+' <span class="sub">('+h.id+')</span></b>'
    +'<button onclick="toggleHabit(\\''+h.id+'\\','+(h.active?0:1)+')">'+(h.active?'Pause':'Resume')+'</button></div>';
  return '<details '+(isNew?'open':'')+'><summary>'+(isNew?'New habit':esc(h.emoji+' '+h.name)+(h.active?'':' — PAUSED'))+'</summary>'+head
    +'<div class="frm">'
    + f('id (short slug)','id',h.id,'sunscreen') + f('Name','name',h.name,'Sunscreen') + f('Emoji','emoji',h.emoji)
    +'<div><label>Schedule</label><select id="h_st_'+i+'"><option'+(h.schedule_type==='daily'?' selected':'')+'>daily</option><option'+(h.schedule_type==='every_n_days'?' selected':'')+'>every_n_days</option><option'+(h.schedule_type==='weekly'?' selected':'')+'>weekly</option></select></div>'
    + f('Every N days','in',h.interval_days,'2') + f('Anchor date','ad',h.anchor_date,'2026-08-15') + f('Weekly days','wd',h.weekly_days,'mon,thu')
    + f('Fixed time','at',h.anchor_time,'09:30') + f('Window start','ws',h.window_start,'09:00') + f('Window end','we',h.window_end,'21:00')
    + f('Target/day','tc',h.target_count) + f('Unit','un',h.unit,'glass')
    +'<div><label>Pacing</label><select id="h_pc_'+i+'"><option'+(h.pacing==='once'?' selected':'')+'>once</option><option'+(h.pacing==='spread'?' selected':'')+'>spread</option></select></div>'
    + f('Max nags/day','nm',h.nag_max_per_day) + f('Min gap (min)','ng',h.nag_min_gap_min) + f('Points','pt',h.points)
    +'<div style="align-self:end"><button class="primary" onclick="saveHabit(\\''+i+'\\','+(isNew?1:0)+','+(isNew||h.active?1:0)+')">'+(isNew?'Create':'Save')+'</button></div>'
    +'</div></details>';
}

function gv(id,i){ var el=document.getElementById('h_'+id+'_'+i); return el?el.value.trim():''; }
function saveHabit(i,isNew,act){
  var body = {
    id: gv('id',i), name: gv('name',i), emoji: gv('emoji',i),
    schedule_type: document.getElementById('h_st_'+i).value,
    interval_days: gv('in',i)||null, anchor_date: gv('ad',i)||null, weekly_days: gv('wd',i)||null,
    anchor_time: gv('at',i)||null, window_start: gv('ws',i)||null, window_end: gv('we',i)||null,
    target_count: gv('tc',i), unit: gv('un',i), pacing: document.getElementById('h_pc_'+i).value,
    nag_max_per_day: gv('nm',i), nag_min_gap_min: gv('ng',i), points: gv('pt',i), active: act ? 1 : 0
  };
  api('/habits', body).then(function(){ toast(isNew?'Habit created':'Habit saved'); load(); });
}
function toggleHabit(id, active){ api('/habits/toggle',{id:id,active:!!active}).then(function(){ load(); }); }
function addCoupon(){
  api('/coupons',{ title:document.getElementById('cTitle').value, trigger_type:document.getElementById('cTrig').value,
    trigger_value:document.getElementById('cVal').value||null, media_ref:document.getElementById('cMedia').value||null })
  .then(function(){ toast('Coupon stocked'); document.getElementById('cTitle').value=''; load(); });
}
function delCoupon(id){ if(confirm('Delete this coupon?')) api('/coupons/delete',{id:id}).then(function(){ load(); }); }
function mode(m){ api('/mode',m).then(function(){ toast('Done'); load(); }); }
function tick(){ api('/tick',{}).then(function(r){ toast('Tick: '+(r.sent&&r.sent.length? r.sent.map(function(s){return s.kind;}).join(', '):'nothing to send')); load(); }); }
function testMsg(){ api('/test',{what:document.getElementById('testSel').value}).then(function(){ toast('Sent to your WhatsApp'); }); }
function saveUser(){
  api('/user',{ wake_start:document.getElementById('uWs').value, wake_end:document.getElementById('uWe').value,
    persona:document.getElementById('uP').value, language:document.getElementById('uL').value,
    display_name:document.getElementById('uN').value, about:document.getElementById('uA').value })
  .then(function(){ toast('Saved'); load(); });
}
load();
</script>
</body>
</html>`;
