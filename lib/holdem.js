/* eslint-disable comma-style, operator-linebreak, space-unary-ops, no-multi-spaces, key-spacing, indent */
'use strict'
const cardOrder = [ '2', '3', '4', '5', '6', '7', '8', 'T', 'J', 'Q', 'K', 'A' ]
const strategicPositions = require('./strategic-positions')

function round(n) {
  return Math.round(n * 10) / 10
}

function notmetadata(k) {
  return k !== 'metadata'
}

function copyValues(o) {
  function copy(acc, k) {
    acc[k] = o[k]
    return acc
  }
  if (!o) return o
  return Object.keys(o)
    .filter(notmetadata)
    .reduce(copy, {})
}

function normalizeHoleCards(hc) {
  if (!hc) return hc
  const c1 = hc.card1
  const c2 = hc.card2
  if (c1 == null || c2 == null) return hc
  // show large card before smaller card
  return cardOrder.indexOf(c1[0]) < cardOrder.indexOf(c2[0])
    ? { card1: c2, card2: c1 } : { card1: c1, card2: c2 }
}

function getStartingPot(o, playerCount) {
  const totalAnte = (o.ante || 0) * playerCount
  return  (o.sb || 0) + (o.bb || 0) + totalAnte
}

function postFlopOrderFromPreflopOrder(n, playerCount) {
  // headsup just reverses the order
  if (playerCount === 2) return n === 0 ? 1 : 0

  if (n === (playerCount - 1)) return 1 // BB
  if (n === (playerCount - 2)) return 0 // SB
  return n + 2
}
function byPostFlopOrder(p1, p2) {
  return p1.postflopOrder - p2.postflopOrder
}

function sortPlayersByPostFlopOrder(players) {
  function appendPlayer(acc, k) {
    const p = players[k]
    p.name = k
    acc.push(p)
    return acc
  }
  return Object.keys(players)
    .reduce(appendPlayer, [])
    .sort(byPostFlopOrder)
}

function playerInvested(preflop) {
  for (var i = 0; i < preflop.length; i++) {
    const action = preflop[i].type
    if (action === 'bet' || action === 'call' || action === 'raise') return true
  }
  return false
}

function playerSawShowdown(p) {
  if (p.showdown.length) return true
  if (p.river.length && p.river[p.river.length - 1].type !== 'fold') return true
  return false
}

function addActivityInfo(players, info) {
  var anyInvested    = false
  var anySawFlop     = false
  for (var i = 0; i < players.length; i++) {
    const player       = players[i]
    player.invested    = player.sb || player.bb || playerInvested(player.preflop)
    player.sawFlop     = !!player.flop.length
    player.sawShowdown = playerSawShowdown(player)

    if (!anyInvested) anyInvested = player.invested
    if (!anySawFlop) anySawFlop   = player.sawFlop
  }

  info.anyInvested    = anyInvested
  info.anySawFlop     = anySawFlop
}

function updateChips(prev, current, investeds, players, hand) {
  Object.keys(players)
    .forEach(updatePlayerChips, { prev: prev, current: current })

  function updatePlayerChips(k) {
    const p = players[k]
    var chips = p[this.prev] - (investeds[k] || 0)
    if (this.prev === 'chipsPreflop') {
      if (p.bb) chips += hand.info.bb
      if (p.sb) chips += hand.info.sb
    }
    p.chipsAfter = p[this.current] = chips
  }
}

function updateChipsForAction(chips, action, cost, player) {
  action.chips = chips[player]
  chips[player] -= cost
  action.chipsAfter = chips[player]
}

function positionPlayer(player, playerCount, idx) {
  player.preflopOrder = idx
  player.postflopOrder = postFlopOrderFromPreflopOrder(idx, playerCount)
  const positions = strategicPositions(idx, playerCount)
  player.pos = positions.pos
  player.exactPos = positions.exactPos
}

function assignPosition(player, playerCount, idx) {
  if (player.hasOwnProperty('preflopOrder')) return
  positionPlayer(player, playerCount, idx)
}

module.exports = function analyzeHoldem(hand) {
  var pot = 0
  var currentBet = hand.info.bb

  const playerCount = hand.seats.length
  const startingPot = getStartingPot(hand.info, playerCount)

  const players = {}
  const analyzed = {
      info    : copyValues(hand.info)
    , table   : copyValues(hand.table)
    , board   : copyValues(hand.board)
    , hero    : hand.hero
  }
  if (analyzed.info.ante == null) analyzed.info.ante = 0
  analyzed.pots = {
    preflop: startingPot
  }
  analyzed.info.players = playerCount

  for (var i = 0; i < playerCount; i++) {
    const s = hand.seats[i]
    const player = {
        seatno        : s.seatno
      , chips         : s.chips
      , chipsPreflop  : s.chips
      , chipsFlop     : null
      , chipsTurn     : null
      , chipsRiver    : null
      , chipsShowdown : null
      , chipsAfter    : null
      , m             : Math.round(s.chips / startingPot)
      , preflop       : []
      , flop          : []
      , turn          : []
      , river         : []
      , showdown      : []
    }
    if (hand.table.button === s.seatno) player.button = true
    if (hand.hero === s.player) {
      player.hero = true
      if (hand.holecards) {
        player.cards = normalizeHoleCards(hand.holecards)
      }
    }
    players[s.player] = player
  }
  analyzed.players = players

  for (i = 0; i < hand.posts.length; i++) {
    const p = hand.posts[i]
    const player = players[p.player]
    pot += p.amount
    player.chipsAfter = player.chipsPreflop -= p.amount

    if (p.type === 'sb') player.sb = true
    if (p.type === 'bb') player.bb = true
  }

  function analyzeAction(p, invested, chips) {
    const startingPot = pot
    var cost = 0
    var betDelta = 0
    const action = {
      type: p.type
    }
    if (p.type === 'raise') {
      action.ratio = round(p.raiseTo / currentBet)
      action.allin = !!p.allin
      action.amount = p.raiseTo - invested
      betDelta = 1
      currentBet = p.raiseTo
      pot += currentBet
      cost = action.amount
    } else if (p.type === 'bet') {
      action.ratio = round(p.amount / pot)
      action.allin = !!p.allin
      action.amount = p.amount
      currentBet = p.amount
      pot += currentBet
      cost = action.amount
    } else if (p.type === 'call') {
      action.ratio = round(p.amount / pot)
      action.allin = !!p.allin
      action.amount = p.amount
      pot += p.amount
      cost = action.amount
    } else if (p.type === 'collect') {
      action.ratio = round(p.amount / pot)
      action.allin = false
      action.amount = p.amount
      cost = -p.amount
      pot = 0
    } else if (p.type === 'bet-returned') {
      action.ratio = round(p.amount / pot)
      action.allin = false
      action.amount = p.amount
      cost = -p.amount
      pot = pot - p.amount
    }
    action.pot = startingPot
    action.potAfter = startingPot + cost
    action.chips = chips
    action.chipsAfter = chips - cost
    return { action: action, cost: cost || 0, betDelta: betDelta }
  }

  var investeds = {}
  var chips = {}
  // starting with one bet, first raise is two bet, next three bet and so on
  var bet = 1

  function startPreflopCost(p) {
    if (p.bb) return hand.info.bb
    if (p.sb) return hand.info.sb
    return 0
  }

  function adjustBet(info) {
    bet = bet + info.betDelta
    info.action.bet = bet
  }

  //
  // Preflop
  //
  for (i = 0; i < hand.preflop.length; i++) {
    const p = hand.preflop[i]
    const player = players[p.player]
    const invested = investeds[p.player] || startPreflopCost(player)
    if (typeof chips[p.player] === 'undefined') chips[p.player] = player.chipsPreflop

    const info = analyzeAction(p, invested)
    adjustBet(info)

    player.preflop.push(info.action)
    assignPosition(player, playerCount, i)
    investeds[p.player] = invested + info.cost
    updateChipsForAction(chips, info.action, info.cost, p.player)
  }
  updateChips('chipsPreflop', 'chipsFlop', investeds, players, hand)

  //
  // Flop
  //
  analyzed.pots.flop = pot
  investeds = {}
  bet = 1
  for (i = 0; i < hand.flop.length; i++) {
    const p = hand.flop[i]
    const player = players[p.player]
    const invested = investeds[p.player] || 0
    const info = analyzeAction(p, invested)
    adjustBet(info)

    player.flop.push(info.action)
    investeds[p.player] = invested + info.cost
    updateChipsForAction(chips, info.action, info.cost, p.player)
  }
  updateChips('chipsFlop', 'chipsTurn', investeds, players, hand)

  //
  // Turn
  //
  analyzed.pots.turn = pot
  investeds = {}
  bet = 1
  for (i = 0; i < hand.turn.length; i++) {
    const p = hand.turn[i]
    const player = players[p.player]
    const invested = investeds[p.player] || 0
    const info = analyzeAction(p, invested)
    adjustBet(info)

    player.turn.push(info.action)
    investeds[p.player] = invested + info.cost
    updateChipsForAction(chips, info.action, info.cost, p.player)
  }
  updateChips('chipsTurn', 'chipsRiver', investeds, players, hand)

  //
  // River
  //
  analyzed.pots.river = pot
  investeds = {}
  bet = 1
  for (i = 0; i < hand.river.length; i++) {
    const p = hand.river[i]
    const player = players[p.player]
    const invested = investeds[p.player] || 0
    const info = analyzeAction(p, invested)
    adjustBet(info)

    player.river.push(info.action)
    investeds[p.player] = invested + info.cost
    updateChipsForAction(chips, info.action, info.cost, p.player)
  }
  updateChips('chipsRiver', 'chipsShowdown', investeds, players, hand)

  //
  // Showdown
  //
  analyzed.pots.showdown = pot
  // first we aggregate all collections and then condense into one action
  var collecteds = {}
  for (i = 0; i < hand.showdown.length; i++) {
    const p = hand.showdown[i]
    const player = players[p.player]
    // in some rare cases we removed a player that had no active involvemement in the hand
    // i.e. if he was allin after posting
    if (player == null) continue

    if ((p.type === 'show' || p.type === 'muck') &&
      player.cards == null && p.card1 != null && p.card2 != null) {
      player.cards = normalizeHoleCards({ card1: p.card1, card2: p.card2 })
    } else if (p.type === 'collect') {
      collecteds[p.player] = (collecteds[p.player] || 0) + p.amount
    }
  }

  Object.keys(collecteds).forEach(processCollecteds)
  function processCollecteds(k) {
    const player = players[k]
    const amount = collecteds[k]
    const ratio = round(amount / pot)
    const action = {
        type       : 'collect'
      , ratio      : ratio
      , winall     : ratio === 1
      , amount     : amount
      , chips      : chips[k]
      , chipsAfter : chips[k] + amount
    }
    player.showdown.push(action)
    player.chipsAfter += amount
  }

  // In some rare cases a player is allin after posting and doesn't act at all
  // In that case we just pretend that player never existed since he's not important
  // to analyze the hand and is problematic to assign a position to at this point
  const playerKeys = Object.keys(players)
  for (i = 0; i < playerKeys.length; i++) {
    const key = playerKeys[i]
    const player = players[key]
    if (player == null || player.preflopOrder == null) delete players[key]
  }

  // Some cards are only exposed in showdown (seen for mucked hands), so let's try to
  // capture the ones we didn't so far.
  if (hand.summary != null) {
    for (i = 0; i < hand.summary.length; i++) {
      const p = hand.summary[i]
      const player = players[p.player]
      if (player == null) continue

      if ((p.type === 'show' || p.type === 'showed' || p.type === 'muck') &&
        player.cards == null && p.card1 != null && p.card2 != null) {
        player.cards = normalizeHoleCards({ card1: p.card1, card2: p.card2 })
      }
    }
  }

  analyzed.players = sortPlayersByPostFlopOrder(players)
  addActivityInfo(analyzed.players, analyzed.info)
  return analyzed
}
