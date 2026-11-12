const socket = io({ reconnectionAttempts: Infinity, reconnectionDelay: 1000 });

let misDatos = {};
let isMaster = false;
let currentRoom = '';
let roomPlayers = [];
let myHand = [];
let currentState = null;
let selectedRivalId = null;
let currentChallengeId = null;
let pendingCardSendId = null;
let myGhost = false;

/* =========================================
   WAKE LOCK & HEARTBEAT ANTI-SUSPENSIÓN
========================================= */
let wakeLock = null;
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (e) {}
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
});
setInterval(() => {
    if (socket.connected) socket.emit('heartbeat');
}, 15000);

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    requestWakeLock();
}

function getPaloIcon(palo) {
    if (palo === 'Oros') return '🪙';
    if (palo === 'Copas') return '🏆';
    if (palo === 'Espadas') return '⚔️';
    if (palo === 'Bastos') return '🪵';
    return '';
}

/* =========================================
   MODO 1: LA SETA EXPRESS (1 MÓVIL - 41 CARTAS)
========================================= */
let mazoSeta = [];
let contadorAses = 1;

const reglasSeta = {
    1: "¡AS! Trago Incremental: Te toca beber X trago(s).",
    2: "¡DOS! Tú y los lados: Bebes tú y los dos que tienes al lado.",
    3: "¡TRES! Chicos: Todos los chicos de la mesa beben.",
    4: "¡CUATRO! Chicas: Todas las chicas de la mesa beben.",
    5: "¡CINCO! Yo nunca: Di un «Yo nunca...», quien lo haya hecho bebe.",
    6: "¡SEIS! Categorías: Elige un tema. El primero que falle bebe.",
    7: "¡SIETE! Tocar la nariz: ¡El último que se toque la nariz bebe 2!",
    10: "¡SOTA (Poder del guiño)! Guárdala. Si guiñas a alguien y no te pillan, bebe. Si te pillan, bebes tú.",
    11: "¡CABALLO (Esclavo)! Elige a alguien. Le puedes mandar beber tus tragos hasta el próximo caballo.",
    12: "¡REY (Poner norma)! Inventa una norma global. El que la rompa, bebe.",
    "SETA": "¡TE HA CAÍDO LA SETA! 🍄 BÉBETE EL VASO DEL CENTRO A FONDO BLANCO."
};

function nombreCartaSeta(num) {
    if (num === 1) return 'As';
    if (num === 10) return 'Sota';
    if (num === 11) return 'Caballo';
    if (num === 12) return 'Rey';
    return String(num);
}

function iniciarSeta() {
    showScreen('seta-screen');
    mazoSeta = [];
    contadorAses = 1;
    const palos = ['Oros', 'Copas', 'Espadas', 'Bastos'];
    const nums = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12]; // 40 + 1 Seta = 41
    for (let palo of palos) {
        for (let num of nums) {
            mazoSeta.push({ num, palo });
        }
    }
    mazoSeta.push("SETA");
    for (let i = mazoSeta.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [mazoSeta[i], mazoSeta[j]] = [mazoSeta[j], mazoSeta[i]];
    }
    document.getElementById('seta-counter').innerText = `Cartas restantes: ${mazoSeta.length}`;
    prepararSiguienteSeta();
}

function sacarCartaSeta() {
    if (mazoSeta.length === 0) return;
    const cartaObj = document.getElementById('seta-deck');
    const carta = mazoSeta.pop();

    if (carta === "SETA") {
        cartaObj.innerHTML = `<div class="card-seta-boom">🍄<br>¡LA SETA!</div>`;
        document.body.style.background = "#7f0000";
        document.getElementById('seta-card-title').innerText = "¡FIN DEL JUEGO!";
        document.getElementById('seta-card-rule').innerText = reglasSeta["SETA"];
    } else {
        const label = nombreCartaSeta(carta.num);
        cartaObj.innerHTML = `<div class="card-front palo-${carta.palo}">${label}<br>${getPaloIcon(carta.palo)}<br><small>${carta.palo}</small></div>`;
        let textoRegla = reglasSeta[carta.num];
        if (carta.num === 1) {
            textoRegla = textoRegla.replace("X", contadorAses);
            contadorAses++;
            if (contadorAses > 16) contadorAses = 1;
        }
        document.getElementById('seta-card-title').innerText = `${label} de ${carta.palo}`;
        document.getElementById('seta-card-rule').innerText = textoRegla;
    }

    document.getElementById('seta-chivato').classList.remove('hidden');
    document.getElementById('btn-next-seta').classList.remove('hidden');
    cartaObj.onclick = null;
    document.getElementById('seta-counter').innerText = `Cartas restantes: ${mazoSeta.length}`;
}

function prepararSiguienteSeta() {
    if (mazoSeta.length === 0) {
        iniciarSeta();
        return;
    }
    const cartaObj = document.getElementById('seta-deck');
    cartaObj.innerHTML = `<div class="card-back">TOCA PARA ROBAR</div>`;
    cartaObj.onclick = sacarCartaSeta;
    document.getElementById('seta-chivato').classList.add('hidden');
    document.getElementById('btn-next-seta').classList.add('hidden');
    document.body.style.background = "#111424";
}

function salirSeta() {
    document.body.style.background = "#111424";
    showScreen('main-menu');
}

/* =========================================
   MODO 2: LA PIRÁMIDE (LOGIN & LOBBY)
========================================= */
function joinPiramide() {
    const user = document.getElementById('username').value.trim();
    const room = document.getElementById('roomCode').value.toUpperCase().trim();
    if (!user || !room) {
        document.getElementById('login-error').innerText = 'Escribe tu apodo y el código de sala.';
        return;
    }
    document.getElementById('login-error').innerText = '';
    document.getElementById('btn-join').disabled = true;
    socket.emit('joinRoom', { username: user, roomCode: room });
}

socket.on('errorMsg', (msg) => {
    document.getElementById('login-error').innerText = msg;
    document.getElementById('btn-join').disabled = false;
    showNotification(msg);
});

function showNotification(msg) {
    const noti = document.getElementById('server-notification');
    noti.innerText = msg;
    noti.classList.remove('hidden');
    clearTimeout(noti._t);
    noti._t = setTimeout(() => noti.classList.add('hidden'), 3800);
}

socket.on('serverMsg', showNotification);

/* =========================================
   POP-UP OBLIGATORIO DE BEBER TRAGOS
========================================= */
socket.on('youMustDrink', ({ amount, from, reason }) => {
    document.getElementById('drink-alert-amount').innerText = `${amount} TRAGO${amount > 1 ? 'S' : ''}`;
    document.getElementById('drink-alert-from').innerText = `De: ${from}`;
    document.getElementById('drink-alert-reason').innerText = reason;
    document.getElementById('drink-alert-modal').classList.remove('hidden');
});

function closeDrinkAlertModal() {
    document.getElementById('drink-alert-modal').classList.add('hidden');
}

/* =========================================
   HISTORIAL DE EVENTOS ACTIVOS DE CEFA
========================================= */
function openEventsHistoryModal() {
    const list = document.getElementById('events-history-list');
    const events = currentState?.activeEvents || [];
    if (events.length === 0) {
        list.innerHTML = '<p style="color:#888; text-align:center;">Todavía no ha salido ningún evento de Cefa.</p>';
    } else {
        list.innerHTML = events.map(ev =>
            `<div class="event-history-card"><b>Fila ${ev.row} • ${ev.title}</b><p style="margin-top:4px; color:#ddd;">${ev.desc}</p></div>`
        ).join('');
    }
    document.getElementById('events-history-modal').classList.remove('hidden');
}

function closeEventsHistoryModal() {
    document.getElementById('events-history-modal').classList.add('hidden');
}

socket.on('joined', ({ roomCode, player, isHost }) => {
    misDatos = player;
    isMaster = isHost;
    currentRoom = roomCode;
    showScreen('piramide-game');
    if (isMaster) document.getElementById('master-btn').classList.remove('hidden');
});

socket.on('youAreHost', () => {
    isMaster = true;
    document.getElementById('master-btn').classList.remove('hidden');
    updateMasterButtons();
});

socket.on('updatePlayers', (players) => {
    roomPlayers = players;
    renderPlayersBar();
    renderMinigameRivals();
});

function renderPlayersBar() {
    const list = document.getElementById('players-list');
    list.innerHTML = '';

    const yo = roomPlayers.find(p => p.id === socket.id);
    if (yo) document.getElementById('mis-tragos').innerText = yo.drinks;

    const pendingIds = new Set((currentState?.pendingCardPlayers || []).map(p => p.id));

    roomPlayers.forEach(p => {
        const isTurn = currentState && (currentState.state === 'FASE_1' || currentState.state === 'FASE_1_ELEGIR_VICTIMA') && currentState.activePlayerId === p.id;
        const isPendingCard = pendingIds.has(p.id);
        const crown = p.isHost ? '👑 ' : '';
        const ghost = p.ghost ? ' 👻' : '';
        const alertIcon = isPendingCard ? ' 🎯' : '';
        list.innerHTML += `<div class="player-tag ${isTurn ? 'is-turn' : ''} ${isPendingCard ? 'is-pending-card' : ''} ${p.ghost ? 'is-ghost' : ''}">${crown}${p.name}${ghost}${alertIcon} • 🍺${p.drinks} • 🃏${p.cardCount}</div>`;
    });
}

socket.on('updateLogs', (logs) => {
    const logList = document.getElementById('log-list');
    logList.innerHTML = logs.map(l => `<div class="log-item"><b>[${l.time}]</b> ${l.text}</div>`).join('');
});

function toggleLogDrawer() {
    document.getElementById('log-drawer').classList.toggle('hidden');
}

function toggleGhostMode() {
    myGhost = !myGhost;
    const btn = document.getElementById('btn-ghost-toggle');
    btn.innerText = myGhost ? '👻 Fantasma' : '👻 Activo';
    btn.classList.toggle('ghost-on', myGhost);
    socket.emit('toggleGhost', { roomCode: currentRoom });
}

/* =========================================
   CONTROLES MÁSTER (CON SEMÁFORO Y COOLDOWN 1.5s)
========================================= */
function toggleMasterPanel() {
    document.getElementById('master-panel').classList.toggle('hidden');
}

function masterAction(eventName) {
    const btns = document.querySelectorAll('.btn-master-item');
    btns.forEach(b => b.disabled = true);
    socket.emit(eventName, { roomCode: currentRoom });
    setTimeout(() => {
        updateMasterButtons();
    }, 1500);
}

function updateMasterButtons() {
    if (!isMaster || !currentState) return;
    const s = currentState.state;
    const pending = currentState.pendingCardPlayers || [];
    const blockedByPending = pending.length > 0;

    const btnStart = document.getElementById('btn-master-start');
    const btnCard = document.getElementById('btn-master-card');
    const btnAuction = document.getElementById('btn-master-auction');
    const btnEvent = document.getElementById('btn-master-event');
    const pendingInfo = document.getElementById('master-pending-info');

    btnStart.classList.toggle('hidden', s !== 'LOBBY' && s !== 'HALL_OF_FAME');
    btnCard.classList.toggle('hidden', s !== 'PIRAMIDE_FILA');
    btnAuction.classList.toggle('hidden', s !== 'LISTO_SUBASTA');
    btnEvent.classList.toggle('hidden', s !== 'POST_SUBASTA');

    btnStart.disabled = false;
    btnEvent.disabled = false;
    btnCard.disabled = blockedByPending;
    btnAuction.disabled = blockedByPending;

    if (blockedByPending) {
        pendingInfo.classList.remove('hidden');
        pendingInfo.innerText = `⏳ Faltan por tirar: ${pending.map(p => p.name).join(', ')}`;
    } else {
        pendingInfo.classList.add('hidden');
    }
}

/* =========================================
   SINCRONIZACIÓN DE ESTADO Y TABLERO
========================================= */
socket.on('stateSync', (st) => {
    currentState = st;

    // Actualizar banner superior de Cefa
    const latestEvent = st.activeEvents && st.activeEvents.length > 0 ? st.activeEvents[0] : null;
    document.getElementById('active-rule-text').innerText = latestEvent
        ? `👁️ ${latestEvent.title}: ${latestEvent.desc} (Toca para ver todas)`
        : 'Normas Activas: Ninguna todavía (Toca para historial)';

    // Actualizar caja de comentarios en vivo
    if (st.liveComment) {
        document.getElementById('live-comment-box').innerText = st.liveComment;
    }

    renderPlayersBar();
    updateMasterButtons();
    renderCenterBoard();
    renderHand();

    // Si acerté en Fase 1 y me toca elegir víctima ahora
    if (st.state === 'FASE_1_ELEGIR_VICTIMA' && st.pendingReward && st.pendingReward.winnerId === socket.id) {
        openPhase1WinnerTargetModal(st.pendingReward);
    }
});

socket.on('phaseTransition', (msg) => {
    showNotification(msg);
});

socket.on('eventRevealed', (ev) => {
    showNotification(`👁️ NUEVO EVENTO: ${ev.title} — ${ev.desc}`);
});

function renderCenterBoard() {
    const mesa = document.getElementById('mesa-central');
    const st = currentState;
    if (!st) return;

    if (st.state === 'LOBBY') {
        mesa.innerHTML = `<h3>Sala ${currentRoom}</h3><p style="margin-top:8px; color:#ccc;">Esperando a que el Máster pulse 👑 → Repartir (Fase 1).</p>`;
        return;
    }

    if (st.state === 'FASE_1' || st.state === 'FASE_1_ELEGIR_VICTIMA') {
        const isMyTurn = st.activePlayerId === socket.id;
        const r = st.phase1Round;
        let qTitle = '';
        let controlsHtml = '';

        if (st.state === 'FASE_1_ELEGIR_VICTIMA') {
            mesa.innerHTML = `
                <div class="phase1-box my-turn-glow">
                    <h3 style="color:gold;">🎯 ¡ACIERTO!</h3>
                    <p style="margin-top:8px;"><b>${st.pendingReward.winnerName}</b> está eligiendo a quién mandar <b>${st.pendingReward.amount}</b> trago(s)...</p>
                </div>`;
            return;
        }

        if (r === 1) {
            qTitle = 'Ronda 1: Elige Palo (1 Trago)';
            controlsHtml = `
                <div class="options-grid">
                    <button class="opt-btn palo-Oros" onclick="submitPhase1Answer('Oros')">🪙 Oros</button>
                    <button class="opt-btn palo-Copas" onclick="submitPhase1Answer('Copas')">🏆 Copas</button>
                    <button class="opt-btn palo-Espadas" onclick="submitPhase1Answer('Espadas')">⚔️ Espadas</button>
                    <button class="opt-btn palo-Bastos" onclick="submitPhase1Answer('Bastos')">🪵 Bastos</button>
                </div>`;
        } else if (r === 2) {
            const c1 = myHand[0];
            qTitle = `Ronda 2: ¿Mayor, Menor o Igual que ${c1 ? c1.label : ''}? (2 Tragos)`;
            controlsHtml = `
                <div class="options-grid cols-3">
                    <button class="opt-btn" onclick="submitPhase1Answer('Mayor')">⬆️ Mayor</button>
                    <button class="opt-btn" onclick="submitPhase1Answer('Igual')">🟰 Igual</button>
                    <button class="opt-btn" onclick="submitPhase1Answer('Menor')">⬇️ Menor</button>
                </div>`;
        } else if (r === 3) {
            const c1 = myHand[0];
            const c2 = myHand[1];
            qTitle = `Ronda 3: ¿Dentro, Igual o Fuera de ${c1 ? c1.label : ''} y ${c2 ? c2.label : ''}? (3 Tragos)`;
            controlsHtml = `
                <div class="options-grid cols-3">
                    <button class="opt-btn" onclick="submitPhase1Answer('Dentro')">↔️ Dentro</button>
                    <button class="opt-btn" onclick="submitPhase1Answer('Igual')">🟰 Igual</button>
                    <button class="opt-btn" onclick="submitPhase1Answer('Fuera')">🔀 Fuera</button>
                </div>`;
        } else if (r === 4) {
            qTitle = 'Ronda 4: Apuesta Número Exacto (Mandas ese nº o bebes la diferencia)';
            let btns = '';
            for (let n = 1; n <= 12; n++) {
                const lbl = n === 1 ? 'As' : n === 10 ? 'Sota' : n === 11 ? 'Cab' : n === 12 ? 'Rey' : n;
                btns += `<button class="opt-btn" onclick="submitPhase1Answer('${n}')">${lbl}</button>`;
            }
            controlsHtml = `<div class="options-grid cols-4">${btns}</div>`;
        }

        if (isMyTurn) {
            mesa.innerHTML = `
                <div class="phase1-box my-turn-glow">
                    <h3 style="color:#00ff88;">⚡ ¡ES TU TURNO! ⚡</h3>
                    <p style="margin-top:6px;">${qTitle}</p>
                    ${controlsHtml}
                </div>`;
        } else {
            mesa.innerHTML = `
                <div class="phase1-box">
                    <h3>Fase 1 • Ronda ${r} de 4</h3>
                    <p style="margin-top:10px; color:#43d8c9; font-size:1.1rem;">Turno de <b>${st.activePlayerName}</b>...</p>
                </div>`;
        }
        return;
    }

    // Fases de Pirámide / Subasta / Evento
    let html = `<div style="margin-bottom:6px; font-weight:bold; color:#43d8c9;">Fila ${st.currentRow} de 4 • Vale ${st.currentRow} trago(s)</div>`;

    const pending = st.pendingCardPlayers || [];
    if (pending.length > 0) {
        html += `<div style="margin-bottom:8px; color:#ffbe0b; font-size:0.85rem; font-weight:bold;">⏳ Faltan por jugar carta: ${pending.map(p => p.name).join(', ')}</div>`;
    }

    if (st.state === 'SUBASTA' && st.auction) {
        const a = st.auction;
        html += `
            <div class="auction-box ${a.isOvertime ? 'overtime' : ''}">
                <h3>🔨 ¡SUBASTA EN VIVO!</h3>
                <p>Carta en juego: <b class="palo-${a.card.palo}">${a.card.label} de ${a.card.palo}</b></p>
                <div class="auction-timer">${a.secondsLeft}s ${a.isOvertime ? '🔥 PRÓRROGA' : ''}</div>
                <p>Puja actual: <b style="color:gold; font-size:1.3rem;">${a.bid} tragos</b> (${a.leaderName})</p>
                <div class="bid-buttons">
                    <button class="btn-bid" onclick="placeBid(1)">+1</button>
                    <button class="btn-bid" onclick="placeBid(3)">+3</button>
                    <button class="btn-bid" onclick="placeBid(5)">+5</button>
                </div>
            </div>`;
        mesa.innerHTML = html;
        return;
    }

    if (st.state === 'LISTO_SUBASTA' && pending.length === 0) {
        html += `<p style="color:gold; margin-bottom:8px; font-weight:bold;">Fila completada. El Máster ya puede abrir la Subasta 🔨</p>`;
    } else if (st.state === 'POST_SUBASTA') {
        html += `<p style="color:#e94560; margin-bottom:8px; font-weight:bold;">Subasta cerrada. El Máster ya puede desvelar el Evento 👁️</p>`;
    }

    const rows = [[9], [7, 8], [4, 5, 6], [0, 1, 2, 3]];
    rows.forEach(indices => {
        html += `<div class="pyramid-row">`;
        indices.forEach(idx => {
            const c = st.pyramid[idx];
            if (c && c.revealed) {
                html += `<div class="card-board front palo-${c.palo}">${c.label}<br>${getPaloIcon(c.palo)}</div>`;
            } else {
                html += `<div class="card-board back">👁️</div>`;
            }
        });
        html += `</div>`;
    });

    mesa.innerHTML = html;
}

/* =========================================
   FASE 1 ÁGIL Y SELECTOR DE VÍCTIMA
========================================= */
function submitPhase1Answer(answer) {
    document.querySelectorAll('.opt-btn').forEach(b => b.disabled = true);
    socket.emit('answerPhase1', { roomCode: currentRoom, answer });
}

function openPhase1WinnerTargetModal(reward) {
    pendingCardSendId = null;
    document.getElementById('target-modal-title').innerText = `🎯 ¡ACERTASTE (${reward.cardLabel})!`;
    document.getElementById('target-modal-desc').innerText = `Elige a quién mandas ${reward.amount} trago(s):`;
    document.getElementById('btn-pass-card-option').classList.add('hidden');
    document.getElementById('btn-cancel-target').classList.add('hidden');

    const grid = document.getElementById('target-avatars-grid');
    grid.innerHTML = '';
    const rivals = roomPlayers.filter(p => p.id !== socket.id);
    rivals.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'avatar-option';
        btn.innerText = `${p.name} (🍺${p.drinks})`;
        btn.onclick = () => {
            document.getElementById('target-selector-modal').classList.add('hidden');
            socket.emit('confirmPhase1Target', { roomCode: currentRoom, targetId: p.id });
        };
        grid.appendChild(btn);
    });

    document.getElementById('target-selector-modal').classList.remove('hidden');
}

function openSendCardModal(card, isMatchingCurrentCard) {
    pendingCardSendId = card.id;
    document.getElementById('target-modal-title').innerText = `🃏 ${card.label} de ${card.palo}`;
    document.getElementById('target-modal-desc').innerText = isMatchingCurrentCard
        ? `¡Coincide con la Pirámide! Mándala para meter ${currentState.currentRow} trago(s) o guárdatela:`
        : 'Pasa esta carta al inventario de otro jugador:';

    document.getElementById('btn-pass-card-option').classList.toggle('hidden', !isMatchingCurrentCard);
    document.getElementById('btn-cancel-target').classList.remove('hidden');

    const grid = document.getElementById('target-avatars-grid');
    grid.innerHTML = '';
    const rivals = roomPlayers.filter(p => p.id !== socket.id);
    rivals.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'avatar-option';
        btn.innerText = `${p.name} (🍺${p.drinks})`;
        btn.onclick = () => {
            document.getElementById('target-selector-modal').classList.add('hidden');
            socket.emit('sendCard', {
                roomCode: currentRoom,
                cardId: pendingCardSendId,
                targetId: p.id
            });
            pendingCardSendId = null;
        };
        grid.appendChild(btn);
    });

    document.getElementById('target-selector-modal').classList.remove('hidden');
}

function passCurrentCardTurn() {
    document.getElementById('target-selector-modal').classList.add('hidden');
    if (pendingCardSendId) {
        socket.emit('passCardTurn', { roomCode: currentRoom, cardId: pendingCardSendId });
        pendingCardSendId = null;
    }
}

function closeTargetModal() {
    document.getElementById('target-selector-modal').classList.add('hidden');
    pendingCardSendId = null;
}

/* =========================================
   INVENTARIO INFERIOR, HIDALGO Y SUBASTAS
========================================= */
socket.on('updateHand', (hand) => {
    myHand = hand;
    renderHand();
});

function renderHand() {
    const handDiv = document.getElementById('my-cards');
    handDiv.innerHTML = '';

    const isPyramidPhase = currentState &&
        (currentState.state === 'PIRAMIDE_FILA' || currentState.state === 'LISTO_SUBASTA' || currentState.state === 'POST_SUBASTA');

    // Si tienes 0 cartas en la pirámide -> Botón Hidalgo
    if (myHand.length === 0 && isPyramidPhase) {
        handDiv.innerHTML = `<button class="btn-hidalgo" onclick="triggerHidalgo()">🍺 HACERSE HIDALGO (Fondo blanco → +2 Cartas)</button>`;
        return;
    }

    const activeCard = currentState?.currentRevealedCard;
    const revealCounter = currentState?.revealCounter || 0;

    myHand.forEach(card => {
        const isLockedThisTurn = (revealCounter > 0 && card.lockedAtReveal === revealCounter);
        const isMatch = isPyramidPhase && activeCard && activeCard.num === card.num && !isLockedThisTurn;

        const div = document.createElement('div');
        div.className = `mini-card palo-${card.palo} ${isMatch ? 'neon-match' : ''} ${isLockedThisTurn ? 'card-locked' : ''}`;
        div.innerHTML = `<span>${card.label}</span><span>${getPaloIcon(card.palo)}</span>${isLockedThisTurn ? '<span class="lock-badge">🔒</span>' : ''}`;

        div.onclick = () => {
            if (isLockedThisTurn) {
                showNotification('🔒 Carta recibida/usada en este turno. Espera a la siguiente carta.');
                return;
            }
            if (roomPlayers.length <= 1) {
                showNotification('Necesitas más jugadores en la sala para mandar cartas.');
                return;
            }
            openSendCardModal(card, isMatch);
        };
        handDiv.appendChild(div);
    });
}

function triggerHidalgo() {
    socket.emit('becomeHidalgo', { roomCode: currentRoom });
}

function placeBid(increment) {
    socket.emit('placeBid', { roomCode: currentRoom, increment });
}

/* =========================================
   MINIJUEGOS DE PAUSA (COINFLIP & PPT)
========================================= */
function togglePauseMenu() {
    renderMinigameRivals();
    document.getElementById('pause-modal').classList.toggle('hidden');
}

function renderMinigameRivals() {
    const grid = document.getElementById('minigame-rivals-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const rivals = roomPlayers.filter(p => p.id !== socket.id);
    if (rivals.length === 0) {
        grid.innerHTML = '<p style="grid-column:span 2; color:#888;">No hay más jugadores en la sala.</p>';
        selectedRivalId = null;
        return;
    }

    if (!rivals.some(r => r.id === selectedRivalId)) {
        selectedRivalId = rivals[0].id;
    }

    rivals.forEach(p => {
        const btn = document.createElement('button');
        btn.className = `avatar-option ${p.id === selectedRivalId ? 'selected' : ''}`;
        btn.innerText = `${p.name} (🍺${p.drinks})`;
        btn.onclick = () => {
            selectedRivalId = p.id;
            renderMinigameRivals();
        };
        grid.appendChild(btn);
    });
}

function sendChallenge(gameType) {
    if (!selectedRivalId) {
        showNotification('Selecciona primero a un rival.');
        return;
    }
    socket.emit('sendChallenge', {
        roomCode: currentRoom,
        targetId: selectedRivalId,
        gameType
    });
    togglePauseMenu();
}

socket.on('challengeWaiting', ({ targetName }) => {
    showNotification(`⏳ Esperando a que ${targetName} acepte el reto (15s)...`);
});

socket.on('incomingChallenge', ({ challengeId, challengerName, gameType }) => {
    currentChallengeId = challengeId;
    const gameName = gameType === 'coinflip' ? '🪙 Coinflip de la Muerte' : '✂️ Piedra, Papel o Tijera';
    document.getElementById('incoming-challenge-text').innerHTML =
        `<b>${challengerName}</b> te reta a:<br><span style="color:#43d8c9; font-size:1.15rem;">${gameName}</span>`;

    document.getElementById('incoming-challenge-modal').classList.remove('hidden');
    const bar = document.getElementById('challenge-timer');
    bar.style.transition = 'none';
    bar.style.width = '100%';
    setTimeout(() => {
        bar.style.transition = 'width 15s linear';
        bar.style.width = '0%';
    }, 50);
});

socket.on('challengeClosed', (msg) => {
    document.getElementById('incoming-challenge-modal').classList.add('hidden');
    currentChallengeId = null;
    if (msg) showNotification(msg);
});

function acceptChallenge() {
    document.getElementById('incoming-challenge-modal').classList.add('hidden');
    socket.emit('acceptChallenge', { roomCode: currentRoom, challengeId: currentChallengeId });
}

function rejectChallenge() {
    document.getElementById('incoming-challenge-modal').classList.add('hidden');
    socket.emit('rejectChallenge', { roomCode: currentRoom, challengeId: currentChallengeId });
    currentChallengeId = null;
}

socket.on('challengeAccepted', (challenge) => {
    currentChallengeId = challenge.id;
    if (challenge.gameType === 'coinflip') {
        if (socket.id === challenge.target) {
            document.querySelectorAll('.coin-choice-btn').forEach(b => b.disabled = false);
            document.getElementById('coinflip-choice-modal').classList.remove('hidden');
        } else {
            showNotification(`🪙 ${challenge.targetName} está eligiendo Cara o Cruz...`);
        }
    } else if (challenge.gameType === 'rps') {
        document.querySelectorAll('.rps-choice-btn').forEach(b => b.disabled = false);
        document.getElementById('rps-choice-modal').classList.remove('hidden');
    }
});

function submitCoinflip(choice) {
    document.querySelectorAll('.coin-choice-btn').forEach(b => b.disabled = true);
    document.getElementById('coinflip-choice-modal').classList.add('hidden');
    socket.emit('coinflipChoice', { roomCode: currentRoom, challengeId: currentChallengeId, choice });
}

function submitRPS(choice) {
    document.querySelectorAll('.rps-choice-btn').forEach(b => b.disabled = true);
    document.getElementById('rps-choice-modal').classList.add('hidden');
    socket.emit('rpsChoice', { roomCode: currentRoom, challengeId: currentChallengeId, choice });
}

socket.on('playCoinAnimation', ({ yourSide, rivalSide }) => {
    document.getElementById('coin-sides-info').innerText = `Tú vas con ${yourSide} • Rival con ${rivalSide}`;
    document.getElementById('animation-modal').classList.remove('hidden');
});

socket.on('minigameResult', ({ game, resultStr, winner, loser, penalty }) => {
    document.getElementById('animation-modal').classList.add('hidden');
    document.getElementById('result-title').innerText = `🏆 ${game}`;
    document.getElementById('result-str').innerText = resultStr;
    document.getElementById('result-winner').innerText = winner === 'EMPATE' ? '¡EMPATE!' : `${winner} GANA`;
    document.getElementById('result-loser').innerText = penalty > 0 ? `${loser} bebe ${penalty} tragos.` : 'Nadie bebe.';
    document.getElementById('result-modal').classList.remove('hidden');
    currentChallengeId = null;
});

function closeResultModal() {
    document.getElementById('result-modal').classList.add('hidden');
}

/* =========================================
   HALL OF FAME FINAL
========================================= */
socket.on('gameFinished', ({ ranking, soberName }) => {
    const list = document.getElementById('hof-list');
    const medals = ['🥇', '🥈', '🥉'];
    list.innerHTML = ranking.map((p, idx) =>
        `<div style="padding:6px 0; border-bottom:1px solid #333;">${medals[idx] || '🍺'} <b>${p.name}</b>: ${p.drinks} tragos</div>`
    ).join('');
    document.getElementById('hof-sober-penalty').innerText = `🚨 Castigo al más sobrio (${soberName}): +5 TRAGOS EXTRA`;
    document.getElementById('hof-modal').classList.remove('hidden');
});

function closeHofModal() {
    document.getElementById('hof-modal').classList.add('hidden');
}
