# MAFIA ONLINE

A real-time multiplayer Mafia game starter using Express + Socket.IO. The project includes the supplied Mafia logo reference, individual role-card crops, live room creation/joining, server-assigned private roles, public chat, night actions, voting, win-condition checks, guest profiles, Google OAuth (requires your own credentials), and Telegram Mini App `initData` validation (requires a bot token).

## Requirements
- Node.js 20+
- npm
- Google OAuth credentials for Google login
- Telegram bot token for Telegram Mini App login

## Run locally
1. Copy `.env.example` to `.env`.
2. Set a long random `SESSION_SECRET`.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:3000` in two or more browser windows.
6. Create a room, then join using its code from other windows. A match requires at least 5 connected players.

## Google OAuth setup
Create an OAuth 2.0 Web Client in Google Cloud Console. Add the exact redirect URI from `GOOGLE_CALLBACK_URL`, e.g. `http://localhost:3000/auth/google/callback`. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`. For production, use HTTPS and the public callback URL.

## Telegram Mini App setup
Create a bot with BotFather and configure its Mini App URL to the deployed HTTPS website. Set `TELEGRAM_BOT_TOKEN` on the server. The Mini App should load the Telegram WebApp SDK and send `Telegram.WebApp.initData` to `/api/auth/telegram`; the server validates the signature and freshness before accepting the identity.

## Important production notes
- The game rooms are currently held in server memory. Restarting the Node process clears rooms. Use a persistent database and a shared Socket.IO adapter before scaling to multiple server instances.
- Match history and player statistics are not yet persisted. The included PostgreSQL variable is a deployment starting point, not a claim that persistence is already implemented.
- Configure HTTPS, secure cookies, a strong session secret, trusted origins, rate limits, logging, backups, and monitoring before public launch.
- The supplied front end is served by the same Node server so Socket.IO can synchronize game actions. A static-only deployment such as a standalone Netlify site cannot run this multiplayer backend by itself.
- The UI uses browser speech synthesis for Uzbek narration when the device provides a suitable voice. Device support varies.


## Xona to‘lishi va o‘yin jarayoni

- Xona yaratgan foydalanuvchi xona kodi va joriy o‘yinchilar sonini ko‘radi.
- Xonaga odamlar qo‘shilgan sari ro‘yxat real vaqt rejimida yangilanadi.
- Xona belgilangan sig‘imga yetganda server 10 dan 1 gacha sanaydi. Bitta o‘yinchi chiqib ketsa, sanash bekor qilinadi va xona yana to‘lishini kutadi.
- Sanash tugagach server rollarni tasodifiy aralashtirib taqsimlaydi; interfeys kartalar tarqatilish animatsiyasini ko‘rsatadi va o‘zbekcha ovozli “O‘yin boshlandi” e’lonini beradi (brauzer ovozi yoqilgan bo‘lishi kerak).
- O‘yin davomida bir o‘yinchi chiqsa, xona yangi o‘yinchi kirguncha vaqtincha to‘xtaydi. Yangi o‘yinchi bo‘sh joyni egallab, shu rol bilan o‘yinni davom ettiradi.
- O‘yin tugagach, har bir o‘yinchi “Men yana o‘ynayman” yoki “O‘yinni tark etish” tugmasini tanlaydi. Qayta o‘yin faqat qolgan o‘yinchilar tayyor bo‘lgach va xona to‘lgach boshlanadi.

Eslatma: xona va o‘yin holati hozircha server xotirasida saqlanadi; server qayta ishga tushganda xonalar o‘chadi. Ommaviy production uchun PostgreSQL/Redis, doimiy sessiyalar va qo‘shimcha yuklama testlari kerak.
