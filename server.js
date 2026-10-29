require('dotenv').config();
const express = require('express');
const http = require('http');
const session = require('express-session');
const crypto = require('crypto');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.PUBLIC_URL || false, credentials: true } });
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));
app.use(session({
  name: 'mafia.sid', secret: process.env.SESSION_SECRET || 'dev-only-change-this-secret',
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 86400000 }
}));
app.use(passport.initialize());
app.use(passport.session());
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({ clientID: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback' }, (_accessToken, _refreshToken, profile, done) => {
    const name = String(profile.displayName || 'O‘yinchi').slice(0,20);
    done(null, { id: `google:${profile.id}`, name, avatar: '🕵️', provider: 'google', photo: profile.photos?.[0]?.value || null });
  }));
}
app.get('/auth/google', (req,res,next) => { if(!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return res.status(503).send('Google OAuth sozlanmagan. .env faylida GOOGLE_CLIENT_ID va GOOGLE_CLIENT_SECRET kiriting.'); passport.authenticate('google',{scope:['profile','email'],session:true})(req,res,next); });
app.get('/auth/google/callback', (req,res,next) => passport.authenticate('google',{failureRedirect:'/?login=failed'})(req,res,err=>{if(err)return next(err);if(req.user)req.session.user=req.user;res.redirect('/?login=success');}));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'mafia-online', realtime: true }));
app.get('/api/stats', (_req, res) => res.json({ online: io.engine.clientsCount, rooms: [...rooms.values()].filter(r => r.status !== 'finished').length }));

// Telegram Mini App authentication: validate initData on the server before trusting identity.
app.post('/api/auth/telegram', (req, res) => {
  const initData = String(req.body?.initData || '');
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(503).json({ error: 'Telegram bot token is not configured on the server.' });
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return res.status(401).json({ error: 'Invalid Telegram initData.' });
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const calculated = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const a = Buffer.from(calculated, 'hex'), b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Telegram signature check failed.' });
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Math.abs(Date.now()/1000 - authDate) > 86400) return res.status(401).json({ error: 'Telegram login data expired.' });
  let user;
  try { user = JSON.parse(params.get('user') || '{}'); } catch { return res.status(400).json({ error: 'Invalid Telegram user data.' }); }
  if (!user.id) return res.status(401).json({ error: 'Telegram user not found.' });
  req.session.user = { id: `tg:${user.id}`, name: String(user.first_name || 'O‘yinchi').slice(0, 20), avatar: '🕵️', provider: 'telegram' };
  res.json({ ok: true, user: req.session.user });
});
app.get('/api/me', (req, res) => res.json({ user: req.session.user || req.user || null }));
app.post('/api/guest', (req, res) => {
  const name = String(req.body?.name || '').trim().replace(/[<>]/g, '').slice(0, 20);
  if (name.length < 2) return res.status(400).json({ error: 'Ism kamida 2 ta belgidan iborat bo‘lsin.' });
  req.session.user = { id: `guest:${crypto.randomUUID()}`, name, avatar: String(req.body?.avatar || '🕵️').slice(0, 8), provider: 'guest' };
  res.json({ ok: true, user: req.session.user });
});

const rooms = new Map();
const roleTemplates = [
  { key: 'mafia', name: 'MAFIYA', team: 'mafia', description: 'Tunda boshqa mafiyalar bilan nishonni tanlang.' },
  { key: 'detective', name: 'KOMISSAR', team: 'town', description: 'Tunda bir o‘yinchini tekshiring.' },
  { key: 'doctor', name: 'DOKTOR', team: 'town', description: 'Tunda bir o‘yinchini himoya qiling.' },
  { key: 'civilian', name: 'TINCH AHOLI', team: 'town', description: 'Kunduzi muhokama qiling va mafiyani toping.' }
];
function code() { let out; do { out = crypto.randomBytes(4).toString('hex').slice(0,5).toUpperCase(); } while (rooms.has(out)); return out; }
function publicRoom(room) {
  return { code: room.code, name: room.name, capacity: room.capacity, status: room.status, phase: room.phase, countdown: room.countdownRemaining || 0,
    hostId: room.hostId, players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, avatar: p.avatar, alive: p.alive, ready: p.ready, connected: p.connected, isHost: p.id === room.hostId })),
    startedAt: room.startedAt || null };
}
function broadcastRoom(room) { io.to(room.code).emit('room:state', publicRoom(room)); broadcastRooms(); }
function broadcastRooms() { io.emit('rooms:list', [...rooms.values()].filter(r => r.status !== 'finished').map(r => ({code:r.code,name:r.name,capacity:r.capacity,status:r.status,players:r.players.size,phase:r.phase}))); }
function sendError(socket, message) { socket.emit('app:error', { message }); }
function getPlayer(socket, room) { return room?.players.get(socket.data.playerId); }
function emitPrivateRole(socket, room, player) {
  if (player && player.role) socket.emit('role:private', { key: player.role.key, name: player.role.name, team: player.role.team, description: player.role.description });
}
function checkWin(room) {
  const alive = [...room.players.values()].filter(p => p.alive);
  const mafia = alive.filter(p => p.role?.team === 'mafia').length;
  const town = alive.length - mafia;
  if (mafia === 0) return 'town';
  if (mafia >= town) return 'mafia';
  return null;
}
function endGame(room, team) {
  room.status = 'finished'; room.phase = 'GAME_OVER';
  for (const p of room.players.values()) p.ready = false;
  for (const p of room.players.values()) io.to(p.id).emit('game:over', { winner: team, roles: [...room.players.values()].map(x => ({ id:x.id, name:x.name, role:x.role?.name || 'Noma’lum', alive:x.alive })) });
  broadcastRoom(room);
}
function startCountdown(room) {
  if (room.countdownTimer || room.players.size < room.capacity || room.status === 'playing' || room.status === 'paused') return;
  room.status = 'countdown'; room.phase = 'COUNTDOWN'; room.countdownRemaining = 10;
  broadcastRoom(room);
  io.to(room.code).emit('game:announcement', { text: 'Xona to‘ldi. O‘yin 10 soniyadan keyin boshlanadi.', phase: 'COUNTDOWN' });
  io.to(room.code).emit('game:countdown', { seconds: 10 });
  room.countdownTimer = setInterval(() => {
    if (room.status !== 'countdown' || room.players.size < room.capacity) {
      clearInterval(room.countdownTimer); room.countdownTimer = null; room.countdownRemaining = 0;
      if (room.status === 'countdown') { room.status = 'waiting'; room.phase = 'WAITING_ROOM'; broadcastRoom(room); }
      return;
    }
    room.countdownRemaining -= 1;
    io.to(room.code).emit('game:countdown', { seconds: room.countdownRemaining });
    broadcastRoom(room);
    if (room.countdownRemaining <= 0) {
      clearInterval(room.countdownTimer); room.countdownTimer = null; room.countdownRemaining = 0;
      startMatch(room);
    }
  }, 1000);
}
function startMatch(room) {
  const players = [...room.players.values()];
  if (players.length < 5) return false;
  const roles = [];
  const mafiaCount = players.length >= 9 ? 3 : players.length >= 7 ? 2 : 1;
  for (let i=0;i<mafiaCount;i++) roles.push(roleTemplates[0]);
  roles.push(roleTemplates[1], roleTemplates[2]);
  while (roles.length < players.length) roles.push(roleTemplates[3]);
  for (let i=roles.length-1;i>0;i--) { const j=crypto.randomInt(i+1); [roles[i],roles[j]]=[roles[j],roles[i]]; }
  players.forEach((p,i)=>{ p.role={...roles[i]}; p.alive=true; p.action=null; p.vote=null; });
  room.status='playing'; room.phase='DEALING'; room.day=0; room.startedAt=Date.now(); room.votes=new Map(); room.actions=new Map(); room.replacementRole=null; room.resumePhase=null;
  io.to(room.code).emit('game:announcement',{text:'O‘yin boshlandi! Kartalar aralashtirildi va rollar tarqatilmoqda.',phase:'DEALING'});
  for (const p of players) { emitPrivateRole(io.sockets.sockets.get(p.id), room, p); if(p.role.team==='mafia') io.to(p.id).emit('mafia:team', players.filter(x=>x.role.team==='mafia').map(x=>({id:x.id,name:x.name}))); }
  broadcastRoom(room);
  setTimeout(()=>{ if(room.status==='playing' && room.phase==='DEALING'){ room.phase='NIGHT'; broadcastRoom(room); io.to(room.code).emit('game:announcement',{text:'Tun boshlandi. Maxfiy harakatlar vaqti.',phase:room.phase}); room.phaseTimer=setTimeout(()=>{if(room.status==='playing'&&room.phase==='NIGHT')resolveNight(room);},45000); } }, 4500);
  return true;
}
function resolveNight(room) {
  const alive=[...room.players.values()].filter(p=>p.alive);
  const targetVotes=new Map();
  for(const [id,target] of room.actions.entries()){const p=room.players.get(id);if(p?.alive&&p.role?.team==='mafia'&&room.players.get(target)?.alive)targetVotes.set(target,(targetVotes.get(target)||0)+1);}
  const attack=[...targetVotes.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0];
  const doctor=[...room.actions.entries()].find(([id])=>room.players.get(id)?.alive&&room.players.get(id)?.role?.key==='doctor')?.[1];
  const detective=[...room.actions.entries()].find(([id])=>room.players.get(id)?.alive&&room.players.get(id)?.role?.key==='detective');
  if(detective){const target=room.players.get(detective[1]);if(target)io.to(detective[0]).emit('action:result',{kind:'investigation',name:target.name,result:target.role?.team==='mafia'?'MAFIYA':'MAFIYA EMAS'});}
  let result='Bu kecha hech kim o‘lmadi.';
  if(attack && attack!==doctor){const victim=room.players.get(attack);if(victim){victim.alive=false;result=`${victim.name} bu kecha o‘yindan chiqdi.`;}}
  room.actions.clear();room.votes.clear();room.phase='DAY';room.day++;
  io.to(room.code).emit('game:announcement',{text:result,phase:room.phase});broadcastRoom(room);
  const win=checkWin(room);if(win)endGame(room,win);
}
function resolveVote(room) {
  const counts=new Map();for(const [voter,target] of room.votes.entries()){if(room.players.get(voter)?.alive&&room.players.get(target)?.alive)counts.set(target,(counts.get(target)||0)+1);}
  const max=Math.max(0,...counts.values());const winners=[...counts.entries()].filter(([,n])=>n===max);
  let result='Ovozlar teng yoki yetarli emas. Hech kim chiqarilmadi.';
  if(max>0&&winners.length===1){const p=room.players.get(winners[0][0]);if(p){p.alive=false;result=`${p.name} ovoz bilan chiqarildi. Uning roli: ${p.role.name}.`;}}
  room.votes.clear();room.phase='VOTE_RESULT';io.to(room.code).emit('game:announcement',{text:result,phase:room.phase});broadcastRoom(room);
  const win=checkWin(room);if(win){endGame(room,win);return;}
  setTimeout(()=>{if(room.status==='playing'){room.phase='NIGHT';room.actions.clear();broadcastRoom(room);io.to(room.code).emit('game:announcement',{text:'Tun boshlandi. Maxfiy harakatlar vaqti.',phase:room.phase});setTimeout(()=>{if(room.status==='playing'&&room.phase==='NIGHT')resolveNight(room);},45000);}},5000);
}

io.on('connection', socket => {
  io.emit('stats:online', io.engine.clientsCount);
  socket.emit('rooms:list', [...rooms.values()].filter(r => r.status !== 'finished').map(r => ({code:r.code,name:r.name,capacity:r.capacity,status:r.status,players:r.players.size,phase:r.phase})));
  socket.on('room:create', data => {
    const name=String(data?.playerName||'Mehmon').trim().slice(0,20)||'Mehmon';
    const roomName=String(data?.name||'Yangi xona').trim().slice(0,32)||'Yangi xona';
    const capacity=Math.max(5,Math.min(12,Number(data?.capacity)||8));const roomCode=code();
    const player={id:socket.id,name,avatar:String(data?.avatar||'🕵️').slice(0,8),alive:true,ready:true,connected:true,role:null};
    const room={code:roomCode,name:roomName,capacity,status:'waiting',phase:'WAITING_ROOM',hostId:socket.id,players:new Map([[socket.id,player]]),votes:new Map(),actions:new Map(),countdownTimer:null,countdownRemaining:0};
    rooms.set(roomCode,room);socket.join(roomCode);socket.data.roomCode=roomCode;socket.data.playerId=socket.id;socket.emit('room:created',{code:roomCode});broadcastRoom(room);
  });
  socket.on('room:join', data => {
    const room=rooms.get(String(data?.code||'').toUpperCase());if(!room)return sendError(socket,'Bunday xona topilmadi.');
    if(!['waiting','paused'].includes(room.status))return sendError(socket,'Bu o‘yin hozir qo‘shilish uchun ochiq emas.');if(room.players.size>=room.capacity)return sendError(socket,'Xona to‘la.');if(room.status==='paused'&&!room.replacementRole)return sendError(socket,'O‘yin tiklanmoqda, biroz kuting.');
    const name=String(data?.playerName||'Mehmon').trim().slice(0,20)||'Mehmon';
    const replacing = room.status === 'paused';
    const player={id:socket.id,name,avatar:String(data?.avatar||'🕵️').slice(0,8),alive:true,ready:false,connected:true,role:replacing && room.replacementRole ? {...room.replacementRole} : null};room.players.set(socket.id,player);socket.join(room.code);socket.data.roomCode=room.code;socket.data.playerId=socket.id;socket.emit('room:joined',{code:room.code});
    if(replacing){room.status='playing';room.phase=room.resumePhase||'DAY';room.replacementRole=null;room.resumePhase=null;emitPrivateRole(socket,room,player);if(player.role?.team==='mafia')io.to(socket.id).emit('mafia:team',[...room.players.values()].filter(x=>x.alive&&x.role?.team==='mafia').map(x=>({id:x.id,name:x.name})));io.to(room.code).emit('game:announcement',{text:`${name} bo‘sh joyni egalladi. O‘yin davom etadi.`,phase:room.phase});if(room.phase==='NIGHT')room.phaseTimer=setTimeout(()=>{if(room.status==='playing'&&room.phase==='NIGHT')resolveNight(room);},45000);}
    broadcastRoom(room); if(room.status==='waiting' && room.players.size===room.capacity)startCountdown(room);
  });
  socket.on('player:ready', () => {const room=rooms.get(socket.data.roomCode);const p=getPlayer(socket,room);if(!room||room.status!=='waiting'||!p)return;p.ready=!p.ready;broadcastRoom(room);});
  socket.on('game:start', () => {const room=rooms.get(socket.data.roomCode);if(!room||room.hostId!==socket.id)return sendError(socket,'Faqat xona egasi o‘yinni boshlashi mumkin.');if(room.players.size<room.capacity)return sendError(socket,`Xona to‘lishi kerak: ${room.players.size}/${room.capacity}.`);if(room.status==='waiting')startCountdown(room);});
  socket.on('game:rematch',()=>{const room=rooms.get(socket.data.roomCode),p=getPlayer(socket,room);if(!room||!p||room.status!=='finished')return;p.ready=true;broadcastRoom(room);if(room.players.size>=5&&[...room.players.values()].every(x=>x.ready)){for(const x of room.players.values()){x.ready=false;x.alive=true;x.role=null;}room.status='waiting';room.phase='WAITING_ROOM';broadcastRoom(room);if(room.players.size===room.capacity)startCountdown(room);else io.to(room.code).emit('game:announcement',{text:'Qayta o‘yin uchun yana o‘yinchilar kutilyapti.',phase:'WAITING_ROOM'});}});
  socket.on('chat:send', data => {
    const room=rooms.get(socket.data.roomCode),p=getPlayer(socket,room);if(!room||!p||room.status!=='playing')return;
    const text=String(data?.text||'').trim().slice(0,240);if(!text)return;
    const now=Date.now();if(socket.data.lastChat&&now-socket.data.lastChat<700)return;socket.data.lastChat=now;
    const channel=String(data?.channel||'public');
    if(channel==='mafia'){if(room.phase!=='NIGHT'||p.role?.team!=='mafia'||!p.alive)return sendError(socket,'Mafiya chati siz uchun hozir yopiq.');for(const member of room.players.values()){if(member.alive&&member.role?.team==='mafia')io.to(member.id).emit('chat:message',{name:p.name,text,channel:'mafia',at:now,avatar:p.avatar});}}
    else {if(!p.alive||!['DAY','VOTE'].includes(room.phase))return sendError(socket,'Umumiy chat faqat tirik o‘yinchilar uchun kunduz kuni ochiq.');io.to(room.code).emit('chat:message',{name:p.name,text,channel:'public',at:now,avatar:p.avatar});}
  });
  socket.on('vote:cast', data => {const room=rooms.get(socket.data.roomCode),p=getPlayer(socket,room);const target=room?.players.get(String(data?.target||''));if(!room||room.status!=='playing'||room.phase!=='VOTE'||!p?.alive||!target?.alive)return sendError(socket,'Bu ovozni berib bo‘lmaydi.');room.votes.set(p.id,target.id);io.to(room.code).emit('vote:count',{count:room.votes.size});if(room.votes.size>=[...room.players.values()].filter(x=>x.alive).length)resolveVote(room);});
  socket.on('action:night', data => {const room=rooms.get(socket.data.roomCode),p=getPlayer(socket,room),target=room?.players.get(String(data?.target||''));if(!room||room.status!=='playing'||room.phase!=='NIGHT'||!p?.alive||!target?.alive)return sendError(socket,'Bu harakatga ruxsat yo‘q.');if(!['mafia','doctor','detective'].includes(p.role?.key))return sendError(socket,'Sizda tungi harakat yo‘q.');if(p.role.key==='mafia'&&target.role?.team==='mafia')return sendError(socket,'Boshqa mafiyani tanlab bo‘lmaydi.');room.actions.set(p.id,target.id);socket.emit('action:accepted',{name:target.name});const aliveRoles=[...room.players.values()].filter(x=>x.alive&&['mafia','doctor','detective'].includes(x.role?.key));if(aliveRoles.every(x=>room.actions.has(x.id)))resolveNight(room);});
  socket.on('game:phase-next',()=>{const room=rooms.get(socket.data.roomCode);if(!room||room.hostId!==socket.id||room.status!=='playing')return;if(room.phase==='DAY'){room.phase='VOTE';broadcastRoom(room);io.to(room.code).emit('game:announcement',{text:'Ovoz berish boshlandi.',phase:room.phase});setTimeout(()=>{if(room.status==='playing'&&room.phase==='VOTE')resolveVote(room);},30000);}else if(room.phase==='VOTE'){resolveVote(room);} });
  socket.on('room:leave',()=>leaveRoom(socket));
  socket.on('disconnect',()=>{leaveRoom(socket);io.emit('stats:online',io.engine.clientsCount);});
});
function leaveRoom(socket){
  const room=rooms.get(socket.data.roomCode);if(!room)return;
  const leaving=room.players.get(socket.data.playerId);
  if(room.countdownTimer){clearInterval(room.countdownTimer);room.countdownTimer=null;room.countdownRemaining=0;}
  if(room.status==='playing' && leaving){
    room.votes?.delete(leaving.id); room.actions?.delete(leaving.id);
    if(room.phaseTimer)clearTimeout(room.phaseTimer);
    room.replacementRole=leaving.role ? {...leaving.role} : null;
    room.resumePhase=room.phase==='DEALING'?'NIGHT':room.phase;
    room.status='paused';room.phase='WAITING_REPLACEMENT';
    io.to(room.code).emit('game:announcement',{text:`${leaving.name} o‘yinni tark etdi. Yangi o‘yinchi kutilmoqda.`,phase:room.phase});
  }
  room.players.delete(socket.data.playerId);socket.leave(room.code);
  if(!room.players.size){if(room.countdownTimer)clearInterval(room.countdownTimer);rooms.delete(room.code);socket.data.roomCode=null;return;}
  if(room.hostId===socket.id)room.hostId=room.players.keys().next().value;
  if(room.status==='countdown'){room.status='waiting';room.phase='WAITING_ROOM';room.countdownRemaining=0;}
  broadcastRoom(room);
  if(room.status==='waiting' && room.players.size===room.capacity)startCountdown(room);
  socket.data.roomCode=null;
}
const port=Number(process.env.PORT)||3000;
server.listen(port,()=>console.log(`MAFIA ONLINE running at http://localhost:${port}`));
