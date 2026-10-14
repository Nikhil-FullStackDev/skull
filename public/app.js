const $app = document.getElementById('app');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = id => document.getElementById(id);
const NAME = { F: 'Flower', S: 'Skull' };

let session = JSON.parse(localStorage.getItem('skull-session') || 'null'); // {code, token}
let snap = null, es = null, lastErr = '', uiBid = 1, seen = new Set(), seenRound = 0;

async function post(path, body) {
  const r = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Error');
  return j;
}
const withRoom = b => ({ code: session.code, token: session.token, ...b });
let toastTimer;
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2500); }
const send = (path, b) => post(path, withRoom(b)).catch(e => toast(e.message));
const move = m => send('move', { move: m });

function connect() {
  if (es) es.close();
  es = new EventSource(`/api/events?code=${session.code}&token=${session.token}`);
  es.onmessage = e => { snap = JSON.parse(e.data); render(); };
  es.onerror = () => { if (es.readyState === EventSource.CLOSED) { leave(); lastErr = 'Room closed (the server may have restarted).'; render(); } };
}
function leave() { if (es) es.close(); es = null; snap = null; session = null; localStorage.removeItem('skull-session'); }
function setSession(r) { session = { code: r.code, token: r.token }; localStorage.setItem('skull-session', JSON.stringify(session)); connect(); }

// ---------- pieces ----------
const disc = (k, color, cls = '', attrs = '') => `<div class="disc ${k || ''} ${cls}" style="--c:${color}" ${attrs}><i></i></div>`;
const pts = n => `<span class="pts" title="${n}/2 points"><b class="${n > 0 ? 'on' : ''}"></b><b class="${n > 1 ? 'on' : ''}"></b></span>`;

const rules = () => `<div class="rules"><h3>HOW TO PLAY</h3><ol>
  <li>Everyone has 3 flowers and 1 skull. Each round, all players place one disc face-down.</li>
  <li>On your turn, either add another disc to your stack or <b>challenge</b>: bid how many flowers you can reveal.</li>
  <li>Others raise or pass. The highest bidder must flip that many discs: <b>their own stack first</b>, then the top discs of anyone's stacks.</li>
  <li>All flowers? Score a point. Two points wins. Hit a skull? Lose a disc at random (or choose, if it was your own skull).</li>
  <li>Lose all your discs and you're out. The last player standing also wins.</li></ol></div>`;

// ---------- screens ----------
function home() {
  $app.innerHTML = `<div class="lobbywrap"><div class="center">
    <div class="logo">${disc('F', '#d64545')}${disc('', '#3d7be0')}${disc('S', '#3aa66b')}</div>
    <h1>SKULL</h1><div class="tag">The bluffing game · 3–6 players</div>
    <input id="name" placeholder="Your name" maxlength="14" value="${esc(localStorage.getItem('skull-name') || '')}">
    <button class="primary" id="create">Create room</button>
    <div class="row"><input id="code" placeholder="Room code" maxlength="4" style="text-transform:uppercase"><button id="join">Join</button></div>
    <div class="err">${esc(lastErr)}</div>
    </div>${rules()}</div>`;
  const nm = () => { const v = $('name').value.trim(); localStorage.setItem('skull-name', v); return v; };
  const go = p => async () => { try { setSession(await p()); lastErr = ''; } catch (e) { lastErr = e.message; home(); } };
  $('create').onclick = go(() => post('create', { name: nm() }));
  $('join').onclick = go(() => post('join', { name: nm(), code: $('code').value }));
  $('code').onkeydown = e => { if (e.key === 'Enter') $('join').click(); };
}


function lobby() {
  const s = snap, n = s.lobby.length;
  $app.innerHTML = `<div class="lobbywrap"><div class="center"><div class="dim" style="text-align:center">Room code — share with friends</div>
    <div class="code">${s.code}</div>
    <ul class="plist">${s.lobby.map((p, i) => `<li style="--c:${p.color}"><span class="dot"></span><span class="nm">${esc(p.name)}${i === s.you ? ' (you)' : ''}${i === 0 ? ' ★' : ''}</span>
      <span class="dim">${p.connected ? '' : 'offline'}</span>${s.host && i > 0 ? `<button data-kick="${i}">Remove</button>` : ''}</li>`).join('')}</ul>
    ${s.host ? `
      <div class="row"><button id="bot" ${n >= 6 ? 'disabled' : ''}>+ Add bot</button>
      <button class="primary" id="start" ${n < 3 ? 'disabled' : ''}>Start game</button></div>
      ${n < 3 ? '<div class="dim" style="text-align:center">Need at least 3 players — add bots to fill seats.</div>' : ''}`
      : '<div class="dim" style="text-align:center">Waiting for the host to start…</div>'}
    <div class="row"><button id="leave">Leave</button></div></div>${rules()}</div>`;
  $('leave').onclick = () => { leave(); render(); };
  if (s.host) {
    $('bot').onclick = () => send('addbot', {});
    $('start').onclick = () => send('start', {});
    document.querySelectorAll('[data-kick]').forEach(b => b.onclick = () => send('kick', { index: +b.dataset.kick }));
  }
}

function stackHtml(p, g) {
  if (!p.stack.length) return `<span class="empty">${p.alive ? 'no discs down' : 'eliminated'}</span>`;
  return p.stack.map((d, i) => {
    const key = `${p.id}:${i}`;
    const fresh = d.rev && !seen.has(key);
    if (d.rev) seen.add(key);
    return disc(d.rev || d.k ? d.k : '', p.color, `${!d.rev && d.k ? 'peek' : ''} ${fresh ? 'pop' : ''}`);
  }).join('');
}

function matHtml(p, g, s) {
  const active = g.waiting.includes(p.id) && g.phase !== 'place';
  const canFlip = g.phase === 'reveal' && g.challenger === s.you && p.id !== s.you && p.stack.some(d => !d.rev);
  const hand = typeof p.hand === 'number' ? p.hand : p.hand.length;
  const online = s.lobby[p.id] ? s.lobby[p.id].connected : true;
  let chip = '';
  if (!p.alive) chip = '<span class="chip off">OUT</span>';
  else if (g.phase === 'bid' || g.phase === 'reveal') chip = p.passed ? '<span class="chip pass">passed</span>' : p.bid ? `<span class="chip bid">bid ${p.bid}</span>` : '';
  else if (g.phase === 'place' && !p.stack.length) chip = '<span class="chip pass">placing…</span>';
  return `<div class="mat ${active ? 'active' : ''} ${canFlip ? 'flip' : ''} ${p.points ? 'scored' : ''} ${p.alive ? '' : 'out'}" style="--c:${p.color}" ${canFlip ? `data-flip="${p.id}"` : ''}>
    ${s.host && !p.bot && p.id !== 0 && !online && p.alive ? `<button class="tobot" data-tobot="${p.id}" title="Let a bot play for them">→ bot</button>` : ''}
    <div class="mat-head"><span class="pname">${esc(p.name)}${p.id === s.you ? ' (you)' : ''}${online ? '' : ' ⚠'}</span>${pts(p.points)}</div>
    <div class="stack">${stackHtml(p, g)}</div>
    <div class="mat-foot"><span>${p.discs} disc${p.discs === 1 ? '' : 's'} · ${hand} in hand</span>${chip}</div></div>`;
}

function statusHtml(g, s) {
  const P = i => g.players[i], nm = i => (i === s.you ? 'You' : esc(P(i).name));
  let head = '', cls = '', extra = '';
  if (g.phase === 'place') head = g.waiting.includes(s.you) ? 'Place your first disc face-down' : `Waiting for ${g.waiting.map(nm).join(', ')} to place…`;
  else if (g.phase === 'turn') head = `${nm(g.turn)} ${g.turn === s.you ? 'are' : 'is'} up: add a disc or challenge`;
  else if (g.phase === 'bid') head = `${nm(g.turn)} must raise or pass`;
  else if (g.phase === 'reveal') head = `${nm(g.challenger)} ${g.challenger === s.you ? 'are' : 'is'} revealing: ${g.flipped}/${g.high} flowers`;
  else if (g.phase === 'discard') head = `${nm(g.challenger)} hit ${g.challenger === s.you ? 'your' : 'their'} own skull!`;
  else if (g.phase === 'result' || g.phase === 'over') {
    const r = g.result;
    if (r && r.ok) { head = `${nm(r.by)} revealed ${r.high} flowers and score${r.by === s.you ? '' : 's'}!`; cls = 'good'; }
    else if (r) {
      head = `${nm(r.by)} hit ${r.skullBy === r.by ? (r.by === s.you ? 'your own' : 'their own') : (r.skullBy === s.you ? 'your' : esc(P(r.skullBy).name) + '’s')} skull and lose${r.by === s.you ? '' : 's'} a disc`;
      cls = 'bad';
      if (r.lost) extra = `<div>You lost a <b>${NAME[r.lost]}</b>.</div>`;
    }
    if (g.phase === 'over') { head = `🏆 ${nm(g.winner)} win${g.winner === s.you ? '' : 's'} the game!`; cls = 'good'; }
    else extra += `<div class="timer"><i style="animation-duration:${g.untilIn}ms"></i></div>`;
  }
  const bid = g.high && (g.phase === 'bid' || g.phase === 'reveal' || g.phase === 'discard')
    ? `<div class="bidbig">Bid<b>${g.high}</b>by ${nm(g.highBy)} · ${g.total} discs on the table</div>`
    : g.phase === 'turn' ? `<div class="bidbig">${g.total} discs on the table</div>` : '';
  return `<div class="status ${cls}"><div class="head">${head}</div>${bid}${extra}
    <ul class="log">${g.log.slice(-3).map(l => `<li>${esc(l)}</li>`).join('')}</ul></div>`;
}

function panelHtml(g, s) {
  const me = g.players[s.you], my = g.waiting.includes(s.you);
  const canPlace = my && (g.phase === 'place' || g.phase === 'turn') && me.hand.length;
  const hand = me.hand.length
    ? me.hand.map(k => disc(k, me.color, canPlace ? 'pick' : '', canPlace ? `data-place="${k}" title="Place ${NAME[k]}"` : `title="${NAME[k]}"`)).join('')
    : '<span class="dim">No discs in hand.</span>';
  let body = '';
  if (!me.alive) body = '<div class="prompt">You are out — watch the bluffing unfold.</div>';
  else if (g.phase === 'over') body = s.host
    ? '<div class="actions"><button class="primary" id="again">Play again</button><button id="tolobby">Back to lobby</button></div>'
    : '<div class="dim">Waiting for the host to start a new game…</div>';
  else if (!my) body = `<div class="dim">${g.phase === 'result' ? 'Next round starting…' : 'Waiting for others…'}</div>`;
  else if (g.phase === 'place') body = '<div class="prompt">Tap a disc to place it face-down.</div>';
  else if (g.phase === 'turn' || g.phase === 'bid') {
    const min = g.high + 1, max = g.total;
    uiBid = Math.min(max, Math.max(min, uiBid));
    const prompt = g.phase === 'bid' ? `Raise above ${g.high}, or pass.`
      : me.hand.length ? 'Tap a disc to add it, or challenge:' : 'No discs left in hand — you must challenge.';
    body = `<div class="prompt">${prompt}</div><div class="actions">
      <div class="stepper"><button id="dn" ${uiBid <= min ? 'disabled' : ''}>−</button><span class="n">${uiBid}</span><button id="up" ${uiBid >= max ? 'disabled' : ''}>+</button></div>
      <button class="primary" id="bid">${g.phase === 'bid' ? 'Raise to' : 'Challenge'} ${uiBid}</button>
      ${g.phase === 'bid' ? '<button id="pass">Pass</button>' : ''}</div>`;
  } else if (g.phase === 'reveal') body = `<div class="prompt">Your stack is revealed. Flip ${g.high - g.flipped} more: tap an opponent's mat to flip their top disc.</div>`;
  else if (g.phase === 'discard') body = `<div class="prompt">Your own skull! Choose which disc to lose:</div><div class="choice">
      <button data-discard="F">${disc('F', me.color)}Flower</button><button data-discard="S">${disc('S', me.color)}Skull</button></div>`;
  return `<div class="panel"><div class="hand">${hand}</div>${body}</div>`;
}

function game() {
  const s = snap, g = s.game;
  if (g.round !== seenRound) { seen = new Set(); seenRound = g.round; }
  const n = g.players.length;
  const opps = Array.from({ length: n - 1 }, (_, k) => g.players[(s.you + 1 + k) % n]);
  $app.innerHTML = `<div class="game">
    <div class="bar"><span class="title">SKULL</span><span class="meta">Room ${s.code} · Round ${g.round}</span>
      
      <button id="leave">Leave</button></div>
    <div class="opps">${opps.map(p => matHtml(p, g, s)).join('')}</div>
    ${statusHtml(g, s)}
    <div class="me">${matHtml(g.players[s.you], g, s)}${panelHtml(g, s)}</div></div>`;

  $('leave').onclick = () => { if (confirm('Leave this game?')) { leave(); render(); } };
  document.querySelectorAll('[data-place]').forEach(el => el.onclick = () => move({ type: 'place', disc: el.dataset.place }));
  document.querySelectorAll('[data-flip]').forEach(el => el.onclick = () => move({ type: 'flip', target: +el.dataset.flip }));
  document.querySelectorAll('[data-discard]').forEach(el => el.onclick = () => move({ type: 'discard', disc: el.dataset.discard }));
  document.querySelectorAll('[data-tobot]').forEach(el => el.onclick = e => { e.stopPropagation(); send('replace', { index: +el.dataset.tobot }); });
  if ($('dn')) $('dn').onclick = () => { uiBid--; game(); };
  if ($('up')) $('up').onclick = () => { uiBid++; game(); };
  if ($('bid')) $('bid').onclick = () => move({ type: 'bid', n: uiBid });
  if ($('pass')) $('pass').onclick = () => move({ type: 'pass' });
  if ($('again')) $('again').onclick = () => send('restart', {});
  if ($('tolobby')) $('tolobby').onclick = () => send('lobby', {});
  document.title = g.waiting.includes(s.you) && g.phase !== 'result' ? '● Your move — Skull' : 'Skull Online';
}

function render() {
  if (!session) { document.title = 'Skull Online'; return home(); }
  if (!snap) { $app.innerHTML = '<div class="boot">Connecting…</div>'; return; }
  if (snap.game) game(); else lobby();
}

if (session) connect();
render();

// "Your time is running out" badge: only the player the table is waiting on sees it, for the last 30 seconds.
(function idleBadge(getSnap) {
  const el = document.createElement('div');
  el.id = 'idlebadge'; el.setAttribute('role', 'status'); el.hidden = true;
  el.style.cssText = 'position:fixed;left:50%;bottom:calc(12px + env(safe-area-inset-bottom, 0px));transform:translateX(-50%);z-index:50;padding:6px 14px;border-radius:99px;background:#000c;color:#fff;font:600 14px system-ui,sans-serif;pointer-events:none;white-space:nowrap';
  document.body.appendChild(el);
  let last = null, t0 = 0;
  setInterval(() => {
    const s = getSnap();
    if (s !== last) { last = s; t0 = Date.now(); }
    const ms = s && s.idleMsLeft != null ? s.idleMsLeft - (Date.now() - t0) : null;
    if (ms == null || ms > 30000) { el.hidden = true; return; }
    const sec = Math.max(0, Math.ceil(ms / 1000));
    el.hidden = false;
    el.textContent = sec ? `\u23f1 ${sec}s to move, then a bot plays for you` : '\u23f1 Time is up: a bot is playing for you';
    el.style.background = sec <= 10 ? '#b3262ecc' : '#000c';
  }, 500);
})(() => snap);

// In-room chat with emotes (shared chat.js).
if (window.Chat) Chat.useSSE({ session: () => session, bottom: 84 });
