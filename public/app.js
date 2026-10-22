const $app = document.getElementById('app');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = id => document.getElementById(id);
const NAME = { F: 'Flower', S: 'Skull' };

let session = JSON.parse(localStorage.getItem('skull-session') || 'null'); // {code, token}
let snap = null, es = null, lastErr = '', seen = new Set(), seenRound = 0;
// Local UI state that survives re-renders: the bid on the stepper, the disc picked to place, the rules sheet.
let uiBid = 1, uiBidKey = '', uiSel = null, showRules = false, wasMyMove = false;

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
  const src = es = new EventSource(`/api/events?code=${session.code}&token=${session.token}`);
  src.onmessage = e => { snap = JSON.parse(e.data); render(); };
  src.onerror = () => { if (src.readyState === EventSource.CLOSED && !unloading && es === src) checkRoom(src); };
}
// A closed stream means either the room is gone (server restarted, you were removed) or just a hiccup: the page
// is reloading, or the host returned an error page for a moment. Ask the server before forgetting the seat, so a
// refresh or pull-to-refresh never throws a player out of their game.
let unloading = false;
addEventListener('pagehide', () => { unloading = true; });
addEventListener('pageshow', () => { unloading = false; });
async function checkRoom(src) {
  let gone = false;
  try {
    const r = await fetch('/api/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: session.code, token: session.token, move: {} }) });
    gone = r.status === 404 || r.status === 403;
  } catch (e) { gone = false; }
  if (es !== src || !session || unloading) return;
  if (gone) { leave(); lastErr = 'Room closed (the server may have restarted).'; render(); }
  else setTimeout(() => { if (es === src && session) connect(); }, 2000);
}
// Reconnect at once when the page wakes (phone unlocked, network back) instead of waiting for the browser's retry.
const wake = () => { if (session && (!es || es.readyState !== 1)) connect(); };
document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
addEventListener('online', wake); addEventListener('pageshow', wake);
function leave() { if (es) es.close(); es = null; snap = null; session = null; uiSel = null; showRules = false; localStorage.removeItem('skull-session'); }
function setSession(r) { session = { code: r.code, token: r.token }; localStorage.setItem('skull-session', JSON.stringify(session)); connect(); }

// ---------- pieces ----------
const disc = (k, color, cls = '', attrs = '') => `<div class="disc ${k || ''} ${cls}" style="--c:${color}" ${attrs}><i></i></div>`;
const pts = n => `<span class="pts" title="${n} of 2 points"><b class="${n > 0 ? 'on' : ''}"></b><b class="${n > 1 ? 'on' : ''}"></b></span>`;
// Four pips: discs still owned (filled) and discs lost to skulls (crossed out).
const shortName = p => (p.bot ? p.name.replace(/ \(bot\)$/, '') : p.name);
const pips = p => `<span class="pips" title="${p.discs} of 4 discs left">${[0, 1, 2, 3].map(i => `<b class="${i < p.discs ? 'on' : 'lost'}"></b>`).join('')}</span>`;

const rules = () => `<div class="rules"><h3>HOW TO PLAY</h3><ol>
  <li>Everyone has 3 flowers and 1 skull. Each round, all players place one disc face-down.</li>
  <li>On your turn, either add another disc to your stack or <b>challenge</b>: bid how many flowers you can reveal.</li>
  <li>Others raise or pass. The highest bidder must flip that many discs: <b>their own stack first</b>, then the top discs of anyone's stacks.</li>
  <li>All flowers? Score a point. Two points wins. Hit a skull? Lose a disc at random (or choose, if it was your own skull).</li>
  <li>Lose all your discs and you're out. The last player standing also wins.</li></ol></div>`;

// ---------- screens ----------
function home() {
  $app.dataset.screen = 'home';
  $app.innerHTML = `<div class="lobbywrap"><div class="center">
    <div class="logo">${disc('F', '#d64545')}${disc('', '#3d7be0')}${disc('S', '#3aa66b')}</div>
    <h1>SKULL</h1><div class="tag">The bluffing game · 3–6 players</div>
    <input id="name" placeholder="Your name" maxlength="14" autocomplete="nickname" value="${esc(localStorage.getItem('skull-name') || '')}">
    <button class="primary" id="create">Create room</button>
    <div class="row"><input id="code" placeholder="Room code" maxlength="4" autocapitalize="characters" autocomplete="off" style="text-transform:uppercase"><button id="join">Join</button></div>
    <div class="err">${esc(lastErr)}</div>
    </div>${rules()}</div>`;
  const nm = () => { const v = $('name').value.trim(); localStorage.setItem('skull-name', v); return v; };
  const go = p => async () => { try { setSession(await p()); lastErr = ''; } catch (e) { lastErr = e.message; home(); } };
  $('create').onclick = go(() => post('create', { name: nm() }));
  $('join').onclick = go(() => post('join', { name: nm(), code: $('code').value }));
  $('code').onkeydown = e => { if (e.key === 'Enter') $('join').click(); };
  $('name').onkeydown = e => { if (e.key === 'Enter') $('create').click(); };
}

async function shareCode(code) {
  const url = location.origin + '/';
  try {
    if (navigator.share) { await navigator.share({ title: 'Skull', text: `Join my Skull game — room code ${code}`, url }); return; }
    await navigator.clipboard.writeText(code);
    toast('Room code copied');
  } catch (e) { if (e && e.name !== 'AbortError') toast(`Room code: ${code}`); }
}

function lobby() {
  const s = snap, n = s.lobby.length;
  $app.dataset.screen = 'lobby';
  $app.innerHTML = `<div class="lobbywrap"><div class="center"><div class="dim" style="text-align:center">Room code — share with friends</div>
    <button class="code" id="share" title="Share or copy the room code">${s.code}<small>${navigator.share ? 'Tap to share' : 'Tap to copy'}</small></button>
    <ul class="plist">${s.lobby.map((p, i) => `<li style="--c:${p.color}"><span class="dot"></span><span class="nm">${esc(p.name)}${i === s.you ? ' (you)' : ''}${i === 0 ? ' <span class="host" title="Host">★</span>' : ''}</span>
      <span class="dim">${p.connected ? '' : 'offline'}</span>${s.host && i > 0 ? `<button data-kick="${i}">Remove</button>` : ''}</li>`).join('')}</ul>
    ${s.host ? `
      <div class="row"><button id="bot" ${n >= 6 ? 'disabled' : ''}>+ Add bot</button>
      <button class="primary" id="start" ${n < 3 ? 'disabled' : ''}>Start game</button></div>
      ${n < 3 ? '<div class="dim" style="text-align:center">Need at least 3 players — add bots to fill seats.</div>' : ''}`
      : '<div class="dim" style="text-align:center">Waiting for the host to start…</div>'}
    <div class="row"><button id="leave">Leave</button></div></div>${rules()}</div>`;
  $('share').onclick = () => shareCode(s.code);
  $('leave').onclick = () => { leave(); render(); };
  if (s.host) {
    $('bot').onclick = () => send('addbot', {});
    $('start').onclick = () => send('start', {});
    document.querySelectorAll('[data-kick]').forEach(b => b.onclick = () => send('kick', { index: +b.dataset.kick }));
  }
}

// ---------- game pieces ----------
function stackHtml(p, canFlip) {
  if (!p.stack.length) return `<span class="empty">${p.alive ? 'no discs down' : 'eliminated'}</span>`;
  // The disc a flip would turn over: the top-most one still face-down.
  let next = -1;
  if (canFlip) for (let i = p.stack.length - 1; i >= 0; i--) if (!p.stack[i].rev) { next = i; break; }
  const html = p.stack.map((d, i) => {
    const key = `${p.id}:${i}`;
    const fresh = d.rev && !seen.has(key);
    if (d.rev) seen.add(key);
    const cls = [!d.rev && d.k ? 'peek' : '', fresh ? 'pop' : '', d.rev ? 'up' : '', i === next ? 'next' : ''].join(' ');
    return disc(d.rev || d.k ? d.k : '', p.color, cls);
  }).join('');
  return html + (p.stack.length > 1 ? `<span class="cnt" title="${p.stack.length} discs in the stack">${p.stack.length}</span>` : '');
}

function chipHtml(p, g) {
  if (!p.alive) return '<span class="chip off">OUT</span>';
  if (g.phase === 'over' && g.winner === p.id) return '<span class="chip win">WINNER</span>';
  if (g.phase === 'reveal' && g.challenger === p.id) return `<span class="chip bid">flipping ${g.flipped}/${g.high}</span>`;
  if (g.phase === 'bid' || g.phase === 'reveal' || g.phase === 'discard') return p.passed ? '<span class="chip pass">passed</span>' : p.bid ? `<span class="chip bid">bid ${p.bid}</span>` : '';
  if (g.phase === 'place' && !p.stack.length) return '<span class="chip pass">placing…</span>';
  return '';
}

const turnDone = g => g.phase === 'result' || g.phase === 'over';

function matHtml(p, g, s) {
  const active = g.waiting.includes(p.id) && g.phase !== 'place' && !turnDone(g);
  const canFlip = g.phase === 'reveal' && g.challenger === s.you && p.id !== s.you && p.stack.some(d => !d.rev);
  const hand = typeof p.hand === 'number' ? p.hand : p.hand.length;
  const online = s.lobby[p.id] ? s.lobby[p.id].connected : true;
  const r = g.result, skulled = turnDone(g) && r && !r.ok && r.skullBy === p.id;
  const cls = ['mat', active && 'active', canFlip && 'flip', p.points && 'scored', !p.alive && 'out', skulled && 'skulled',
    g.phase === 'over' && g.winner === p.id && 'winner'].filter(Boolean).join(' ');
  return `<div class="${cls}" style="--c:${p.color}" ${canFlip ? `data-flip="${p.id}" role="button" tabindex="0" aria-label="Flip ${esc(p.name)}'s top disc"` : ''}>
    ${s.host && !p.bot && p.id !== 0 && !online && p.alive ? `<button class="tobot" data-tobot="${p.id}" title="Let a bot play for them">→ bot</button>` : ''}
    <div class="mat-head"><span class="pname">${p.bot ? '<span class="botic" title="Bot">🤖</span>' : ''}${esc(shortName(p))}${online ? '' : ' <span class="offl" title="Offline">⚠</span>'}</span>${pts(p.points)}</div>
    <div class="stack">${stackHtml(p, canFlip)}</div>
    <div class="mat-foot"><span class="inv">${pips(p)}<span>${hand} in hand</span></span>${chipHtml(p, g)}</div>
    ${canFlip ? '<div class="tapflip">Tap to flip</div>' : ''}</div>`;
}

function statusHtml(g, s) {
  const P = i => g.players[i], nm = i => (i === s.you ? 'You' : esc(shortName(P(i))));
  let head = '', cls = '', extra = '';
  if (g.phase === 'place') head = g.waiting.includes(s.you) ? 'Place your first disc face-down' : `Waiting for ${g.waiting.map(nm).join(', ')} to place…`;
  else if (g.phase === 'turn') head = g.turn === s.you ? 'Your turn: add a disc or challenge' : `${nm(g.turn)} is deciding: add a disc or challenge`;
  else if (g.phase === 'bid') head = g.turn === s.you ? 'Raise the bid or pass' : `${nm(g.turn)} must raise or pass`;
  else if (g.phase === 'reveal') {
    head = g.challenger === s.you ? `Reveal ${g.high} flower${g.high > 1 ? 's' : ''}` : `${nm(g.challenger)} must reveal ${g.high} flower${g.high > 1 ? 's' : ''}`;
    extra = `<div class="prog" title="${g.flipped} of ${g.high} flowers revealed">${Array.from({ length: g.high }, (_, i) => `<b class="${i < g.flipped ? 'on' : ''}"></b>`).join('')}</div>`;
  } else if (g.phase === 'discard') head = g.challenger === s.you ? 'You hit your own skull!' : `${nm(g.challenger)} hit their own skull!`;
  else if (turnDone(g)) {
    const r = g.result;
    if (r && r.ok) { head = `${nm(r.by)} revealed ${r.high} flower${r.high > 1 ? 's' : ''} and score${r.by === s.you ? '' : 's'}!`; cls = 'good'; }
    else if (r) {
      const whose = r.skullBy === r.by ? (r.by === s.you ? 'your own' : 'their own') : (r.skullBy === s.you ? 'your' : esc(P(r.skullBy).name) + '’s');
      head = `${nm(r.by)} hit ${whose} skull and lose${r.by === s.you ? '' : 's'} a disc`;
      cls = 'bad';
      if (r.lost) extra = `<div class="lostmsg">You lost a <b>${NAME[r.lost]}</b>.</div>`;
    }
    if (g.phase === 'over') { head = `🏆 ${nm(g.winner)} win${g.winner === s.you ? '' : 's'} the game!`; cls = 'good'; }
    else extra += `<div class="timer" title="Next round"><i style="animation-duration:${g.untilIn}ms"></i></div>`;
  }
  const bid = g.high && (g.phase === 'bid' || g.phase === 'reveal' || g.phase === 'discard')
    ? `<div class="bidbig">Bid <b>${g.high}</b> by ${nm(g.highBy)} · ${g.total} disc${g.total === 1 ? '' : 's'} down</div>`
    : g.phase === 'turn' ? `<div class="bidbig">${g.total} disc${g.total === 1 ? '' : 's'} on the table</div>` : '';
  return `<section class="status ${cls}" aria-live="polite"><div class="head">${head}</div>${bid}${extra}
    <ul class="log">${g.log.slice(-6).map(l => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function standingsHtml(g) {
  const order = g.players.slice().sort((a, b) => (b.id === g.winner) - (a.id === g.winner) || b.points - a.points || b.discs - a.discs);
  return `<ol class="standings">${order.map(p => `<li style="--c:${p.color}"><span class="dot"></span><span class="nm">${esc(shortName(p))}</span>${pts(p.points)}${pips(p)}</li>`).join('')}</ol>`;
}

// The player's own area: their stack, their hand and whatever they can do right now.
function dockHtml(g, s) {
  const me = g.players[s.you], my = g.waiting.includes(s.you) && !turnDone(g);
  const canPlace = my && (g.phase === 'place' || g.phase === 'turn') && me.hand.length > 0;
  if (!canPlace || !me.hand.includes(uiSel)) uiSel = null;
  const selIdx = uiSel ? me.hand.indexOf(uiSel) : -1;
  const handHtml = me.hand.length
    ? me.hand.map((k, i) => disc(k, me.color, `${canPlace ? 'pick' : ''} ${i === selIdx ? 'sel' : ''}`,
      canPlace ? `data-place="${k}" role="button" tabindex="0" aria-pressed="${i === selIdx}" aria-label="${NAME[k]}"` : `title="${NAME[k]}"`)).join('')
    : '<span class="dim">No discs in hand.</span>';
  const placeBtn = canPlace ? (uiSel
    ? `<button class="primary ${uiSel === 'S' ? 'skullbtn' : ''}" id="place">Place ${uiSel === 'S' ? 'your Skull' : 'a Flower'}</button>`
    : (g.phase === 'turn' ? '<span class="hint">Tap a disc above to pick it</span>' : '')) : '';

  let body = '';
  if (!me.alive) body = '<div class="prompt">You are out — watch the bluffing unfold.</div>';
  else if (g.phase === 'over') body = `${standingsHtml(g)}${s.host
    ? '<div class="actions"><button class="primary" id="again">Play again</button><button id="tolobby">Back to lobby</button></div>'
    : '<div class="dim">Waiting for the host to start a new game…</div>'}`;
  else if (g.phase === 'result') body = '<div class="dim">Next round starting…</div>';
  else if (!my) {
    const who = g.waiting.filter(i => i !== s.you).map(i => esc(shortName(g.players[i])));
    body = `<div class="dim">${g.phase === 'place' && me.stack.length ? 'Disc placed. ' : ''}Waiting for ${who.join(', ') || 'others'}…</div>`;
  } else if (g.phase === 'place') body = `<div class="prompt">${uiSel ? 'Place it face-down — or tap it again.' : 'Tap a disc to place it face-down.'}</div>${uiSel ? `<div class="actions">${placeBtn}</div>` : ''}`;
  else if (g.phase === 'turn' || g.phase === 'bid') {
    const min = g.high + 1, max = g.total, key = g.phase + ':' + g.high;
    if (key !== uiBidKey) { uiBidKey = key; uiBid = min; }
    uiBid = Math.min(max, Math.max(min, uiBid));
    const stepper = `<div class="stepper" role="group" aria-label="Bid"><button id="dn" aria-label="Lower bid" ${uiBid <= min ? 'disabled' : ''}>−</button><span class="n" aria-live="polite">${uiBid}</span><button id="up" aria-label="Raise bid" ${uiBid >= max ? 'disabled' : ''}>+</button></div>`;
    if (g.phase === 'bid') body = `<div class="prompt">Raise above ${g.high} (max ${max}), or pass.</div>
      <div class="actions">${stepper}<button class="primary" id="bid">Raise to ${uiBid}</button><button id="pass">Pass</button></div>`;
    else body = `${me.hand.length ? `<div class="sect"><div class="label">Add a disc</div><div class="actions">${placeBtn}</div></div><div class="or">or</div>` : '<div class="prompt">No discs left in hand — you must challenge.</div>'}
      <div class="sect"><div class="label">Challenge: you'll reveal this many flowers</div><div class="actions">${stepper}<button class="primary alt" id="bid">Challenge ${uiBid}</button></div></div>`;
  } else if (g.phase === 'reveal') body = `<div class="prompt">Your stack is revealed. Flip ${g.high - g.flipped} more: tap a glowing stack.</div>`;
  else if (g.phase === 'discard') body = `<div class="prompt">Your own skull! Choose which disc to lose:</div><div class="choice">
      <button data-discard="F">${disc('F', me.color)}Lose a Flower</button><button data-discard="S">${disc('S', me.color)}Lose the Skull</button></div>`;

  return `<div class="mine" style="--c:${me.color}">
      <div class="mine-head"><span class="pname">${esc(me.name)} <small>(you)</small></span>${pts(me.points)}${pips(me)}${chipHtml(me, g)}</div>
      ${me.stack.length ? `<div class="stack">${stackHtml(me, false)}</div>` : ''}</div>
    <div class="hand" ${canPlace ? 'role="group" aria-label="Your discs"' : ''}>${handHtml}</div>
    ${body}`;
}

function rulesSheet() {
  return `<div class="sheet-scrim" id="rules-scrim"></div><div class="sheet" role="dialog" aria-label="How to play">${rules()}
    <button class="primary" id="rules-close">Got it</button></div>`;
}

function game() {
  const s = snap, g = s.game, me = g.players[s.you];
  if (g.round !== seenRound) { seen = new Set(); seenRound = g.round; }
  const n = g.players.length;
  const opps = Array.from({ length: n - 1 }, (_, k) => g.players[(s.you + 1 + k) % n]);
  const myMove = g.waiting.includes(s.you) && !turnDone(g) && me.alive;
  if (myMove && !wasMyMove && navigator.vibrate) { try { navigator.vibrate(30); } catch (e) { /* not allowed */ } }
  wasMyMove = myMove;
  $app.dataset.screen = 'game';
  $app.innerHTML = `<div class="game ${myMove ? 'mymove' : ''}">
    <header class="bar"><span class="title">SKULL</span><span class="meta">Round ${g.round} · <b>${s.code}</b></span>
      <button id="rulesbtn" class="icon" aria-label="How to play" title="How to play">?</button>
      <button id="chatbtn" class="icon" aria-label="Chat" title="Chat">💬<span class="cbadge hidden" id="cbadge"></span></button>
      <button id="leave">Leave</button></header>
    <section class="opps n${opps.length}">${opps.map(p => matHtml(p, g, s)).join('')}</section>
    ${statusHtml(g, s)}
    <section class="dock" id="dock">${myMove ? '<div class="yourmove">Your move</div>' : ''}${dockHtml(g, s)}</section>
  </div>${showRules ? rulesSheet() : ''}`;

  $('leave').onclick = () => { if (confirm('Leave this game?')) { leave(); render(); } };
  $('rulesbtn').onclick = () => { showRules = true; game(); };
  if ($('rules-close')) $('rules-close').onclick = $('rules-scrim').onclick = () => { showRules = false; game(); };
  $('chatbtn').onclick = () => { if (window.Chat && Chat.open) Chat.open(); };
  document.querySelectorAll('[data-place]').forEach(el => {
    const pick = () => {
      const k = el.dataset.place;
      if (uiSel === k) { uiSel = null; move({ type: 'place', disc: k }); } // a second tap on the picked disc places it
      else { uiSel = k; game(); }
    };
    el.onclick = pick;
    el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
  });
  if ($('place')) $('place').onclick = () => { const k = uiSel; uiSel = null; move({ type: 'place', disc: k }); };
  document.querySelectorAll('[data-flip]').forEach(el => {
    el.onclick = () => move({ type: 'flip', target: +el.dataset.flip });
    el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } };
  });
  document.querySelectorAll('[data-discard]').forEach(el => el.onclick = () => move({ type: 'discard', disc: el.dataset.discard }));
  document.querySelectorAll('[data-tobot]').forEach(el => el.onclick = e => { e.stopPropagation(); send('replace', { index: +el.dataset.tobot }); });
  if ($('dn')) $('dn').onclick = () => { uiBid--; game(); };
  if ($('up')) $('up').onclick = () => { uiBid++; game(); };
  if ($('bid')) $('bid').onclick = () => move({ type: 'bid', n: uiBid });
  if ($('pass')) $('pass').onclick = () => move({ type: 'pass' });
  if ($('again')) $('again').onclick = () => send('restart', {});
  if ($('tolobby')) $('tolobby').onclick = () => send('lobby', {});
  document.title = myMove ? '● Your move — Skull' : 'Skull Online';
  watchDock();
  syncChat();
}

function render() {
  if (!session) { document.title = 'Skull Online'; return home(); }
  if (!snap) { $app.dataset.screen = 'boot'; $app.innerHTML = '<div class="boot">Connecting…</div>'; return; }
  if (snap.game) game(); else { showRules = false; lobby(); }
  if (!snap.game) document.documentElement.style.setProperty('--dockh', '0px');
}

// On phones the player's dock is pinned to the bottom: everything else that floats (toasts, the idle badge, chat
// messages) sits just above it. --dockh holds its height (0 when it is not pinned, e.g. on desktop).
let dockObs = null;
function watchDock() {
  const d = $('dock');
  const set = () => {
    const el = $('dock');
    const pinned = el && getComputedStyle(el).position === 'sticky' && matchMedia('(max-width: 899px)').matches;
    document.documentElement.style.setProperty('--dockh', pinned ? el.offsetHeight + 'px' : '0px');
  };
  if (!dockObs && window.ResizeObserver) dockObs = new ResizeObserver(set);
  if (dockObs) { dockObs.disconnect(); if (d) dockObs.observe(d); }
  set();
}
addEventListener('resize', () => { if ($('dock')) watchDock(); });

// Mirror the chat's unread badge onto the header button (the floating chat button is hidden during a game).
function syncChat() {
  const b = document.querySelector('#cht-root .cht-badge'), mine = $('cbadge');
  if (mine) { const on = b && !b.hidden && b.textContent; mine.textContent = on ? b.textContent : ''; mine.classList.toggle('hidden', !on); }
  if (b && !b._watched) { b._watched = true; new MutationObserver(syncChat).observe(b, { attributes: true, childList: true, characterData: true, subtree: true }); }
}

if (session) connect();
render();

// "Your time is running out" badge: only the player the table is waiting on sees it, for the last 30 seconds.
(function idleBadge(getSnap) {
  const el = document.createElement('div');
  el.id = 'idlebadge'; el.setAttribute('role', 'status'); el.hidden = true;
  el.style.cssText = 'position:fixed;left:50%;bottom:calc(var(--dockh, 0px) + 12px + env(safe-area-inset-bottom, 0px));transform:translateX(-50%);z-index:50;padding:6px 14px;border-radius:99px;background:#000c;color:#fff;font:600 14px system-ui,sans-serif;pointer-events:none;white-space:nowrap';
  document.body.appendChild(el);
  let last = null, t0 = 0;
  setInterval(() => {
    const s = getSnap();
    if (s !== last) { last = s; t0 = Date.now(); }
    const ms = s && s.idleMsLeft != null ? s.idleMsLeft - (Date.now() - t0) : null;
    if (ms == null || ms > 30000) { el.hidden = true; return; }
    const sec = Math.max(0, Math.ceil(ms / 1000));
    el.hidden = false;
    el.textContent = sec ? `⏱ ${sec}s to move, then a bot plays for you` : '⏱ Time is up: a bot is playing for you';
    el.style.background = sec <= 10 ? '#b3262ecc' : '#000c';
  }, 500);
})(() => snap);

// In-room chat with emotes (shared chat.js). In a game it opens from the header button; its message toasts sit above the dock.
if (window.Chat) Chat.useSSE({ session: () => session, bottom: 'calc(var(--dockh, 0px) + 12px)' });
