(() => {
  const socket = io({ transports: ['websocket', 'polling'] });
  let liveRoom = null, liveRole = null, livePlayerId = null, roomHost = false;
  const byId = id => document.getElementById(id);
  function notify(message) { if (typeof toast === 'function') toast(message); else alert(message); }
  function ensurePlayerName() {
    const input = byId('displayName');
    return (input?.value || window.mafiaPlayerName || 'Mehmon').trim().slice(0,20) || 'Mehmon';
  }
  function openLiveRoom(code, title) {
    byId('gameTitle').textContent = title || ('Xona ' + code);
    byId('phaseTimer').textContent = 'XONA KUTILMOQDA';
    byId('gameBody').style.display = 'block'; byId('roleReveal').style.display = 'none';
    const p = byId('gameBody').querySelector('.note');
    if (p) p.textContent = 'Jonli xona: ' + code + '. Do‘stlaringiz shu kod bilan qo‘shilishi mumkin.';
    openModal('gameModal');
  }
  function renderRoom(room) {
    liveRoom = room; livePlayerId = socket.id; roomHost = room.hostId === socket.id;
    byId('gameTitle').textContent = room.name + ' · #' + room.code;
    byId('phaseTimer').textContent = room.phase === 'COUNTDOWN' ? `⏳ ${room.countdown || 10} SONIYA` : ({WAITING_ROOM:'KUTILMOQDA',DEALING:'🎴 KARTALAR TARQATILMOQDA',ROLE_REVEAL:'KARTA OCHILMOQDA',WAITING_REPLACEMENT:'YANGI O‘YINCHI KUTILMOQDA',NIGHT:'🌙 TUN',DAY:'☀ KUN',VOTE:'🗳 OVOZ BERISH',VOTE_RESULT:'NATIJA',GAME_OVER:'YAKUN'})[room.phase] || room.phase;
    const table = byId('tablePlayers');
    table.innerHTML = '';
    table.classList.toggle('dealing', room.phase === 'DEALING');
    room.players.forEach(p => {
      const el = document.createElement('div'); el.className = 'player' + (!p.alive ? ' dead' : ''); el.dataset.index = p.id;
      el.innerHTML = `<div class="pico"></div><b></b><small></small>`;
      el.querySelector('.pico').textContent = room.phase === 'DEALING' ? '🎴' : (p.avatar || '🕵️');
      el.querySelector('b').textContent = p.name + (p.id === socket.id ? ' (Siz)' : '');
      el.querySelector('small').textContent = !p.alive ? 'O‘yindan chiqdi' : (room.status==='paused' ? 'O‘yinchi kutilmoqda' : (p.ready ? 'Tayyor' : 'Kutmoqda'));
      el.onclick = () => { document.querySelectorAll('.player').forEach(x => x.classList.remove('selected')); el.classList.add('selected'); el.dataset.targetId = p.id; };
      table.appendChild(el);
    });
    const hostButton = document.querySelector('button[onclick="nextPhase()"]');
    if (hostButton) hostButton.textContent = room.phase === 'DAY' ? '🗳 Ovoz berishni boshlash' : room.phase === 'VOTE' ? '📊 Ovozlarni yakunlash' : '🌙 Bosqichni almashtirish';
    if (room.status === 'waiting' || room.status === 'countdown') {
      const actions = byId('gameBody').querySelector('.gameactions');
      if (actions && !byId('liveReady')) {
        const ready = document.createElement('button'); ready.id='liveReady'; ready.className='btn secondary'; ready.textContent='✓ Tayyor / tayyor emas'; ready.onclick=()=>socket.emit('player:ready'); actions.prepend(ready);
        const start = document.createElement('button'); start.id='liveStart'; start.className='btn primary'; start.textContent=room.status==='countdown'?'⏳ Hisoblanmoqda…':'▶ Xona to‘lgach boshlanadi'; start.disabled=true; start.onclick=()=>socket.emit('game:start'); actions.prepend(start);
      }
    }
    if (['playing','paused','finished'].includes(room.status)) { ['liveReady','liveStart'].forEach(id=>byId(id)?.remove()); }
    if (room.status === 'waiting' && room.players.length < room.capacity) {
      let wait = byId('liveWaitStatus'); if(!wait){wait=document.createElement('div');wait.id='liveWaitStatus';wait.className='roomtop';byId('tablePlayers').before(wait);}
      wait.innerHTML=`<span class="pill green">O‘yinchilar kutilmoqda</span><strong>${room.players.length} / ${room.capacity}</strong><span class="note">Xona to‘lgach 10 soniyalik sanash boshlanadi.</span>`;
    } else byId('liveWaitStatus')?.remove();
    if (room.status === 'countdown') {let c=byId('liveWaitStatus');if(!c){c=document.createElement('div');c.id='liveWaitStatus';c.className='countdown-banner';byId('tablePlayers').before(c);}c.textContent=`🎴 Kartalar aralashtirishga ${room.countdown || 10} soniya qoldi`; }
    if (room.status === 'paused') {let wait=byId('liveWaitStatus');if(!wait){wait=document.createElement('div');wait.id='liveWaitStatus';wait.className='countdown-banner';byId('tablePlayers').before(wait);}wait.textContent='⏸ O‘yin vaqtincha to‘xtatildi. Bo‘sh joyga yangi o‘yinchi kirishi kutilmoqda.';}
    if (room.status === 'finished') {
      let panel=byId('postGameActions');if(!panel){panel=document.createElement('div');panel.id='postGameActions';panel.className='gameactions';byId('gameBody').appendChild(panel);}
      panel.innerHTML='';const again=document.createElement('button');again.className='btn primary';again.textContent='🔁 Men yana o‘ynayman';again.onclick=()=>{socket.emit('game:rematch');notify('Qayta o‘yin uchun tayyorligingiz bildirildi.');};const leave=document.createElement('button');leave.className='btn secondary';leave.textContent='🚪 O‘yinni tark etish';leave.onclick=()=>{socket.emit('room:leave');closeModal('gameModal');panel.remove();};panel.append(again,leave);
    } else byId('postGameActions')?.remove();
    if (!byId('leaveRoomBtn') && room.status !== 'finished') {const leave=document.createElement('button');leave.id='leaveRoomBtn';leave.className='btn secondary';leave.textContent='🚪 Xonadan chiqish';leave.onclick=()=>{socket.emit('room:leave');closeModal('gameModal');};byId('gameBody').querySelector('.gameactions')?.appendChild(leave);} if(room.status==='finished')byId('leaveRoomBtn')?.remove();
    if (['waiting','countdown'].includes(room.status) && !document.getElementById('liveRoomCode')) {
      const note = document.createElement('div'); note.id='liveRoomCode'; note.className='roomtop'; note.innerHTML=`<span class="pill green">Jonli xona kodi</span><strong>${room.code}</strong><button class="btn secondary" style="padding:7px 10px" id="copyRoomCode">Nusxalash</button>`;
      byId('tablePlayers').before(note); byId('copyRoomCode').onclick=()=>navigator.clipboard?.writeText(room.code).then(()=>notify('Xona kodi nusxalandi: '+room.code)).catch(()=>notify('Xona kodi: '+room.code));
    }
    if (!['waiting','countdown'].includes(room.status)) byId('liveRoomCode')?.remove();
    openModal('gameModal');
  }
  socket.on('connect', () => { document.body.dataset.connection='connected'; });
  socket.on('disconnect', () => { document.body.dataset.connection='disconnected'; notify('Server bilan aloqa uzildi. Qayta ulanmoqda…'); });
  socket.on('stats:online', n => { const el=byId('onlineCount'); if(el) el.textContent=String(n); });
  socket.on('rooms:list', rooms => {
    const root=byId('liveRooms'); if(!root)return; root.innerHTML='';
    if(!rooms.length){const card=document.createElement('article');card.className='room';card.innerHTML='<div class="roomtop"><span class="pill">Ochiq xonalar</span></div><h3>Hozircha xona yo‘q</h3><p class="note">Birinchi xonani yarat va do‘stlaringni kod orqali taklif qil.</p><button class="btn primary" id="firstRoomBtn">Xona yaratish</button>';root.appendChild(card);byId('firstRoomBtn').onclick=()=>openModal('createModal');return;}
    rooms.forEach(r=>{const card=document.createElement('article');card.className='room';const waiting=['waiting','paused'].includes(r.status);card.innerHTML=`<div class="roomtop"><span class="pill ${waiting?'green':''}">${r.status==='paused'?'● Yangi o‘yinchi kutilmoqda':waiting?'● Kutmoqda':'● O‘yin ketmoqda'}</span><span style="color:var(--muted);font-size:11px">#${r.code}</span></div><h3></h3><div class="roommeta"><span>O‘yinchilar</span><b>${r.players} / ${r.capacity}</b></div><div class="roommeta"><span>${r.phase==='WAITING_ROOM'?'Boshlashni kutmoqda':r.phase==='WAITING_REPLACEMENT'?'Bo‘sh joy bor':r.phase==='COUNTDOWN'?'O‘yin boshlanmoqda':r.phase}</span><span>Jonli</span></div><button class="btn ${waiting?'secondary':'primary'}" ${waiting?'':'disabled'}>${r.status==='paused'?'Bo‘sh joyni egallash':waiting?'Xonaga qo‘shilish':r.status==='countdown'?'Sanash boshlandi':'O‘yin ketmoqda'}</button>`;card.querySelector('h3').textContent=r.name;const btn=card.querySelector('button');btn.onclick=()=>{if(waiting){byId('roomCode').value=r.code;openModal('joinModal')}else if(r.status==='countdown')notify('Sanash boshlangan. Xona to‘lgach o‘yin boshlanadi.');else notify('Bu o‘yin allaqachon boshlangan.');};root.appendChild(card);});
  });
  socket.on('room:created', data => { notify('Xona yaratildi. Kod: '+data.code); });
  socket.on('room:joined', data => notify('Xonaga qo‘shildingiz: '+data.code));
  socket.on('room:state', renderRoom);
  socket.on('role:private', role => {
    liveRole = role;
    const option = (typeof roleOptions !== 'undefined' ? roleOptions : []).find(x => x.key === role.key) || {};
    currentRole = { key:role.key, name:role.name, desc:role.description, speech:role.description };
    notify('Sizning maxfiy rolingiz tayyor. “Mening rolim” tugmasini bosing.');
  });
  socket.on('chat:message', m => {
    if (m.channel === 'mafia' && liveRole?.team !== 'mafia') return;
    if (typeof addChat === 'function') addChat(m.name, m.text);
  });
  socket.on('game:countdown', m => { byId('phaseTimer').textContent=`⏳ ${m.seconds} SONIYA`; if(m.seconds>0) sayUz(String(m.seconds)); else sayUz('O‘yin boshlandi'); });
  socket.on('game:announcement', m => { if(typeof addChat==='function')addChat('O‘YIN',m.text); if(m.phase==='COUNTDOWN')sayUz('Xona to‘ldi. O‘yin o‘n soniyadan keyin boshlanadi.'); if(m.phase==='DEALING')sayUz('O‘yin boshlandi. Kartalar aralashtirildi va rollar tarqatilmoqda.'); if(m.phase==='NIGHT')sayUz('Tun boshlandi.'); if(m.phase==='DAY')sayUz('Tong otdi. '+m.text); if(m.phase==='WAITING_REPLACEMENT')sayUz('O‘yinchi chiqib ketdi. Yangi o‘yinchi kutilmoqda.'); });
  socket.on('action:result', m => notify(m.kind==='investigation' ? `${m.name}: ${m.result}` : m.name));
  socket.on('action:accepted', m => notify('Harakat yuborildi: '+m.name));
  socket.on('vote:count', m => notify('Ovozlar qabul qilindi: '+m.count));
  socket.on('game:over', data => { addChat('O‘YIN YAKUNI', 'G‘olib jamoa: '+(data.winner==='mafia'?'MAFIYA':'TINCH AHOLI')); data.roles.forEach(p=>addChat('YAKUNI',`${p.name}: ${p.role}${p.alive?' (tirik)':' (chiqdi)'}`)); sayUz('O‘yin yakunlandi. G‘olib jamoa: '+(data.winner==='mafia'?'Mafiya':'Tinch aholi')+'. Xohlasangiz yana o‘ynashingiz yoki xonani tark etishingiz mumkin.'); });
  socket.on('app:error', e => notify(e.message || 'Xatolik yuz berdi.'));

  window.createRoom = function() {
    const name = (byId('roomName').value || 'Do‘stlar davrasi').trim();
    const capacity = Number(byId('roomSize').value || 8);
    const playerName = ensurePlayerName();
    if (playerName.length < 2) { closeModal('createModal'); byId('displayName').value=''; openModal('profileModal'); return notify('Avval profilingizga kamida 2 belgili ism kiriting.'); }
    if (capacity < 5 || capacity > 12) return notify('O‘yinchilar soni 5 dan 12 gacha bo‘lsin.');
    closeModal('createModal');
    socket.emit('room:create', { name, capacity, playerName, avatar: typeof chosenAvatar!=='undefined'?chosenAvatar:'🕵️' });
  };
  window.joinFromCode = function() {
    const code = (byId('roomCode').value || '').trim().toUpperCase();
    const name = (byId('playerName').value || ensurePlayerName()).trim();
    if (!code) return notify('Xona kodini kiriting.');
    if (name.length < 2) return notify('Kamida 2 belgili ism kiriting.');
    window.mafiaPlayerName = name; closeModal('joinModal');
    socket.emit('room:join', { code, playerName:name, avatar:typeof chosenAvatar!=='undefined'?chosenAvatar:'🕵️' });
  };
  window.joinDemo = function(code) { byId('roomCode').value=code; openModal('joinModal'); };
  window.startGame = function() { notify('Jonli o‘yin serverdan boshqariladi. Xonada kamida 5 o‘yinchi bo‘lsin.'); };
  window.sendChat = function() { const input=byId('chatText'); const text=input.value.trim(); if(!text)return; socket.emit('chat:send',{text,channel:liveRole?.team==='mafia'&&liveRoom?.phase==='NIGHT'?'mafia':'public'}); input.value=''; };
  window.castVote = function() { const chosen=document.querySelector('.player.selected'); if(!chosen)return notify('Avval o‘yinchini tanlang.'); socket.emit('vote:cast',{target:chosen.dataset.index}); };
  window.nextPhase = function() { if(!liveRoom)return notify('Avval jonli xonaga kiring.'); if(liveRoom.phase==='NIGHT'){const chosen=document.querySelector('.player.selected');if(!chosen)return notify('Tunda harakat uchun o‘yinchini tanlang.');socket.emit('action:night',{target:chosen.dataset.index});}else socket.emit('game:phase-next'); };
  window.revealRole = function() {
    if(!liveRole) return notify('Rol kartasi o‘yin boshlanganda server tomonidan beriladi.');
    const imgs = {mafia:'card-mafia.jpg',detective:'card-detective.jpg',doctor:'card-doctor.jpg',civilian:'card-civilian.jpg'};
    byId('roleCardImage').src = imgs[liveRole.key] || (roleImages?.[liveRole.key] || 'card-civilian.jpg');
    byId('roleName').textContent=liveRole.name;byId('roleDesc').textContent=liveRole.description;
    byId('roleReveal').style.display='block';byId('gameBody').style.display='none';sayUz(liveRole.description);
  };
  window.beginLogin = function(provider) {
    if(provider==='Google'){ window.location.href='/auth/google'; return; }
    const tg = window.Telegram?.WebApp;
    if(tg?.initData){fetch('/api/auth/telegram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:tg.initData})}).then(r=>r.json()).then(d=>{if(!d.ok)throw new Error(d.error||'Telegram kirish bajarilmadi');window.mafiaPlayerName=d.user.name;notify('Telegram orqali kirdingiz.');}).catch(e=>notify(e.message));}
    else { closeModal('loginModal'); byId('displayName').value=window.mafiaPlayerName||''; openModal('profileModal'); notify('Telegram login Mini App ichida ishlaydi. Hozircha ism bilan mehmon sifatida kirishingiz mumkin.'); }
  };
  window.saveProfile = async function() {
    const name=(byId('displayName').value||'').trim();if(name.length<2)return notify('Ism kamida 2 ta belgidan iborat bo‘lsin.');
    try { const r=await fetch('/api/guest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,avatar:typeof chosenAvatar!=='undefined'?chosenAvatar:'🕵️'})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Profil saqlanmadi');window.mafiaPlayerName=d.user.name;displayName=d.user.name;closeModal('profileModal');notify('Profil saqlandi: '+d.user.name);sayUz('Xush kelibsiz, '+d.user.name); }
    catch(e){notify(e.message||'Serverga ulanib bo‘lmadi.');}
  };
  fetch('/api/me').then(r=>r.json()).then(d=>{if(d.user){window.mafiaPlayerName=d.user.name;displayName=d.user.name;const nameInput=byId('displayName');if(nameInput)nameInput.value=d.user.name;}}).catch(()=>{});
  // Real rooms replace static showcase cards as soon as the backend is reachable.
  fetch('/api/stats').then(r=>r.json()).then(s=>{if(byId('onlineCount'))byId('onlineCount').textContent=s.online;}).catch(()=>{});
})();
