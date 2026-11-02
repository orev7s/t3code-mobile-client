# T3 Code Mobile &lt;Client&gt; 📱

A lightweight mobile client that wraps the [T3 Code](https://t3.codes) web UI as native Android and iOS apps. It connects to a T3 Code server you already run — over LAN, VPN/Tailscale, or the public internet — or to [T3 Connect](https://t3.codes) with your T3 account.

Drive your coding agents (Claude Code, Codex, OpenCode, Cursor, and more) from your phone while they and the server run on your computer, with full access to your code and tools 🖥️

> This is an independent, community project. It is **not** an official T3 Code app. T3 Code itself is MIT-licensed and lives at [pingdotgg/t3code](https://github.com/pingdotgg/t3code).

---

## Features

- 🌐 Connect to any T3 Code server over HTTP/HTTPS (LAN, VPN / Tailscale, or a public VPS)
- 🔑 **Pairing tokens**: paste the token (or the full pairing URL) from `t3 pair` and the app opens the server's `/pair` route for you
- ☁️ **T3 Connect**: sign in with your T3 account and reach machines already linked to T3 Connect
- ⌨️ Toggleable Enter=newline mode
- 📥 Files and copied text open on your phone: downloads go to the device and copy buttons write to the phone clipboard (toggle in Settings)
- 🔗 External links open in your phone's browser instead of navigating inside the session (toggle in Settings)
- 📋 Multiple server profiles with auto-connect support
- 🎛️ Pull-down menu for server management while connected. Pull to refresh, tap ⋮ to open menu.
- ❤️ Automatic health checks with exponential reconnect
- 🔒 Secure storage for pairing tokens (Keychain/EncryptedSharedPreferences)
- 🌓 Dark theme with light theme support (`prefers-color-scheme`)

---

## How to start your T3 Code server (REQUIRED TO USE THE APP ❗)

The app is a client that connects to a T3 Code server running on the machine where you have your code and build tools. It needs a running server to connect to.

### 1. Install the T3 Code CLI

```bash
curl -fsSL https://t3.codes/install.sh | sh
```

Then install and authenticate at least one provider (for example OpenCode, Claude Code, or Codex) on that machine.

### 2. Make the server reachable

For a server on your own network, let it accept LAN/tailnet connections:

```bash
t3 up --lan
# or keep a server in the foreground:
t3 serve --lan
```

For access from anywhere, enable T3 Connect instead:

```bash
t3 up --connect
```

### 3. Pair this phone (direct/LAN servers)

```bash
t3 pair
```

That prints a pairing URL such as `http://192.168.1.100:3773/pair#token=XXXXXXXX`. In the app, add a server and paste either the token or the whole URL into the **Pair this device** field. The app opens the server's pairing route and the device is authorized.

When the machine is only reachable through T3 Connect, skip pairing and use the **Use T3 Connect** entry on the app's home screen.

---

## Troubleshooting

### Cannot connect

- Verify the server is running and reachable from the phone: `curl http://your-server:3773/` from another device on the same network.
- Check that the port is not firewalled. A server started without `--lan` only accepts connections from its own machine.
- Make sure the URL and port in the app match the server.

### Pairing required

- The server is up but the device is not authorized. Run `t3 pair` on the server and enter the token in the server's **Pair this device** field.

### Blank web view

- The page can take a moment to load. If it stays blank, open the pull-down menu (⋮) and choose **Refresh**, or switch to another server / T3 Connect.

### HTTP blocked on Android/iOS

- Android: cleartext HTTP is allowed via `android:networkSecurityConfig`.
- iOS: local networking is enabled via `NSAllowsLocalNetworking` in `Info.plist`.

### Works in native app but not browser dev mode (CORS)

- This is expected. The web dev server at `localhost:5173` has a different origin than your T3 Code server.
- Use the native app build, or pair from a device that can reach the server.

---

## Contributing

PRs are welcome!

### Prerequisites

- **Node.js** 18+
- **npm** 9+
- For native builds:
  - **Android**: Android Studio, JDK 17, Android SDK 34+
  - **iOS**: Xcode 15+ (macOS only)

### Development (UI only — the embedded T3 Code UI needs a native platform to test)

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in a browser. The web target is for development and quick UI testing only. CORS may block health checks from the browser — test native builds for full functionality.

### Android

```bash
npm install
npm run build
npx cap add android
npx cap sync
npx cap open android
```

### iOS

```bash
npm install
npm run build
npx cap add ios
npx cap sync
npx cap open ios
```

---

## Commands Reference

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server (web) |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview production build |
| `npm test` | Run unit tests (Vitest) |
| `npm run lint` | TypeScript type-check only |
| `npm run cap:sync` | Sync Capacitor native projects |
| `npm run cap:open:android` | Open Android project in Android Studio |
| `npm run cap:open:ios` | Open iOS project in Xcode |
| `npm run store:verify` | Check store-readiness config files and release scaffolding |

---

## Project Structure

```
src/
  main.ts                          App entry
  App.vue                          Root component
  types.ts                         TypeScript type definitions
  router/index.ts                  Vue Router config (/connect/hosted = T3 Connect)
  stores/
    serverStore.ts                 Pinia store for server profiles + pairing tokens
    connectionStore.ts             Pinia store for connection state
  services/
    storage/
      profileStorage.ts            Server profile CRUD via Preferences
      secureSecretStorage.ts       Pairing token storage via Keychain/EncryptedSP
      webDevSecretStorage.ts       localStorage fallback for web dev
    t3code/
      url.ts                       URL normalization, validation, sanitization
      pairing.ts                   Pairing URL/token parsing and construction
      health.ts                    Server health check via native HTTP
    platform/
      deviceIntegration.ts         Downloads/clipboard/link settings
      externalLinks.ts             External-link message parsing
      nativeNotifications.ts       Web → native notification bridge
      systemBars.ts                Status/navigation bar configuration
      backButton.ts                Android back button handler
  components/
    LandingScreen.vue              Home: default server + T3 Connect entry
    ServerList.vue                 Server profile list
    ServerProfileForm.vue          Add/edit server form (incl. pairing token)
    ConnectionShell.vue            Full-screen WebView shell + injected features
    SettingsScreen.vue             App settings
    HelpScreen.vue                 Setup help
```

---

## Security Notes

### LAN HTTP is acceptable for trusted local networks only

The app allows connecting to HTTP servers because T3 Code servers commonly run on LAN without TLS. HTTP traffic should never traverse the public internet.

### For remote access, use a VPN, HTTPS, or T3 Connect

- **Recommended**: T3 Connect (a managed tunnel), or Tailscale / WireGuard / OpenVPN to securely extend your LAN
- **Alternative**: Put the server behind an HTTPS reverse proxy (Caddy, Nginx, Traefik) with TLS termination

**Do not expose a T3 Code server directly to the public internet without strong transport security.**

### Pairing tokens

- On native (Android/iOS) the pairing token is stored in platform secure storage — Android EncryptedSharedPreferences and iOS Keychain.
- On web (development only) it falls back to `localStorage`. This is **insecure** and only suitable for local development.
- Tokens are never logged and never shown in the UI by default.

---

## Known Limitations

1. **Single WebView**: Only one server session at a time.
2. **Pairing token TTL**: tokens from `t3 pair` expire quickly; pair once from the app so the WebView session persists, then clear the token if you like.
3. **Web dev CORS**: health checks in browser dev mode may be blocked by CORS. Native builds use `CapacitorHttp`.
4. **No background push**: pending approvals/completions are delivered as native notifications only while the WebView is open.

## License

MIT
