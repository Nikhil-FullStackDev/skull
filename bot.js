// Bluffing bots. They only use information a real player at the table would have:
// their own discs, stack sizes, revealed discs and the bidding so far.
const Skull = require('./public/game.js');

function weighted(items, weight, rnd) {
  const ws = items.map(weight), sum = ws.reduce((a, b) => a + b, 0);
  let r = rnd() * sum;
  for (let i = 0; i < items.length; i++) if ((r -= ws[i]) < 0) return items[i];
  return items[items.length - 1];
}

function botMove(s, id, rnd = Math.random) {
  const p = s.players[id];
  const tot = Skull.total(s);
  const others = s.players.filter(q => q.alive && q.id !== id);
  const skullDown = p.stack.some(d => d.k === 'S');
  const hasF = p.hand.includes('F'), hasS = p.hand.includes('S');

  const pickDisc = () => (hasS && !skullDown && (!hasF || rnd() < 0.3) ? 'S' : hasF ? 'F' : 'S');
  // How many flowers the bot believes it can reveal: its own stack plus a guess at
  // opponents' top discs, trusting players who have bid this round a bit more.
  const confidence = () => {
    if (skullDown) return 0;
    const bidders = others.filter(q => q.bid > 0).length;
    return p.stack.length + Math.floor(others.length * 0.5 + bidders * 0.4 + rnd() - 0.4);
  };

  switch (s.phase) {
    case 'place':
      return { type: 'place', disc: pickDisc() };
    case 'turn': {
      const crowded = tot - others.length - 1; // discs beyond one each
      const want = !p.hand.length || rnd() < (skullDown ? 0.12 : 0.25 + 0.15 * crowded);
      if (!want) return { type: 'place', disc: pickDisc() };
      // With our own skull down a bid is a bluff: open low and hope to be outbid.
      const n = skullDown ? 1 + Math.floor(rnd() * 2) : confidence();
      return { type: 'bid', n: Math.min(tot, Math.max(1, n)) };
    }
    case 'bid': {
      const next = s.high + 1;
      if (next > tot) return { type: 'pass' };
      if (skullDown) return rnd() < 0.15 && next <= tot - 2 ? { type: 'bid', n: next } : { type: 'pass' };
      return next <= confidence() ? { type: 'bid', n: next } : { type: 'pass' };
    }
    case 'reveal': {
      const targets = others.filter(q => q.stack.some(d => !d.rev));
      // Players who bid probably have flowers on top; already-flipped flowers suggest more below.
      const target = weighted(targets, q => 1 + (q.bid > 0 ? 2 : 0) + q.stack.filter(d => d.rev).length * 0.5 + (q.stack.length === 1 ? 0.5 : 0), rnd);
      return { type: 'flip', target: target.id };
    }
    case 'discard': {
      const flowers = p.hand.concat(p.stack.map(d => d.k)).filter(k => k === 'F').length;
      return { type: 'discard', disc: flowers >= 2 ? 'F' : 'S' }; // never keep a lone skull
    }
  }
  return null;
}

module.exports = { botMove };
