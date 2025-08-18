# Rzutnik RPG – Backend (Socket.IO)

Serwer odpowiada za liczenie rzutów i broadcast do wszystkich klientów.
Przechowuje **publiczną historię** w pamięci (do 200 wpisów).

## Lokalnie
```bash
npm i
npm start
```
Serwer ruszy na `http://localhost:3001`.

## Render / Railway
- Start command: `node server.js`
- Ustaw zmienną `CORS_ORIGIN` na adres(y) frontu, np.:
```
https://twoja-nazwa.github.io/rpg-rzutnik-front
```
Możesz podać kilka adresów, rozdzielając przecinkiem.

## Zdarzenia Socket.IO
- `roll:request` — klient prosi o rzut (serwer liczy i rozsyła).
- `roll:new` — nowy wpis (serwer → klienci).
- `history` — pełna historia (serwer → klient tuż po połączeniu).
- `session:new` — reset historii dla wszystkich.
