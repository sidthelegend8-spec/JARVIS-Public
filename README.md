# JARVIS-Public

A voice assistant for Windows, powered by Google's Gemini Live. Talk to J.A.R.V.I.S. and he answers out
loud, looks at your screen, researches the web, remembers things about you, opens apps and websites, and
connects to MCP servers and web APIs.

All you need is a Windows PC, a microphone, and a free Gemini key from Google.

---

## 1. Download and install (no coding needed)

1. Open the **[Releases page](https://github.com/sidthelegend8-spec/JARVIS-Public/releases/latest)**.
2. Under **Assets**, click **`JARVIS-Public-Setup-1.0.0.exe`** to download it (about 90 MB).
3. Double-click the downloaded file.
4. Windows may show a blue box saying **"Windows protected your PC"**. This appears for apps that are not
   code-signed (signing certificates cost money; the code is all here to read). Click **More info**, then
   **Run anyway**.
5. Pick where to install it, click **Install**, then **Finish**. JARVIS opens, and a **JARVIS** shortcut is
   added to your desktop and Start menu.

## 2. Get your free Gemini key (about 2 minutes)

1. Go to **[aistudio.google.com/apikey](https://aistudio.google.com/apikey)** and sign in with a Google account.
2. Click **Create API key**, then copy the key.
3. In JARVIS, open the **KEYS** tab, paste the key into **Gemini API Key**, click **Test**, then **Save**.

Your key stays on your PC. JARVIS has no keys built in: everyone uses their own.

## 3. Talk to him

1. Go back to the **HUD** tab and click the round microphone button. Allow the microphone if Windows asks.
2. Speak normally. Things to try:
   - "What's on my screen?" (he takes a look and tells you)
   - "Research electric cars" (a board of sources and a summary appear in the **RESEARCH** tab)
   - "Open YouTube and search for lo-fi music"
   - "What's in my downloads folder?"
   - "Remember that my favourite colour is blue"
   - "Open Spotify"
   - "Standby" (he goes quiet until you say "Hey Jarvis")
3. Click the microphone again to mute him.

## The tabs

| Tab | What it does |
|---|---|
| **HUD** | The main screen: talk to JARVIS, see what he is doing, your local time (and weather once you set a city in Settings) |
| **CHAT** | Every conversation, written out |
| **MCP** | Connect MCP servers to give him new tools |
| **API** | Connect web services (weather, web search and others) with their keys |
| **MEMORY** | What he remembers about you; edit, star or delete anything |
| **BROWSER** | Saved links you can open by name ("open my bank") |
| **SKILLS** | Your own commands: a trigger phrase and the steps it stands for |
| **RESEARCH** | Research boards: the sources pinned together with red string, and a written summary. Ask by voice or type a topic |
| **KEYS** | All your API keys in one place: Gemini (required), mem0 (optional) and any API-tab services |

The gear icon (top right) opens **Settings**: voice engine, voice, home city, and a test that checks he can
see your screen.

## Voice engines

JARVIS starts on **Gemini 3.8 Live**. If your key or Google will not start it, he switches by himself to
**Gemini 3.1 Flash Live**, and then to **Gemini 2.5**. You can pick a starting engine in Settings.

## Research

Say "Research ..." or type a topic in the RESEARCH tab. In 20 to 40 seconds you get up to 12 sources and a
three-paragraph summary with numbered links to each source. It uses Gemini with Google Search when your key
allows it; some free keys do not, and then it reads Google News and Wikipedia instead. No extra key needed.

## Privacy

- Your keys, chats, memories and research are saved only on your PC, in `%APPDATA%\JARVIS-Public`.
- What you say, and screenshots when you ask him to look at your screen, go to Google's Gemini service using
  your own key. Nothing goes anywhere else.
- Screenshots are never saved to disk.

## Troubleshooting

- **He does not answer**: open the KEYS tab and click **Test** next to your Gemini key. Check the microphone is
  allowed (Windows Settings > Privacy & security > Microphone).
- **"Gemini 3.8 Live would not start"** in the activity log: normal on some keys; he moves to 3.1 or 2.5 on his own.
- **Research says Google Search is not available**: he falls back to news and Wikipedia automatically.
- **Windows SmartScreen warning**: see step 4 of the install.

## For developers: build from source

Requires Node.js 20 or newer.

```bash
npm ci
npm run dev        # run in the browser at http://localhost:3000
npm run electron   # build and run as the desktop app
npm test           # type check and the test scripts
npm run dist       # build the Windows installer into release/
```

## Credits and license

A fan-made assistant inspired by the AI in the Iron Man films. Not affiliated with Marvel or Disney.

MIT License: see [LICENSE](LICENSE).
