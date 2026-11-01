'use strict';
/**
 * Moteur de jeu de belote (4 joueurs, 2 équipes, 32 cartes).
 * Sièges 0..3 dans l'ordre de jeu (sens inverse des aiguilles d'une montre).
 * Équipes : sièges 0 et 2 = équipe 0 ; sièges 1 et 3 = équipe 1.
 * Cartes : chaîne "<rang><couleur>", ex. "10H", "JS", "AD".
 * Couleurs : S = pique, H = cœur, C = trèfle, D = carreau.
 */

const SUITS = ['S', 'H', 'C', 'D'];
const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
// Du plus faible au plus fort
const TRUMP_ORDER = ['7', '8', 'Q', 'K', '10', 'A', '9', 'J'];
const PLAIN_ORDER = ['7', '8', '9', 'J', 'Q', 'K', '10', 'A'];
const TRUMP_PTS = { J: 20, '9': 14, A: 11, '10': 10, K: 4, Q: 3, '8': 0, '7': 0 };
const PLAIN_PTS = { A: 11, '10': 10, K: 4, Q: 3, J: 2, '9': 0, '8': 0, '7': 0 };

const CONTRACT = 82;       // points nécessaires pour le camp preneur (sans la belote)
const CAPOT_SCORE = 252;
const FALL_SCORE = 162;
const DIX_DE_DER = 10;
const BELOTE_PTS = 20;

const suitOf = (c) => c.slice(-1);
const rankOf = (c) => c.slice(0, -1);

function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push(r + s);
  return d;
}

function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cardPoints(card, trump) {
  return suitOf(card) === trump ? TRUMP_PTS[rankOf(card)] : PLAIN_PTS[rankOf(card)];
}

// Force d'une carte dans un pli : atout > couleur demandée > rien
function strength(card, trump, led) {
  const s = suitOf(card), r = rankOf(card);
  if (s === trump) return 100 + TRUMP_ORDER.indexOf(r);
  if (s === led) return PLAIN_ORDER.indexOf(r);
  return -1;
}

function trickWinnerIndex(trick, trump) {
  const led = suitOf(trick[0].card);
  let best = 0;
  for (let i = 1; i < trick.length; i++) {
    if (strength(trick[i].card, trump, led) > strength(trick[best].card, trump, led)) best = i;
  }
  return best;
}

function sortHand(hand, trump) {
  return hand.slice().sort((a, b) => {
    const sa = SUITS.indexOf(suitOf(a)), sb = SUITS.indexOf(suitOf(b));
    if (sa !== sb) return sa - sb;
    const order = suitOf(a) === trump ? TRUMP_ORDER : PLAIN_ORDER;
    return order.indexOf(rankOf(b)) - order.indexOf(rankOf(a));
  });
}

/**
 * Cartes jouables :
 *  - fournir la couleur demandée (et monter à l'atout si l'atout est demandé) ;
 *  - sinon, couper (et surcouper si possible) sauf si le partenaire est maître ;
 *  - sinon, n'importe quelle carte.
 */
function legalCards(hand, trick, trump, seat) {
  if (trick.length === 0) return hand.slice();
  const led = suitOf(trick[0].card);
  const follow = hand.filter((c) => suitOf(c) === led);
  const trumpStrengths = trick
    .filter((t) => suitOf(t.card) === trump)
    .map((t) => strength(t.card, trump, led));
  const bestTrump = trumpStrengths.length ? Math.max(...trumpStrengths) : -1;

  if (led === trump) {
    if (follow.length) {
      const higher = follow.filter((c) => strength(c, trump, led) > bestTrump);
      return higher.length ? higher : follow;
    }
    return hand.slice();
  }
  if (follow.length) return follow;

  const winner = trick[trickWinnerIndex(trick, trump)];
  if (winner.seat % 2 === seat % 2) return hand.slice(); // partenaire maître : défausse libre
  const myTrumps = hand.filter((c) => suitOf(c) === trump);
  if (myTrumps.length) {
    const higher = myTrumps.filter((c) => strength(c, trump, led) > bestTrump);
    return higher.length ? higher : myTrumps;
  }
  return hand.slice();
}

function explainIllegal(hand, trick, trump) {
  const led = suitOf(trick[0].card);
  if (led === trump && hand.some((c) => suitOf(c) === trump)) return 'Vous devez jouer atout et monter si vous le pouvez.';
  if (hand.some((c) => suitOf(c) === led)) return 'Vous devez fournir la couleur demandée.';
  return 'Vous devez couper (et surcouper si possible) car l’adversaire est maître.';
}

class Game {
  constructor({ target = 501, rng = Math.random, dealer } = {}) {
    this.target = target;
    this.rng = rng;
    this.scores = [0, 0];
    this.dealer = dealer === undefined ? Math.floor(rng() * 4) : dealer;
    this.handNo = 1;
    this.eventId = 0;
    this.event = null;
    this.winnerTeam = null;
    this.startHand();
  }

  emit(type, seat, text) {
    this.eventId++;
    this.event = { id: this.eventId, type, seat, text };
  }

  startHand() {
    const deck = shuffle(makeDeck(), this.rng);
    this.hands = [[], [], [], []];
    for (let i = 0; i < 20; i++) this.hands[i % 4].push(deck[i]);
    this.retourne = deck[20];
    this.stock = deck.slice(21);
    this.hands = this.hands.map((h) => sortHand(h, null));
    this.trump = null;
    this.taker = null;
    this.round = 1;
    this.passes = 0;
    this.bidLog = [];
    this.turn = (this.dealer + 1) % 4;
    this.phase = 'bid1';
    this.trick = [];
    this.lastTrick = null;
    this.tricksWon = [0, 0];
    this.ptsWon = [0, 0];
    this.result = null;
    this.beloteSeat = null;
    this.beloteCount = 0;
    this.beloteTeam = null;
  }

  nextHand() {
    if (this.phase !== 'handEnd') throw new Error('La donne n’est pas terminée.');
    this.dealer = (this.dealer + 1) % 4;
    this.handNo++;
    this.startHand();
  }

  bid(seat, action) {
    if (this.phase !== 'bid1' && this.phase !== 'bid2') throw new Error('Ce n’est pas le moment des enchères.');
    if (seat !== this.turn) throw new Error('Ce n’est pas votre tour.');

    if (action.type === 'pass') {
      this.bidLog.push({ seat, a: 'pass' });
      this.emit('pass', seat, 'Passe');
      this.passes++;
      if (this.passes === 4) {
        if (this.phase === 'bid1') {
          this.phase = 'bid2';
          this.round = 2;
          this.passes = 0;
          this.bidLog = [];
          this.turn = (this.dealer + 1) % 4;
        } else {
          this.emit('redeal', null, 'Tout le monde passe : nouvelle donne');
          this.dealer = (this.dealer + 1) % 4;
          this.startHand();
        }
      } else {
        this.turn = (this.turn + 1) % 4;
      }
      return;
    }

    if (action.type === 'take') {
      let suit;
      if (this.phase === 'bid1') {
        suit = suitOf(this.retourne);
      } else {
        suit = action.suit;
        if (!SUITS.includes(suit)) throw new Error('Couleur invalide.');
        if (suit === suitOf(this.retourne)) throw new Error('Cette couleur a été refusée au 1er tour.');
      }
      this.takeTrump(seat, suit);
      return;
    }
    throw new Error('Action inconnue.');
  }

  takeTrump(seat, suit) {
    this.trump = suit;
    this.taker = seat;
    this.bidLog.push({ seat, a: 'take', suit });
    this.emit('take', seat, 'Prend');
    const stock = this.stock.slice();
    if (this.phase === 'bid1') {
      // Le preneur reçoit la retourne + 2 cartes, les autres 3 cartes : 8 cartes chacun
      this.hands[seat].push(this.retourne);
      for (let k = 0; k < 4; k++) {
        const s = (seat + k) % 4;
        this.hands[s].push(...stock.splice(0, s === seat ? 2 : 3));
      }
    } else {
      // 2e tour : la retourne retourne dans le talon, 3 cartes chacun
      stock.push(this.retourne);
      for (let k = 0; k < 4; k++) {
        const s = (seat + k) % 4;
        this.hands[s].push(...stock.splice(0, 3));
      }
    }
    this.stock = [];
    this.hands = this.hands.map((h) => sortHand(h, suit));
    for (let s = 0; s < 4; s++) {
      if (this.hands[s].includes('K' + suit) && this.hands[s].includes('Q' + suit)) this.beloteSeat = s;
    }
    this.phase = 'play';
    this.turn = (this.dealer + 1) % 4;
    this.trick = [];
  }

  play(seat, card) {
    if (this.phase !== 'play') throw new Error('On ne joue pas de carte maintenant.');
    if (this.trick.length >= 4) throw new Error('Le pli est en cours de ramassage.');
    if (seat !== this.turn) throw new Error('Ce n’est pas votre tour.');
    const hand = this.hands[seat];
    if (!hand.includes(card)) throw new Error('Cette carte n’est pas dans votre main.');
    const legal = legalCards(hand, this.trick, this.trump, seat);
    if (!legal.includes(card)) throw new Error(explainIllegal(hand, this.trick, this.trump));

    this.hands[seat] = hand.filter((c) => c !== card);
    this.trick.push({ seat, card });

    if (seat === this.beloteSeat && suitOf(card) === this.trump && (rankOf(card) === 'K' || rankOf(card) === 'Q')) {
      this.beloteCount++;
      if (this.beloteCount === 1) {
        this.emit('belote', seat, 'Belote !');
      } else {
        this.emit('belote', seat, 'Rebelote !');
        this.beloteTeam = seat % 2;
      }
    }
    if (this.trick.length < 4) this.turn = (this.turn + 1) % 4;
  }

  /** Ramasse le pli complet (appelé après une courte pause côté serveur). */
  resolveTrick() {
    if (this.phase !== 'play' || this.trick.length !== 4) return;
    const wi = trickWinnerIndex(this.trick, this.trump);
    const winner = this.trick[wi].seat;
    const team = winner % 2;
    let pts = this.trick.reduce((sum, t) => sum + cardPoints(t.card, this.trump), 0);
    const last = this.hands[0].length === 0;
    if (last) pts += DIX_DE_DER;
    this.ptsWon[team] += pts;
    this.tricksWon[team]++;
    this.lastTrick = { cards: this.trick, winner, points: pts };
    this.trick = [];
    this.turn = winner;
    if (last) this.endHand();
  }

  endHand() {
    const tt = this.taker % 2;
    const dt = 1 - tt;
    const pts = this.ptsWon.slice(); // plis + dix de der
    const capot = this.tricksWon[0] === 8 ? 0 : this.tricksWon[1] === 8 ? 1 : null;
    const success = pts[tt] >= CONTRACT;
    let gained = [0, 0];
    if (capot !== null) gained[capot] = CAPOT_SCORE;
    else if (success) gained = pts.slice();
    else gained[dt] = FALL_SCORE; // le preneur est « dedans »
    if (this.beloteTeam !== null) gained[this.beloteTeam] += BELOTE_PTS; // la belote reste toujours acquise
    this.scores = [this.scores[0] + gained[0], this.scores[1] + gained[1]];
    this.result = {
      taker: this.taker, takerTeam: tt, trump: this.trump,
      success, capot, pts, belote: this.beloteTeam, gained, scores: this.scores.slice(),
    };
    const [a, b] = this.scores;
    if (Math.max(a, b) >= this.target && a !== b) {
      this.phase = 'gameEnd';
      this.winnerTeam = a > b ? 0 : 1;
    } else {
      this.phase = 'handEnd';
    }
  }

  publicState(seat) {
    const playing = this.phase === 'play';
    const biddingPhase = this.phase === 'bid1' || this.phase === 'bid2';
    return {
      phase: this.phase,
      handNo: this.handNo,
      dealer: this.dealer,
      turn: this.turn,
      round: this.round,
      retourne: biddingPhase ? this.retourne : null,
      retourneSuit: this.retourne ? suitOf(this.retourne) : null,
      trump: this.trump,
      taker: this.taker,
      hand: seat >= 0 ? this.hands[seat].slice() : [],
      counts: this.hands.map((h) => h.length),
      trick: this.trick,
      lastTrick: this.lastTrick,
      legal: playing && this.turn === seat && this.trick.length < 4
        ? legalCards(this.hands[seat], this.trick, this.trump, seat) : null,
      scores: this.scores.slice(),
      tricksWon: this.tricksWon.slice(),
      bidLog: this.bidLog,
      event: this.event,
      result: this.result,
      winnerTeam: this.winnerTeam,
      target: this.target,
      resolving: playing && this.trick.length === 4,
    };
  }
}

/* ------------------------------ Robots ------------------------------ */

const THRESH1 = 62;
const THRESH2 = 58;

function suitScore(hand, suit) {
  let sc = 0;
  for (const c of hand) {
    if (suitOf(c) === suit) sc += TRUMP_PTS[rankOf(c)] + 6;
    else if (rankOf(c) === 'A') sc += 9;
  }
  return sc;
}

function botBid(game, seat) {
  const hand = game.hands[seat];
  const noise = (game.rng() - 0.5) * 10;
  if (game.phase === 'bid1') {
    const suit = suitOf(game.retourne);
    const sc = suitScore(hand.concat([game.retourne]), suit) + noise;
    return sc >= THRESH1 ? { type: 'take' } : { type: 'pass' };
  }
  let best = null, bestScore = -1;
  for (const s of SUITS) {
    if (s === suitOf(game.retourne)) continue;
    const sc = suitScore(hand, s);
    if (sc > bestScore) { bestScore = sc; best = s; }
  }
  return bestScore + noise >= THRESH2 ? { type: 'take', suit: best } : { type: 'pass' };
}

function botPlay(game, seat) {
  const trump = game.trump;
  const hand = game.hands[seat];
  const legal = legalCards(hand, game.trick, trump, seat);
  if (legal.length === 1) return legal[0];
  const pts = (c) => cardPoints(c, trump);
  const power = (c) => (suitOf(c) === trump ? 100 + TRUMP_ORDER.indexOf(rankOf(c)) : PLAIN_ORDER.indexOf(rankOf(c)));
  const asc = (f) => (a, b) => f(a) - f(b) || power(a) - power(b);
  const myTeamTook = game.taker % 2 === seat % 2;

  if (game.trick.length === 0) {
    const trumps = legal.filter((c) => suitOf(c) === trump);
    if (myTeamTook && trumps.some((c) => rankOf(c) === 'J' || rankOf(c) === '9')) {
      return trumps.slice().sort((a, b) => power(b) - power(a))[0];
    }
    const aces = legal.filter((c) => rankOf(c) === 'A' && suitOf(c) !== trump);
    if (aces.length) return aces[0];
    const plain = legal.filter((c) => suitOf(c) !== trump);
    const pool = plain.length ? plain : legal;
    return pool.slice().sort(asc(pts))[0];
  }

  const winSeat = game.trick[trickWinnerIndex(game.trick, trump)].seat;
  if (winSeat % 2 === seat % 2) {
    // Le partenaire est maître : on charge (points), sans gaspiller d'atout
    const plain = legal.filter((c) => suitOf(c) !== trump);
    const pool = plain.length ? plain : legal;
    return pool.slice().sort((a, b) => pts(b) - pts(a) || power(a) - power(b))[0];
  }
  const winning = legal.filter((c) => {
    const t = game.trick.concat([{ seat, card: c }]);
    return t[trickWinnerIndex(t, trump)].seat === seat;
  });
  if (winning.length) return winning.slice().sort((a, b) => power(a) - power(b))[0];
  return legal.slice().sort(asc(pts))[0];
}

function botAct(game, seat) {
  if (game.phase === 'bid1' || game.phase === 'bid2') return botBid(game, seat);
  return { type: 'play', card: botPlay(game, seat) };
}

module.exports = {
  Game, botAct, legalCards, trickWinnerIndex, cardPoints, makeDeck,
  SUITS, RANKS, suitOf, rankOf, TRUMP_PTS, PLAIN_PTS,
};
