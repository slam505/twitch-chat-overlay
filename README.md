# Twitch Chat Highlighter for OBS

Display Twitch chat messages on your stream with one click! ✨

---

## Quick Setup (5 Minutes)

### 1. Install the Extension
- Install from Chrome Web Store *(coming soon)*
- Or load unpacked from `chrome://extensions/`

### 2. Enable OBS WebSocket
1. Open **OBS Studio**
2. Go to **Tools → WebSocket Server Settings**
3. ✅ Check **"Enable WebSocket Server"**
4. Note the **port** (default: 4455)
5. Set a **password** if you want extra security

### 3. Add Browser Source in OBS
1. In OBS, click **+ Add Source → Browser**
2. Name it: **`TwitchHighlight`** ⚠️ *Must match exactly!*
3. Paste this URL:
   ```
   https://slam505.github.io/twitch-chat-overlay/overlay.html
   ```
4. Set **Width: 700** and **Height: 200**
5. Click **OK**
6. Position it where you want messages to appear

### 4. Connect the Extension
1. Click the **✨ extension icon** in Chrome
2. Enter: `ws://localhost:4455`
3. Enter your password (if you set one)
4. Make sure Browser Source Name is: `TwitchHighlight`
5. Click **Save & Connect**
6. Status should turn **green** ✅

### 5. Use It!
1. Go to any **Twitch stream**
2. Find a chat message you like
3. Click the **✨ button** next to it
4. Watch it appear on your stream! 🎉

---

## Troubleshooting

**Status won't turn green?**
- Make sure OBS is open
- Check WebSocket is enabled in OBS
- Verify port and password match

**Button shows ❌?**
- Check the Browser Source name matches exactly: `TwitchHighlight`
- Make sure the overlay URL is correct

**No ✨ buttons on Twitch?**
- Refresh the Twitch page
- Make sure you're on a channel with chat

**Extension was reloaded?**
- Just refresh the Twitch page (F5)

---

## Support

Having issues? [Open an issue on GitHub](https://github.com/slam505/twitch-chat-overlay/issues)

---

**Made with 💜 for streamers**
