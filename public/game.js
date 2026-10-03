// Skull rules engine — shared by server (authoritative) and browser (constants).
(function (root) {
  const COLORS = ['#d64545', '#3d7be0', '#3aa66b', '#8e5bd6', '#e88a2e', '#22a6a3'];
  const WIN_POINTS = 2, RESULT_MS = 4000;

  const say = (s, m) => { s.log.push(m); if (s.log.length > 40) s.log.shift(); };
  const total = s => s.players.reduce((n, p) => n + p.stack.length, 0);
  const has = (p, k) => p.hand.includes(k) || p.stack.some(d => d.k === k);
  const discCount = p => p.hand.length + p.stack.length;
  function nextAlive(s, i, skip) {
    const n = s.players.length;
    for (let k = 1; k <= n; k++) {
      const p = s.players[(i + k) % n];
      if (p.alive && !(skip && skip(p))) return p.id;
    }
    return -1;
  }

  function create(players, opts = {}) {
    const rng = opts.rng || Math.random;
    const s = {
      players: players.map((p, i) => ({
        id: i, name: p.name, bot: !!p.bot, color: COLORS[i % COLORS.length],
        hand: ['F', 'F', 'F', 'S'], stack: [], points: 0, alive: true, passed: false, bid: 0,
      })),
      phase: 'place', round: 1, start: Math.floor(rng() * players.length), turn: -1,
      high: 0, highBy: -1, challenger: -1, skullBy: -1, flipped: 0,
      result: null, until: 0, winner: -1, log: [], rng, resultMs: opts.resultMs ?? RESULT_MS,
    };
    say(s, 'Round 1 — everyone places a disc.');
    return s;
  }

  function waitingOn(s) {
    if (s.phase === 'place') return s.players.filter(p => p.alive && !p.stack.length).map(p => p.id);
    if (s.phase === 'turn' || s.phase === 'bid') return [s.turn];
    if (s.phase === 'reveal' || s.phase === 'discard') return [s.challenger];
    return [];
  }

  function place(s, p, k) {
    const i = p.hand.indexOf(k);
    if (i < 0) return { error: 'You have no such disc in hand' };
    p.hand.splice(i, 1);
    p.stack.push({ k, rev: false });
    return null;
  }

  function setBid(s, p, n) {
    n = Math.floor(Number(n));
    if (!(n > s.high && n <= total(s))) return { error: `Bid must be ${s.high + 1}–${total(s)}` };
    s.high = n; s.highBy = p.id; p.bid = n;
    return null;
  }

  function act(s, id, m, now = Date.now()) {
    const p = s.players[id], t = m && m.type;
    if (!p || !p.alive) return { error: 'You are out of the game' };
    if (!waitingOn(s).includes(id)) return { error: 'Not your turn' };

    if (s.phase === 'place') {
      if (t !== 'place') return { error: 'Place a disc first' };
      const e = place(s, p, m.disc); if (e) return e;
      if (!waitingOn(s).length) {
        s.phase = 'turn'; s.turn = s.start;
        say(s, `${s.players[s.start].name} goes first.`);
      }
      return { ok: true };
    }
    if (s.phase === 'turn') {
      if (t === 'place') {
        const e = place(s, p, m.disc); if (e) return e;
        say(s, `${p.name} adds a disc.`);
        s.turn = nextAlive(s, id);
        return { ok: true };
      }
      if (t === 'bid') {
        const e = setBid(s, p, m.n); if (e) return e;
        s.phase = 'bid';
        say(s, `${p.name} challenges: ${s.high}.`);
        return advanceBid(s, now);
      }
      return { error: p.hand.length ? 'Place a disc or challenge' : 'No discs in hand — you must challenge' };
    }
    if (s.phase === 'bid') {
      if (t === 'pass') { p.passed = true; say(s, `${p.name} passes.`); return advanceBid(s, now); }
      if (t === 'bid') {
        const e = setBid(s, p, m.n); if (e) return e;
        say(s, `${p.name} raises to ${s.high}.`);
        return advanceBid(s, now);
      }
      return { error: 'Raise or pass' };
    }
    if (s.phase === 'reveal') {
      if (t !== 'flip') return { error: 'Flip a disc' };
      return flip(s, p, Number(m.target), now);
    }
    if (s.phase === 'discard') {
      if (t !== 'discard' || !has(p, m.disc)) return { error: 'Choose a disc you own' };
      return fail(s, p, m.disc, now);
    }
    return { error: 'Not now' };
  }

  function advanceBid(s, now) {
    const left = s.players.filter(q => q.alive && !q.passed);
    if (s.high >= total(s) || left.length <= 1) return beginReveal(s, now);
    s.turn = nextAlive(s, s.turn, q => q.passed);
    return { ok: true };
  }

  function beginReveal(s, now) {
    const c = s.players[s.highBy];
    s.phase = 'reveal'; s.challenger = s.turn = c.id; s.flipped = 0;
    say(s, `${c.name} must reveal ${s.high} flower${s.high > 1 ? 's' : ''}.`);
    for (let i = c.stack.length - 1; i >= 0; i--) { // own stack first, top down
      const d = c.stack[i];
      d.rev = true;
      if (d.k === 'S') {
        s.skullBy = c.id;
        say(s, `${c.name} reveals their own skull!`);
        if (!has(c, 'F')) return fail(s, c, 'S', now);
        s.phase = 'discard';
        return { ok: true };
      }
      if (++s.flipped >= s.high) return succeed(s, c, now);
    }
    return { ok: true };
  }

  function flip(s, c, target, now) {
    const q = s.players[target];
    if (!q || q.id === c.id) return { error: "Flip another player's stack" };
    const d = q.stack.slice().reverse().find(x => !x.rev);
    if (!d) return { error: 'That stack is fully revealed' };
    d.rev = true;
    if (d.k === 'S') {
      s.skullBy = q.id;
      say(s, `${c.name} flips ${q.name}'s skull!`);
      return fail(s, c, null, now);
    }
    s.flipped++;
    say(s, `${c.name} flips a flower from ${q.name} (${s.flipped}/${s.high}).`);
    return s.flipped >= s.high ? succeed(s, c, now) : { ok: true };
  }

  // Snapshot the table for the result screen, then pick everyone's discs back up.
  function collect(s, result) {
    s.result = { ...result, high: s.high, table: s.players.map(p => p.stack.map(d => ({ ...d }))) };
    s.players.forEach(p => {
      p.hand.push(...p.stack.map(d => d.k));
      p.hand.sort();
      p.stack = []; p.passed = false; p.bid = 0;
    });
  }

  function finishRound(s, starter, now) {
    const left = s.players.filter(p => p.alive);
    const champ = s.players.find(p => p.points >= WIN_POINTS) || (left.length === 1 ? left[0] : null);
    if (champ) {
      s.phase = 'over'; s.winner = champ.id; s.turn = -1;
      say(s, `${champ.name} wins the game!`);
    } else {
      s.phase = 'result'; s.until = now + s.resultMs; s.start = starter; s.turn = -1;
    }
    return { ok: true };
  }

  function succeed(s, c, now) {
    c.points++;
    say(s, `${c.name} succeeds and scores (${c.points}/${WIN_POINTS})!`);
    collect(s, { ok: true, by: c.id, skullBy: -1 });
    return finishRound(s, c.id, now);
  }

  function fail(s, c, kind, now) {
    const skullBy = s.skullBy;
    collect(s, { ok: false, by: c.id, skullBy });
    if (!kind) kind = c.hand[Math.floor(s.rng() * c.hand.length)]; // skull owner picks blind
    c.hand.splice(c.hand.indexOf(kind), 1);
    s.result.lost = kind;
    say(s, `${c.name} fails and loses a disc (${c.hand.length} left).`);
    let starter = c.id;
    if (!c.hand.length) {
      c.alive = false;
      say(s, `${c.name} is out of discs and eliminated.`);
      starter = skullBy !== c.id && s.players[skullBy].alive ? skullBy : nextAlive(s, c.id);
    }
    return finishRound(s, starter, now);
  }

  function nextRound(s) {
    s.round++;
    s.phase = 'place'; s.turn = -1;
    s.high = 0; s.highBy = -1; s.challenger = -1; s.skullBy = -1; s.flipped = 0; s.result = null;
    say(s, `Round ${s.round} — everyone places a disc.`);
  }

  // Advance timed phases; returns true when the state changed.
  function tick(s, now = Date.now()) {
    if (s.phase === 'result' && now >= s.until) { nextRound(s); return true; }
    return false;
  }

  // What player `me` is allowed to see.
  function view(s, me) {
    const showTable = (s.phase === 'result' || s.phase === 'over') && s.result;
    const r = s.result;
    return {
      phase: s.phase, round: s.round, turn: s.turn, start: s.start, high: s.high, highBy: s.highBy,
      challenger: s.challenger, skullBy: s.skullBy, flipped: s.flipped, winner: s.winner,
      total: total(s), waiting: waitingOn(s), untilIn: s.phase === 'result' ? Math.max(0, s.until - Date.now()) : 0,
      log: s.log.slice(-8),
      result: r && { ok: r.ok, by: r.by, skullBy: r.skullBy, high: r.high, lost: r.by === me ? r.lost : undefined },
      players: s.players.map((p, i) => ({
        id: p.id, name: p.name, bot: p.bot, color: p.color, alive: p.alive, points: p.points,
        passed: p.passed, bid: p.bid, discs: discCount(p),
        hand: p.id === me ? p.hand.slice() : p.hand.length,
        stack: (showTable ? r.table[i] : p.stack).map(d => ({ rev: d.rev, k: d.rev || p.id === me ? d.k : null })),
      })),
    };
  }

  const api = { COLORS, WIN_POINTS, create, act, tick, view, waitingOn, total };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Skull = api;
})(this);
