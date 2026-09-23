# ROLL/TWO online server

## Local setup

1. Install Node.js 18 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set a strong `ADMIN_PASSWORD`.
4. Deploy the folder to a Node.js host, then share the public URL with players.
5. Run `npm start` and open `http://localhost:3000`.

Admin opens the Admin panel, enters the password, player ID, and token amount, then credits the account manually. The current server uses in-memory balances and orders for a development scaffold; use a persistent database before production so balances survive restarts and work across multiple server instances. Do not expose the admin password in frontend code.

Example local setup:

```bash
cp .env.example .env
```

Then edit `.env` and replace `ganti-dengan-password-admin-kuat` with your actual admin password. Restart `npm start` after changing `.env`.

## Multiplayer

Choose a name, click `Buat room`, and share the displayed room code. Other phones enter the code and click `Gabung room`. After at least two players join, click `Mulai untuk semua pemain`. Turns run in player order; only the current player's phone can roll, while every phone polls the shared room state and sees the same dice result.
