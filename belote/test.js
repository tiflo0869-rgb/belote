'use strict';
// Tests du moteur : node test.js
const assert = require('assert');
const { Game, botAct, legalCards, cardPoints, makeDeck } = require('./game');

// --- Valeurs des cartes : 152 points + 10 de der = 162
let total = 0;
for (const s of ['S', 'H', 'C', 'D']) for (const c of makeDeck().filter((c) => c.endsWith(s))) total += cardPoints(c, 'H');
assert.strictEqual(total, 152, 'total des cartes = 152');

// --- Obligations de jeu
const T = 'H';
// Fournir la couleur
assert.deepStrictEqual(legalCards(['AS', '7S', 'KH'], [{ seat: 0, card: '10S' }], T, 1).sort(), ['7S', 'AS']);
// Couper quand l'adversaire est maître
assert.deepStrictEqual(legalCards(['KH', '7D', '9C'], [{ seat: 0, card: 'AS' }], T, 1), ['KH']);
// Partenaire maître : défausse libre
assert.strictEqual(legalCards(['KH', '7D', '9C'], [{ seat: 0, card: 'AS' }, { seat: 1, card: '7S' }], T, 2).length, 3);
// Surcouper obligatoire si possible
assert.deepStrictEqual(legalCards(['JH', '8H', '9C'], [{ seat: 0, card: 'AS' }, { seat: 1, card: 'KH' }], T, 2).sort(), ['JH']);
// Impossible de surcouper : on joue un atout quand même
assert.deepStrictEqual(legalCards(['8H', '9C'], [{ seat: 0, card: 'AS' }, { seat: 1, card: 'KH' }], T, 2), ['8H']);
// Atout demandé : monter
assert.deepStrictEqual(legalCards(['9H', '7H', 'AS'], [{ seat: 0, card: 'KH' }], T, 1), ['9H']);
// Atout demandé, impossible de monter : n'importe quel atout
assert.deepStrictEqual(legalCards(['7H', '8H', 'AS'], [{ seat: 0, card: 'KH' }], T, 1).sort(), ['7H', '8H']);
// Ni la couleur ni atout : tout est permis
assert.strictEqual(legalCards(['AD', '9C'], [{ seat: 0, card: 'AS' }], T, 1).length, 2);

// --- Parties complètes entre robots
let hands = 0, falls = 0, capots = 0, belotes = 0, games = 0;
const N = 300;
for (let n = 0; n < N; n++) {
  const g = new Game({ target: 501 });
  let safety = 0;
  while (g.phase !== 'gameEnd' && safety++ < 100000) {
    if (g.phase === 'handEnd') {
      const r = g.result;
      assert.strictEqual(r.pts[0] + r.pts[1], 162, 'plis + dix de der = 162');
      hands++;
      if (!r.success && r.capot === null) falls++;
      if (r.capot !== null) capots++;
      if (r.belote !== null) belotes++;
      g.nextHand();
      continue;
    }
    if (g.phase === 'play' && g.trick.length === 4) { g.resolveTrick(); continue; }
    const act = botAct(g, g.turn);
    if (act.type === 'play') g.play(g.turn, act.card); else g.bid(g.turn, act);
  }
  assert.strictEqual(g.phase, 'gameEnd', 'la partie se termine');
  assert.ok(Math.max(...g.scores) >= 501);
  games++;
}
console.log(`OK — ${games} parties, ${hands} donnes jouées (moy. ${(hands / games).toFixed(1)}/partie)`);
console.log(`Chutes: ${(100 * falls / hands).toFixed(0)}%  Capots: ${(100 * capots / hands).toFixed(1)}%  Belotes: ${(100 * belotes / hands).toFixed(0)}%`);
