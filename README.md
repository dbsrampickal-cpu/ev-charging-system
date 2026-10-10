# EV Charging Network (Kerala)

A full-stack EV charging management system: find stations by district, start and stop
charging sessions, track battery level in real time, and pay with a wallet or UPI with a
GST-itemised receipt.

## Tech stack
- **Frontend:** HTML, CSS, vanilla JavaScript (responsive dark UI, glass cards, toasts, animated battery ring)
- **Backend:** Node.js, Express
- **Database:** Oracle (oracledb) with a PL/SQL billing procedure

## Features
- Register / login with inline validation
- Filter charging stations by Kerala district, with an "available only" switch
- Fast and Standard chargers with live availability
- Real-time charging simulation with elapsed time, battery gained and estimated energy
- Itemised receipt (energy, rate, base amount, 18% GST)
- Wallet top-up and checkout via wallet or UPI QR

## Project structure
```
ev-charging-system/
  Backend/    server.js, db.js
  Database/   schema.sql
  Frontend/   login.html, dashboard.html, css/style.css, js/login.js, js/dashboard.js
```

## Run locally
1. `npm install`
2. Copy `.env.example` to `.env` and add your Oracle credentials
3. Run `Database/schema.sql` in your Oracle database
4. `node Backend/server.js`
5. Open http://localhost:3000
