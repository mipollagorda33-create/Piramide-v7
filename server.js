const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000
    }
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

const PALOS = ['Oros', 'Copas', 'Espadas', 'Bastos'];
const VALORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]; // 48 cartas españolas

const EVENTOS_CEFA = [
    {
        title: "Suelta la correa",
        desc: "El jugador con más tragos elige a otro para ser su mascota hasta el próximo evento: cada vez que uno beba, el otro también bebe."
    },
    {
        title: "Meeting Sr. Roca",
        desc: "¡Permiso de baño concedido! Quien vaya al baño fuera de este evento deberá beber 3 tragos al volver."
    },
    {
        title: "2x1 Mercadona",
        desc: "Durante esta ronda, todos los tragos que te manden o te toquen beber se multiplican por 2."
    },
    {
        title: "El innombrable",
        desc: "Prohibido decir nombres propios ni la palabra 'beber'. Quien lo haga se lleva 2 tragos directos."
    },
    {
        title: "Ley del Buffalo",
        desc: "Todo el mundo debe beber exclusivamente con la mano no dominante. Quien use la mano buena bebe 2."
    },
    {
        title: "Torre de Babel",
        desc: "Todos los jugadores deben hablar con un acento extranjero o inventado. Quien hable normal bebe 2 tragos."
    },
    {
        title: "La Fiesta del Gnomo",
        desc: "Antes de beber cualquier trago, debes quitar imaginariamente el gnomo del borde de tu vaso y volverlo a poner al acabar."
    },
    {
        title: "Saludo calamar",
        desc: "Cada vez que alguien mande tragos, ambos deben hacer el saludo calamar con las manos antes de beber o suman +2."
    },
    {
        title: "A los tiburones",
        desc: "El Máster inicia una ronda rápida de palabras de una categoría; el primero que repita o dude bebe 3 tragos."
    },
    {
        title: "El Juicio de las Manos",
        desc: "Obligatorio levantar la mano izquierda bien alta cada vez que se dé un trago. El último o quien no la suba bebe 2."
    },
    {
        title: "A jugar de pie",
        desc: "Todos los jugadores deben permanecer de pie hasta el próximo evento. El primero que se siente bebe 3 tragos."
    },
    {
        title: "Toque de queda",
        desc: "Prohibido mirar el móvil para nada que no sea esta app ni apoyar los codos en la mesa. Penalización: 2 tragos."
    }
];

function nombreCarta(num) {
    if (num === 1) return 'As';
    if (num === 10) return 'Sota';
    if (num === 11) return 'Caballo';
    if (num === 12) return 'Rey';
    return String(num);
}

function generarBarajaEspanola() {
    let deck = [];
    for (let palo of PALOS) {
        for (let num of VALORES) {
            deck.push({
                id: Math.random().toString(36).substring(2, 10),
                num,
                label: nombreCarta(num),
                palo,
                lockedAtReveal: null
            });
        }
    }
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function drawFromDeck(room) {
    if (!room.deck || room.deck.length === 0) {
        room.deck = generarBarajaEspanola();
    }
    return room.deck.pop();
}

function addLog(roomCode, text) {
    const room = rooms[roomCode];
    if (!room) return;
    const entry = {
        time: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
        text
    };
    room.logs.unshift(entry);
    if (room.logs.length > 40) room.logs.pop();
    io.to(roomCode).emit('updateLogs', room.logs);
}

function notifyDrink(playerId, amount, from, reason) {
    if (!playerId || amount <= 0) return;
    io.to(playerId).emit('youMustDrink', { amount, from, reason });
}

function getCurrentRevealedCard(room) {
    if (!room || !room.pyramid || room.pyramid.length === 0) return null;
    const rowIndices = { 1: [0, 1, 2, 3], 2: [4, 5, 6], 3: [7, 8], 4: [9] }[room.currentRow] || [];
    const revealedInRow = rowIndices
        .map(idx => room.pyramid[idx])
        .filter(c => c && c.revealed);
    return revealedInRow.length > 0 ? revealedInRow[revealedInRow.length - 1] : null;
}

function getPendingCardPlayers(room) {
    if (!room) return [];
    if (room.state !== 'PIRAMIDE_FILA' && room.state !== 'LISTO_SUBASTA') return [];
    const activeCard = getCurrentRevealedCard(room);
    if (!activeCard) return [];

    const pending = [];
    for (const p of room.players) {
        if (p.ghost) continue;
        const hasPlayableMatch = p.hand.some(
            c => c.num === activeCard.num && c.lockedAtReveal !== room.revealCounter
        );
        if (hasPlayableMatch) {
            pending.push({ id: p.id, name: p.name });
        }
    }
    return pending;
}

function emitRoomState(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    const activePlayer = room.players[room.turnPlayerIndex] || null;
    const pendingPlayers = getPendingCardPlayers(room);
    const currentCard = getCurrentRevealedCard(room);

    io.to(roomCode).emit('stateSync', {
        state: room.state,
        phase1Round: room.phase1Round,
        activePlayerId: activePlayer ? activePlayer.id : null,
        activePlayerName: activePlayer ? activePlayer.name : null,
        pendingReward: room.pendingReward,
        pyramid: room.pyramid,
        currentRow: room.currentRow,
        revealCounter: room.revealCounter,
        currentRevealedCard: currentCard,
        pendingCardPlayers: pendingPlayers,
        liveComment: room.liveComment,
        auction: room.auction ? {
            active: room.auction.active,
            card: room.auction.card,
            bid: room.auction.bid,
            leaderId: room.auction.leaderId,
            leaderName: room.auction.leaderName,
            secondsLeft: room.auction.secondsLeft,
            isOvertime: room.auction.isOvertime
        } : null,
        activeEvents: room.activeEvents
    });
}

function broadcastPlayers(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    io.to(roomCode).emit('updatePlayers', room.players.map(p => ({
        id: p.id,
        name: p.name,
        isHost: p.isHost,
        drinks: p.drinks,
        ghost: p.ghost,
        cardCount: p.hand.length
    })));
}

function advancePhase1Turn(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    room.pendingReward = null;
    let attempts = 0;
    const total = room.players.length;
    while (attempts < total) {
        room.turnPlayerIndex++;
        if (room.turnPlayerIndex >= total) {
            room.turnPlayerIndex = 0;
            room.phase1Round++;
        }
        if (room.phase1Round > 4) break;
        if (!room.players[room.turnPlayerIndex].ghost) break;
        attempts++;
    }

    if (room.phase1Round > 4) {
        room.pyramid = [];
        for (let i = 0; i < 10; i++) {
            const c = drawFromDeck(room);
            c.revealed = false;
            c.lockedAtReveal = null;
            room.pyramid.push(c);
        }
        room.currentRow = 1;
        room.revealCounter = 0;
        room.state = 'PIRAMIDE_FILA';
        room.liveComment = '🔥 ¡Comienza La Pirámide! El Máster destapa la Fila 1 (Base).';
        io.to(roomCode).emit('phaseTransition', '¡FASE 1 COMPLETADA! Comienza La Pirámide');
        addLog(roomCode, room.liveComment);
    } else {
        room.state = 'FASE_1';
    }
    emitRoomState(roomCode);
}

function finalizeAuction(roomCode) {
    const room = rooms[roomCode];
    if (!room || !room.auction) return;
    clearInterval(room.auction.timer);

    const { card, bid, leaderId, leaderName } = room.auction;
    if (leaderId) {
        const winner = room.players.find(p => p.id === leaderId);
        if (winner) {
            winner.drinks += bid;
            card.lockedAtReveal = null;
            winner.hand.push(card);
            io.to(winner.id).emit('updateHand', winner.hand);
            broadcastPlayers(roomCode);
            notifyDrink(winner.id, bid, 'Subasta de Cefa', `Ganaste el ${card.label} de ${card.palo} en la subasta.`);
            room.liveComment = `🔨 ¡${leaderName} gana la subasta (${bid} tragos) y se queda con el ${card.label} de ${card.palo}!`;
            addLog(roomCode, room.liveComment);
            io.to(roomCode).emit('serverMsg', room.liveComment);
        }
    } else {
        room.liveComment = `🔨 Subasta desierta: nadie pujó por el ${card.label} de ${card.palo}.`;
        addLog(roomCode, room.liveComment);
        io.to(roomCode).emit('serverMsg', room.liveComment);
    }

    room.auction = null;
    room.state = 'POST_SUBASTA';
    emitRoomState(roomCode);
}

io.on('connection', (socket) => {
    socket.on('heartbeat', () => {
        socket.emit('heartbeatAck');
    });

    socket.on('joinRoom', ({ username, roomCode }) => {
        if (!username || !roomCode) return;
        const cleanUser = username.trim();
        const cleanRoom = roomCode.toUpperCase().trim();

        if (!rooms[cleanRoom]) {
            rooms[cleanRoom] = {
                host: socket.id,
                players: [],
                deck: generarBarajaEspanola(),
                state: 'LOBBY',
                phase1Round: 1,
                turnPlayerIndex: 0,
                pendingReward: null,
                pyramid: [],
                currentRow: 1,
                revealCounter: 0,
                auction: null,
                activeEvents: [],
                liveComment: 'Esperando a que el Máster inicie la partida...',
                activeChallenges: {},
                logs: []
            };
        }

        const room = rooms[cleanRoom];
        const isDuplicate = room.players.some(p => p.name.toLowerCase() === cleanUser.toLowerCase());
        if (isDuplicate) {
            socket.emit('errorMsg', 'Ese apodo ya está en uso en esta sala. Elige otro.');
            return;
        }

        socket.join(cleanRoom);
        const isHost = room.players.length === 0;
        if (isHost) room.host = socket.id;

        const isMidGame = room.state !== 'LOBBY';
        const initialHand = [];
        let initialDrinks = 0;

        // Entrada a mitad de partida: 4 cartas y 4 tragos de penalización
        if (isMidGame) {
            for (let i = 0; i < 4; i++) {
                initialHand.push(drawFromDeck(room));
            }
            initialDrinks = 4;
        }

        const player = {
            id: socket.id,
            name: cleanUser,
            isHost,
            drinks: initialDrinks,
            ghost: false,
            hand: initialHand
        };
        room.players.push(player);

        socket.emit('joined', { roomCode: cleanRoom, player, isHost });
        broadcastPlayers(cleanRoom);
        socket.emit('updateLogs', room.logs);
        socket.emit('updateHand', player.hand);
        emitRoomState(cleanRoom);

        if (isMidGame) {
            const joinMsg = `🚪 ${cleanUser} se unió a mitad de partida: recibe 4 cartas y bebe 4 tragos de penalización.`;
            room.liveComment = joinMsg;
            addLog(cleanRoom, joinMsg);
            io.to(cleanRoom).emit('serverMsg', joinMsg);
            notifyDrink(socket.id, 4, 'Cefa (Entrada Tardía)', 'Te has unido con la partida empezada (+4 cartas, +4 tragos).');
            emitRoomState(cleanRoom);
        }
    });

    // Modo Fantasma / AFK manual
    socket.on('toggleGhost', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        player.ghost = !player.ghost;
        broadcastPlayers(roomCode);
        addLog(roomCode, player.ghost ? `👻 ${player.name} activó el Modo Fantasma.` : `⚡ ${player.name} volvió a la mesa.`);

        if ((room.state === 'FASE_1' || room.state === 'FASE_1_ELEGIR_VICTIMA') &&
            room.players[room.turnPlayerIndex]?.id === socket.id && player.ghost) {
            advancePhase1Turn(roomCode);
        } else {
            emitRoomState(roomCode);
        }
    });

    // MASTER: Iniciar Fase 1
    socket.on('startGame', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) return;

        room.deck = generarBarajaEspanola();
        room.players.forEach(p => {
            p.hand = [];
            p.drinks = 0;
            io.to(p.id).emit('updateHand', []);
        });
        room.state = 'FASE_1';
        room.phase1Round = 1;
        room.turnPlayerIndex = 0;
        room.pendingReward = null;
        room.pyramid = [];
        room.currentRow = 1;
        room.revealCounter = 0;
        room.activeEvents = [];
        room.liveComment = '🎲 ¡Comienza la Fase 1! Reparto carta a carta.';

        if (room.players[0]?.ghost) {
            advancePhase1Turn(roomCode);
        } else {
            broadcastPlayers(roomCode);
            emitRoomState(roomCode);
        }
        addLog(roomCode, room.liveComment);
    });

    // JUGADOR: Responder pregunta de Fase 1 (Víctima SOLO si acierta)
    socket.on('answerPhase1', ({ roomCode, answer }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'FASE_1') return;

        const player = room.players[room.turnPlayerIndex];
        if (!player || player.id !== socket.id) return;

        const card = drawFromDeck(room);
        const round = room.phase1Round;

        let success = false;
        let amountToSend = 0;
        let resultText = '';

        if (round === 1) {
            success = (card.palo === answer);
            if (success) {
                amountToSend = 1;
                resultText = `✅ ${player.name} acertó ${card.palo} (${card.label} de ${card.palo}) y manda 1 trago.`;
            } else {
                player.drinks += 1;
                resultText = `❌ ${player.name} dijo ${answer} y salió ${card.label} de ${card.palo}. Bebe 1 trago.`;
                notifyDrink(player.id, 1, 'Fase 1 (Ronda 1)', `Dijiste ${answer} y salió ${card.label} de ${card.palo}.`);
            }
        } else if (round === 2) {
            const c1 = player.hand[0].num;
            if (answer === 'Mayor') success = card.num > c1;
            if (answer === 'Menor') success = card.num < c1;
            if (answer === 'Igual') success = card.num === c1;

            if (success) {
                amountToSend = 2;
                resultText = `✅ ${player.name} acertó (${answer} que ${nombreCarta(c1)}) con ${card.label} de ${card.palo} y manda 2 tragos.`;
            } else {
                player.drinks += 2;
                resultText = `❌ ${player.name} falló (${answer} que ${nombreCarta(c1)}), salió ${card.label} de ${card.palo}. Bebe 2 tragos.`;
                notifyDrink(player.id, 2, 'Fase 1 (Ronda 2)', `Fallaste (${answer} que ${nombreCarta(c1)}): salió ${card.label} de ${card.palo}.`);
            }
        } else if (round === 3) {
            const min = Math.min(player.hand[0].num, player.hand[1].num);
            const max = Math.max(player.hand[0].num, player.hand[1].num);
            if (answer === 'Dentro') success = (card.num > min && card.num < max);
            if (answer === 'Fuera') success = (card.num < min || card.num > max);
            if (answer === 'Igual') success = (card.num === min || card.num === max);

            if (success) {
                amountToSend = 3;
                resultText = `✅ ${player.name} acertó (${answer}) con ${card.label} de ${card.palo} y manda 3 tragos.`;
            } else {
                player.drinks += 3;
                resultText = `❌ ${player.name} falló (${answer}), salió ${card.label} de ${card.palo}. Bebe 3 tragos.`;
                notifyDrink(player.id, 3, 'Fase 1 (Ronda 3)', `Fallaste (${answer}): salió ${card.label} de ${card.palo}.`);
            }
        } else if (round === 4) {
            const guess = parseInt(answer, 10);
            if (guess === card.num) {
                success = true;
                amountToSend = card.num;
                resultText = `🎯 ¡CLAVADA DE ${player.name}! Acertó el ${card.label} de ${card.palo} y manda ${card.num} tragos.`;
            } else {
                const diff = Math.abs(guess - card.num);
                player.drinks += diff;
                resultText = `💥 ${player.name} apostó al ${nombreCarta(guess)} y salió ${card.label} de ${card.palo}. Bebe ${diff} tragos.`;
                notifyDrink(player.id, diff, 'Fase 1 (Ronda 4)', `Apostaste al ${nombreCarta(guess)} y salió ${card.label} de ${card.palo}.`);
            }
        }

        player.hand.push(card);
        io.to(player.id).emit('updateHand', player.hand);
        addLog(roomCode, resultText);
        io.to(roomCode).emit('serverMsg', resultText);
        broadcastPlayers(roomCode);

        const activeRivals = room.players.filter(p => p.id !== player.id);
        if (success && activeRivals.length > 0) {
            // Solo ahora se abre el selector de víctima para el ganador
            room.state = 'FASE_1_ELEGIR_VICTIMA';
            room.pendingReward = {
                winnerId: player.id,
                winnerName: player.name,
                amount: amountToSend,
                cardLabel: `${card.label} de ${card.palo}`
            };
            emitRoomState(roomCode);
        } else {
            advancePhase1Turn(roomCode);
        }
    });

    // JUGADOR: Confirmar víctima tras acertar en Fase 1
    socket.on('confirmPhase1Target', ({ roomCode, targetId }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'FASE_1_ELEGIR_VICTIMA' || !room.pendingReward) return;
        if (room.pendingReward.winnerId !== socket.id) return;

        const target = room.players.find(p => p.id === targetId);
        const { winnerName, amount, cardLabel } = room.pendingReward;
        if (target) {
            target.drinks += amount;
            broadcastPlayers(roomCode);
            const msg = `👉 ${winnerName} manda ${amount} trago(s) a ${target.name} (acertó ${cardLabel}).`;
            addLog(roomCode, msg);
            io.to(roomCode).emit('serverMsg', msg);
            notifyDrink(target.id, amount, winnerName, `Acertó ${cardLabel} en Fase 1 y te eligió como víctima.`);
        }
        advancePhase1Turn(roomCode);
    });

    // MASTER: Destapar siguiente carta (Bloqueado si quedan jugadores por jugar carta coincidente)
    socket.on('revealNextCard', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id || room.state !== 'PIRAMIDE_FILA') return;

        const pending = getPendingCardPlayers(room);
        if (pending.length > 0) {
            socket.emit('errorMsg', `No puedes avanzar: faltan por jugar ${pending.map(p => p.name).join(', ')}.`);
            return;
        }

        const rowIndices = { 1: [0, 1, 2, 3], 2: [4, 5, 6], 3: [7, 8], 4: [9] }[room.currentRow];
        const nextIdx = rowIndices.find(idx => !room.pyramid[idx].revealed);
        if (nextIdx !== undefined) {
            room.revealCounter++;
            const card = room.pyramid[nextIdx];
            card.revealed = true;

            const newPending = getPendingCardPlayers(room);
            const pendingNames = newPending.length > 0
                ? ` 🎯 Tienen coincidencia: ${newPending.map(p => p.name).join(', ')}.`
                : ' Nadie tiene esta carta.';

            room.liveComment = `🃏 Fila ${room.currentRow} (${room.currentRow} trago/s): Salió ${card.label} de ${card.palo}.${pendingNames}`;
            addLog(roomCode, room.liveComment);

            const stillHidden = rowIndices.some(idx => !room.pyramid[idx].revealed);
            if (!stillHidden) {
                room.state = 'LISTO_SUBASTA';
            }
            emitRoomState(roomCode);
        }
    });

    // JUGADOR: Mandar carta de su inventario (1 envío por carta en el mismo turno, sin ping-pong)
    socket.on('sendCard', ({ roomCode, cardId, targetId }) => {
        const room = rooms[roomCode];
        if (!room) return;

        const sender = room.players.find(p => p.id === socket.id);
        const target = room.players.find(p => p.id === targetId);
        if (!sender || !target || sender.id === target.id) return;

        const cardIdx = sender.hand.findIndex(c => c.id === cardId);
        if (cardIdx === -1) return;

        const card = sender.hand[cardIdx];

        // Evitar ping-pong en el mismo turno
        if (room.revealCounter > 0 && card.lockedAtReveal === room.revealCounter) {
            socket.emit('errorMsg', 'Esa carta ya fue enviada en este turno. Espera a la siguiente carta.');
            return;
        }

        // Extraer del emisor y bloquearla durante este turno en el receptor
        sender.hand.splice(cardIdx, 1);
        card.lockedAtReveal = room.revealCounter;
        target.hand.push(card);

        let drinksSent = 0;
        const activeCard = getCurrentRevealedCard(room);
        if ((room.state === 'PIRAMIDE_FILA' || room.state === 'LISTO_SUBASTA') && activeCard && activeCard.num === card.num) {
            drinksSent = room.currentRow;
            target.drinks += drinksSent;
        }

        io.to(sender.id).emit('updateHand', sender.hand);
        io.to(target.id).emit('updateHand', target.hand);
        broadcastPlayers(roomCode);

        const msg = drinksSent > 0
            ? `💥 ¡${sender.name} lanzó un ${card.label} de ${card.palo} a ${target.name} y le manda ${drinksSent} trago(s)!`
            : `🃏 ${sender.name} pasó ${card.label} de ${card.palo} al inventario de ${target.name}.`;

        room.liveComment = msg;
        addLog(roomCode, msg);
        io.to(roomCode).emit('serverMsg', msg);

        if (drinksSent > 0) {
            notifyDrink(target.id, drinksSent, sender.name, `Te envió un ${card.label} de ${card.palo} en la Fila ${room.currentRow}.`);
        }

        emitRoomState(roomCode);
    });

    // JUGADOR: Guardar / Pasar turno de carta coincidente para liberar al Máster
    socket.on('passCardTurn', ({ roomCode, cardId }) => {
        const room = rooms[roomCode];
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        const card = player.hand.find(c => c.id === cardId);
        if (!card) return;

        card.lockedAtReveal = room.revealCounter;
        io.to(player.id).emit('updateHand', player.hand);
        room.liveComment = `🛡️ ${player.name} decide guardarse su ${card.label} de ${card.palo}.`;
        addLog(roomCode, room.liveComment);
        emitRoomState(roomCode);
    });

    // JUGADOR: Hacerse Hidalgo cuando tiene 0 cartas (Fondo blanco -> +2 cartas)
    socket.on('becomeHidalgo', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room) return;
        if (room.state !== 'PIRAMIDE_FILA' && room.state !== 'LISTO_SUBASTA' && room.state !== 'POST_SUBASTA') return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.hand.length > 0) return;

        const c1 = drawFromDeck(room);
        const c2 = drawFromDeck(room);
        player.hand.push(c1, c2);
        player.drinks += 3; // Equivale al fondo blanco de Hidalgo

        io.to(player.id).emit('updateHand', player.hand);
        broadcastPlayers(roomCode);

        const msg = `🍺 ¡${player.name} SE HACE HIDALGO! Se bebe el vaso a fondo blanco (+3 tragos) y roba 2 cartas nuevas.`;
        room.liveComment = msg;
        addLog(roomCode, msg);
        io.to(roomCode).emit('serverMsg', msg);
        notifyDrink(player.id, 3, 'Hidalgo (Reenganche)', 'Vaso a fondo blanco por quedarte sin cartas (+2 cartas nuevas).');
        emitRoomState(roomCode);
    });

    // MASTER: Abrir Subasta al terminar la fila (Bloqueado si quedan cartas pendientes)
    socket.on('startAuction', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id || room.state !== 'LISTO_SUBASTA') return;

        const pending = getPendingCardPlayers(room);
        if (pending.length > 0) {
            socket.emit('errorMsg', `No puedes abrir subasta: faltan por jugar ${pending.map(p => p.name).join(', ')}.`);
            return;
        }

        const auctionCard = drawFromDeck(room);
        room.state = 'SUBASTA';
        room.auction = {
            active: true,
            card: auctionCard,
            bid: 1,
            leaderId: null,
            leaderName: 'Nadie todavía',
            secondsLeft: 15,
            isOvertime: false,
            timer: null
        };

        room.liveComment = `🔨 ¡SUBASTA ABIERTA por un ${auctionCard.label} de ${auctionCard.palo}!`;
        addLog(roomCode, room.liveComment);
        emitRoomState(roomCode);

        room.auction.timer = setInterval(() => {
            if (!room.auction) return;
            room.auction.secondsLeft--;

            if (room.auction.secondsLeft <= 0) {
                if (!room.auction.isOvertime && room.auction.leaderId) {
                    room.auction.isOvertime = true;
                    room.auction.secondsLeft = 5;
                } else {
                    finalizeAuction(roomCode);
                    return;
                }
            }
            emitRoomState(roomCode);
        }, 1000);
    });

    // JUGADOR: Pujar en Subasta (+1, +3, +5)
    socket.on('placeBid', ({ roomCode, increment }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'SUBASTA' || !room.auction || !room.auction.active) return;

        const inc = parseInt(increment, 10);
        if (![1, 3, 5].includes(inc)) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.ghost) return;

        if (!room.auction.leaderId && inc === 1) {
            room.auction.bid = 1;
        } else {
            room.auction.bid += inc;
        }
        room.auction.leaderId = player.id;
        room.auction.leaderName = player.name;

        if (room.auction.isOvertime) {
            room.auction.secondsLeft = 5;
        }
        emitRoomState(roomCode);
    });

    // MASTER: Destapar Evento de Cefa tras la Subasta
    socket.on('revealEvent', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id || room.state !== 'POST_SUBASTA') return;

        // Evitar repetir eventos ya salidos hasta agotar los 12
        const usedTitles = new Set(room.activeEvents.map(e => e.title));
        const available = EVENTOS_CEFA.filter(e => !usedTitles.has(e.title));
        const pool = available.length > 0 ? available : EVENTOS_CEFA;
        const chosen = pool[Math.floor(Math.random() * pool.length)];

        const eventObj = {
            row: room.currentRow,
            title: chosen.title,
            desc: chosen.desc
        };
        room.activeEvents.unshift(eventObj);

        const bannerMsg = `👁️ EVENTO FILA ${room.currentRow}: ${chosen.title} — ${chosen.desc}`;
        room.liveComment = bannerMsg;
        addLog(roomCode, bannerMsg);
        io.to(roomCode).emit('eventRevealed', eventObj);

        if (room.currentRow < 4) {
            room.currentRow++;
            room.state = 'PIRAMIDE_FILA';
        } else {
            room.state = 'HALL_OF_FAME';
            const sorted = [...room.players].sort((a, b) => b.drinks - a.drinks);
            const sober = sorted[sorted.length - 1];
            if (sober) {
                sober.drinks += 5;
                broadcastPlayers(roomCode);
                notifyDrink(sober.id, 5, 'Cefa (Castigo al Más Sobrio)', 'Has acabado la Pirámide siendo el más sobrio (+5 tragos).');
            }
            const finalRanking = [...room.players].sort((a, b) => b.drinks - a.drinks);
            io.to(roomCode).emit('gameFinished', {
                ranking: finalRanking,
                soberName: sober ? sober.name : 'Nadie'
            });
            addLog(roomCode, '🏆 ¡FIN DE LA PARTIDA! Hall of Fame desplegado.');
        }

        emitRoomState(roomCode);
    });

    // ==========================================
    // MINIJUEGOS DE PAUSA (COINFLIP & PPT)
    // ==========================================
    socket.on('sendChallenge', ({ roomCode, targetId, gameType }) => {
        const room = rooms[roomCode];
        if (!room) return;

        const busy = Object.values(room.activeChallenges).some(
            c => c.challenger === socket.id || c.target === socket.id || c.challenger === targetId || c.target === targetId
        );
        if (busy) {
            socket.emit('errorMsg', 'Ya hay un reto activo entre vosotros o con ese jugador.');
            return;
        }

        const challenger = room.players.find(p => p.id === socket.id);
        const target = room.players.find(p => p.id === targetId);
        if (!challenger || !target) return;

        const challengeId = Math.random().toString(36).substring(2, 10);
        room.activeChallenges[challengeId] = {
            id: challengeId,
            challenger: socket.id,
            challengerName: challenger.name,
            target: targetId,
            targetName: target.name,
            gameType,
            status: 'pending'
        };

        socket.emit('challengeWaiting', { challengeId, targetName: target.name });
        io.to(targetId).emit('incomingChallenge', {
            challengeId,
            challengerName: challenger.name,
            gameType
        });

        setTimeout(() => {
            if (room.activeChallenges[challengeId] && room.activeChallenges[challengeId].status === 'pending') {
                delete room.activeChallenges[challengeId];
                io.to(socket.id).emit('challengeClosed', 'El reto caducó tras 15 segundos sin respuesta.');
                io.to(targetId).emit('challengeClosed', 'El reto ha caducado.');
            }
        }, 15000);
    });

    socket.on('acceptChallenge', ({ roomCode, challengeId }) => {
        const room = rooms[roomCode];
        const c = room?.activeChallenges[challengeId];
        if (!c || c.status !== 'pending') return;

        c.status = 'accepted';
        io.to(c.challenger).emit('challengeAccepted', c);
        io.to(c.target).emit('challengeAccepted', c);
    });

    socket.on('rejectChallenge', ({ roomCode, challengeId }) => {
        const room = rooms[roomCode];
        const c = room?.activeChallenges[challengeId];
        if (!c) return;

        delete room.activeChallenges[challengeId];
        io.to(c.challenger).emit('challengeClosed', `${c.targetName} rechazó el reto.`);
        io.to(c.target).emit('challengeClosed', 'Has rechazado el reto.');
    });

    socket.on('coinflipChoice', ({ roomCode, challengeId, choice }) => {
        const room = rooms[roomCode];
        const c = room?.activeChallenges[challengeId];
        if (!c || c.status !== 'accepted' || c.locked) return;
        c.locked = true;

        const challengerSide = choice === 'Cara' ? 'Cruz' : 'Cara';
        io.to(c.challenger).emit('playCoinAnimation', { yourSide: challengerSide, rivalSide: choice });
        io.to(c.target).emit('playCoinAnimation', { yourSide: choice, rivalSide: challengerSide });

        setTimeout(() => {
            const result = Math.random() > 0.5 ? 'Cara' : 'Cruz';
            const targetWon = (result === choice);
            const winnerId = targetWon ? c.target : c.challenger;
            const loserId = targetWon ? c.challenger : c.target;

            const winner = room.players.find(p => p.id === winnerId);
            const loser = room.players.find(p => p.id === loserId);
            if (loser) {
                loser.drinks += 2;
                notifyDrink(loser.id, 2, winner ? winner.name : 'Rival', `Perdiste el Coinflip (salió ${result}).`);
            }

            broadcastPlayers(roomCode);
            const payload = {
                game: 'Coinflip de la Muerte',
                resultStr: `Salió ${result} (${c.targetName}: ${choice} | ${c.challengerName}: ${challengerSide})`,
                winner: winner ? winner.name : 'Nadie',
                loser: loser ? loser.name : 'Nadie',
                penalty: 2
            };
            io.to(c.challenger).emit('minigameResult', payload);
            io.to(c.target).emit('minigameResult', payload);
            addLog(roomCode, `🪙 Coinflip: ${payload.winner} ganó a ${payload.loser} (+2 tragos).`);
            delete room.activeChallenges[challengeId];
        }, 3000);
    });

    socket.on('rpsChoice', ({ roomCode, challengeId, choice }) => {
        const room = rooms[roomCode];
        const c = room?.activeChallenges[challengeId];
        if (!c || c.status !== 'accepted') return;

        if (socket.id === c.challenger && !c.challengerChoice) c.challengerChoice = choice;
        if (socket.id === c.target && !c.targetChoice) c.targetChoice = choice;

        if (c.challengerChoice && c.targetChoice) {
            const ch = c.challengerChoice;
            const ta = c.targetChoice;
            let payload;

            if (ch === ta) {
                payload = {
                    game: 'Piedra, Papel o Tijera',
                    resultStr: `${ch} vs ${ta} — ¡EMPATE!`,
                    winner: 'EMPATE',
                    loser: 'Nadie',
                    penalty: 0
                };
                addLog(roomCode, `✂️ PPT entre ${c.challengerName} y ${c.targetName}: Empate (${ch}).`);
            } else {
                const p1Wins = (ch === 'Piedra' && ta === 'Tijera') ||
                               (ch === 'Papel' && ta === 'Piedra') ||
                               (ch === 'Tijera' && ta === 'Papel');
                const winnerId = p1Wins ? c.challenger : c.target;
                const loserId = p1Wins ? c.target : c.challenger;
                const winner = room.players.find(p => p.id === winnerId);
                const loser = room.players.find(p => p.id === loserId);
                if (loser) {
                    loser.drinks += 3;
                    notifyDrink(loser.id, 3, winner ? winner.name : 'Rival', `Perdiste Piedra, Papel o Tijera (${ch} vs ${ta}).`);
                }

                broadcastPlayers(roomCode);
                payload = {
                    game: 'Piedra, Papel o Tijera',
                    resultStr: `${c.challengerName} (${ch}) vs ${c.targetName} (${ta})`,
                    winner: winner ? winner.name : 'Nadie',
                    loser: loser ? loser.name : 'Nadie',
                    penalty: 3
                };
                addLog(roomCode, `✂️ PPT: ${payload.winner} ganó a ${payload.loser} (+3 tragos).`);
            }

            io.to(c.challenger).emit('minigameResult', payload);
            io.to(c.target).emit('minigameResult', payload);
            delete room.activeChallenges[challengeId];
        } else {
            socket.emit('serverMsg', 'Elección guardada. Esperando a tu rival...');
        }
    });

    // Desconexiones y relevo automático de Máster
    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            const idx = room.players.findIndex(p => p.id === socket.id);
            if (idx !== -1) {
                const leftPlayer = room.players[idx];
                room.players.splice(idx, 1);

                for (const cid in room.activeChallenges) {
                    const ch = room.activeChallenges[cid];
                    if (ch.challenger === socket.id || ch.target === socket.id) {
                        const otherId = ch.challenger === socket.id ? ch.target : ch.challenger;
                        io.to(otherId).emit('challengeClosed', `${leftPlayer.name} se desconectó. Reto cancelado.`);
                        delete room.activeChallenges[cid];
                    }
                }

                broadcastPlayers(code);
                addLog(code, `🚪 ${leftPlayer.name} salió de la sala.`);

                if (room.host === socket.id && room.players.length > 0) {
                    room.host = room.players[0].id;
                    room.players[0].isHost = true;
                    io.to(room.host).emit('youAreHost');
                    broadcastPlayers(code);
                    io.to(code).emit('serverMsg', `👑 ${room.players[0].name} es el nuevo Máster.`);
                    addLog(code, `👑 ${room.players[0].name} heredó la corona de Máster.`);
                }

                if ((room.state === 'FASE_1' || room.state === 'FASE_1_ELEGIR_VICTIMA') && room.players.length > 0) {
                    if (room.turnPlayerIndex >= room.players.length) room.turnPlayerIndex = 0;
                    if (room.state === 'FASE_1_ELEGIR_VICTIMA' && room.pendingReward?.winnerId === socket.id) {
                        advancePhase1Turn(code);
                        return;
                    }
                }
                emitRoomState(code);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor Cefa Party V5 corriendo en http://localhost:${PORT}`);
});
