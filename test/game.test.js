const test = require('node:test');
const assert = require('node:assert');
const Skull = require('../public/game.js');
const { botMove } = require('../bot.js');

const mk = (n, opts = {}) => Skull.create(Array.from({ length: n }, (_, i) => ({ name: 'P' + i })), { resultMs: 0, ...opts });
const placeAll = (s, k = 'F') => s.players.forEach(p => Skull.act(s, p.id, { type: 'place', disc: k }));

test('setup: 3 flowers + skull each, placement phase', () => {
  const s = mk(4);
  assert.strictEqual(s.phase, 'place');
  s.players.forEach(p => assert.deepStrictEqual(p.hand.slice().sort(), ['F', 'F', 'F', 'S']));
  assert.strictEqual(Skull.waitingOn(s).length, 4);
});

test('view hides opponents unrevealed discs and hand contents', () => {
  const s = mk(3); placeAll(s, 'S');
  const v = Skull.view(s, 0);
  assert.strictEqual(v.players[0].stack[0].k, 'S');
  assert.strictEqual(v.players[1].stack[0].k, null);
  assert.strictEqual(typeof v.players[1].hand, 'number');
  assert.ok(Array.isArray(v.players[0].hand));
});

test('turn order: add disc then challenge; bid limits enforced', () => {
  const s = mk(3); placeAll(s);
  const t = s.turn;
  assert.ok(Skull.act(s, (t + 1) % 3, { type: 'place', disc: 'F' }).error);
  Skull.act(s, t, { type: 'place', disc: 'F' });
  const u = s.turn;
  assert.strictEqual(u, (t + 1) % 3);
  assert.ok(Skull.act(s, u, { type: 'bid', n: 5 }).error); // only 4 discs out
  assert.ok(Skull.act(s, u, { type: 'bid', n: 0 }).error);
  Skull.act(s, u, { type: 'bid', n: 2 });
  assert.strictEqual(s.phase, 'bid');
  assert.ok(Skull.act(s, s.turn, { type: 'bid', n: 2 }).error); // must raise
});

test('everyone passing sends high bidder to reveal; own stack auto-flipped', () => {
  const s = mk(3); placeAll(s);
  const c = s.turn;
  Skull.act(s, c, { type: 'bid', n: 2 });
  Skull.act(s, s.turn, { type: 'pass' });
  Skull.act(s, s.turn, { type: 'pass' });
  assert.strictEqual(s.phase, 'reveal');
  assert.strictEqual(s.challenger, c);
  assert.strictEqual(s.flipped, 1);
  assert.ok(s.players[c].stack[0].rev);
});

test('successful challenge scores; two points wins', () => {
  const s = mk(3); placeAll(s);
  const c = s.turn, o = (c + 1) % 3;
  s.players[c].points = 1;
  Skull.act(s, c, { type: 'bid', n: 2 });
  Skull.act(s, s.turn, { type: 'pass' }); Skull.act(s, s.turn, { type: 'pass' });
  assert.ok(Skull.act(s, c, { type: 'flip', target: c }).error);
  Skull.act(s, c, { type: 'flip', target: o });
  assert.strictEqual(s.phase, 'over');
  assert.strictEqual(s.winner, c);
});

test('bidding the table total ends bidding immediately', () => {
  const s = mk(3); placeAll(s);
  Skull.act(s, s.turn, { type: 'bid', n: 3 });
  assert.strictEqual(s.phase, 'reveal');
});

test('hitting an opponent skull loses a random secret disc; challenger starts next round', () => {
  const s = mk(3); s.start = 0;
  Skull.act(s, 0, { type: 'place', disc: 'F' });
  Skull.act(s, 1, { type: 'place', disc: 'S' });
  Skull.act(s, 2, { type: 'place', disc: 'F' });
  Skull.act(s, 0, { type: 'bid', n: 2 });
  Skull.act(s, 1, { type: 'pass' }); Skull.act(s, 2, { type: 'pass' });
  Skull.act(s, 0, { type: 'flip', target: 1 });
  assert.strictEqual(s.phase, 'result');
  assert.strictEqual(s.players[0].hand.length, 3);
  assert.ok(Skull.view(s, 0).result.lost);
  assert.strictEqual(Skull.view(s, 1).result.lost, undefined); // lost disc stays secret
  assert.ok(Skull.tick(s, Date.now() + 1));
  assert.strictEqual(s.phase, 'place');
  assert.strictEqual(s.start, 0);
  s.players.forEach(p => assert.strictEqual(p.stack.length, 0));
});

test('own skull lets the challenger choose the lost disc', () => {
  const s = mk(3); s.start = 0;
  Skull.act(s, 0, { type: 'place', disc: 'S' });
  Skull.act(s, 1, { type: 'place', disc: 'F' });
  Skull.act(s, 2, { type: 'place', disc: 'F' });
  Skull.act(s, 0, { type: 'bid', n: 3 });
  assert.strictEqual(s.phase, 'discard');
  Skull.act(s, 0, { type: 'discard', disc: 'S' });
  assert.deepStrictEqual(s.players[0].hand, ['F', 'F', 'F']);
});

test('losing the last disc eliminates; skull owner starts next round', () => {
  const s = mk(3); s.start = 0;
  s.players[0].hand = ['F']; s.players[1].hand = ['S'];
  Skull.act(s, 0, { type: 'place', disc: 'F' });
  Skull.act(s, 1, { type: 'place', disc: 'S' });
  Skull.act(s, 2, { type: 'place', disc: 'F' });
  Skull.act(s, 0, { type: 'bid', n: 2 });
  Skull.act(s, 1, { type: 'pass' }); Skull.act(s, 2, { type: 'pass' });
  Skull.act(s, 0, { type: 'flip', target: 1 });
  assert.strictEqual(s.players[0].alive, false);
  assert.strictEqual(s.start, 1);
});

test('last player standing wins', () => {
  const s = mk(3); s.start = 0;
  s.players[2].alive = false; s.players[2].hand = [];
  s.players[0].hand = ['F']; s.players[1].hand = ['S'];
  Skull.act(s, 0, { type: 'place', disc: 'F' });
  Skull.act(s, 1, { type: 'place', disc: 'S' });
  Skull.act(s, 0, { type: 'bid', n: 2 });
  Skull.act(s, 0, { type: 'flip', target: 1 });
  assert.strictEqual(s.phase, 'over');
  assert.strictEqual(s.winner, 1);
});

test('player with empty hand must challenge', () => {
  const s = mk(3); placeAll(s);
  const p = s.players[s.turn]; p.hand = [];
  assert.ok(Skull.act(s, p.id, { type: 'place', disc: 'F' }).error);
  assert.ok(!Skull.act(s, p.id, { type: 'bid', n: 1 }).error);
});

test('bots finish full games without stalling (3–6 players)', () => {
  for (let n = 3; n <= 6; n++) {
    for (let g = 0; g < 40; g++) {
      const s = mk(n);
      let steps = 0;
      while (s.phase !== 'over') {
        assert.ok(++steps < 5000, 'game stalled');
        if (Skull.tick(s, Date.now() + 1)) continue;
        const w = Skull.waitingOn(s);
        assert.ok(w.length, `nobody to move in ${s.phase}`);
        const id = w[0], m = botMove(s, id);
        const r = Skull.act(s, id, m);
        assert.ok(!r.error, `${s.phase} ${JSON.stringify(m)}: ${r.error}`);
        s.players.forEach(p => {
          assert.ok(p.hand.length + p.stack.length <= 4);
          assert.ok(p.hand.concat(p.stack.map(d => d.k)).filter(k => k === 'S').length <= 1);
        });
      }
      assert.ok(s.winner >= 0);
    }
  }
});
