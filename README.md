# Neon Strikers

An original, browser-hosted anime-style arcade football game. Its individually styled, cel-shaded players have custom hair, faces, kit numbers, and animated limbs; role-based CPU teammates and opponents keep their own formation lanes, press, support, pass, dribble, and shoot. The pitch, stadium, crowd, and match effects are generated in code; no game-franchise characters, artwork, or assets are included.

## Free hosting and phone testing

GitHub Pages can host this static game for free:

1. Create a GitHub repository and upload `index.html`, `style.css`, `game.js`, and `README.md` to its root.
2. In the repository, open **Settings → Pages**, choose **Deploy from a branch**, select `main` and `/ (root)`, then save.
3. Open the published HTTPS Pages URL on your computer. Allow a few minutes for the first deployment.
4. Choose **Start a Match**. Scan the lobby QR code with your phone; choose **Continue** and **Take the Field** on the host. The phone becomes your joystick/action controller while CPU-controlled players fill the match.

The **Play vs CPU** button starts a match immediately for keyboard testing. For phone testing, use **Continue** so you can keep the QR room open, then take the field. The QR link contains the hosted page address and a temporary PeerJS room ID.

This needs no paid hosting, custom server, build step, or API key. GitHub Pages serves the files; Three.js, PeerJS, QRCode.js, and fonts load from their public CDNs. The public PeerJS signaling service and direct WebRTC connection are best-effort public services, not guaranteed infrastructure. Phone control requires internet access and an HTTPS page. Static hosting does not promise sub-50ms latency, and some restrictive networks may prevent peer-to-peer connections.

## Local development

Serve this folder over HTTP (ES modules do not run reliably from a `file://` URL), then open the served address:

```sh
python -m http.server 8000
```

Open `http://localhost:8000`. The game uses Three.js, PeerJS, QRCode.js and Google Fonts from CDNs, so those services must be reachable. The lobby's `LOCAL-…` QR link uses `BroadcastChannel` for same-origin tabs on the same device. A phone cannot reach the computer's `localhost`; use the deployed HTTPS address for phone testing.

Browsers only allow orientation locking in supported contexts, usually after a user gesture. The controller therefore also presents a landscape prompt in portrait mode. Host keyboard controls are WASD (move), J (pass/switch), K or Space (shoot), L (tackle), E (special), and Escape (pause). On a phone, use the joystick and four action buttons.

## Scope and compatibility

This is an original, static-hosted anime-style football game with procedural Three.js characters and stadium, CPU football tactics, a synthesized audio layer, local and PeerJS controller transports, match HUD, goalkeeper duels, special-move cinematics, and match flow. Browser/device audio, vibration, orientation lock, WebRTC connectivity, and external CDNs are subject to platform and network support. Multiplayer synchronizes controller input to the host; the main display simulates the match and is authoritative. The character designs are original and do not reproduce franchise characters or assets.
