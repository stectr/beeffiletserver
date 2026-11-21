# Beeffilet sites

This repository contains four sites:

| Site | Files | Purpose |
| --- | --- | --- |
| `beeffilet.com` | `index.html`, `robots.txt` | Minimal “Hi” page and crawler instructions |
| `chords.beeffilet.com` | `chords.html` | Chord Sheet Generator |
| `tetris.beeffilet.com` | `tetris.html`, `tetris-icon.png` | Touch-only sTetris |
| `devo.beeffilet.com` | `server.js`, `icon2.png` | Devo app and Tetris leaderboard API |

## Chord Sheet Generator

`chords.html` is a standalone editor for computers. Phones and tablets show a notice; detected desktop-site mode shows a separate notice. Detection uses device signals and a local marker from a prior mobile visit, so it cannot identify every device spoofing a desktop.

### Editing and formatting

- Click or paste lyrics on the sheet and click above a word to add a chord. Click unused space in the upper or lower half of a row to edit its last chord or lyric; clicking anywhere on an empty row starts a lyric. Hyphens split words into chord blocks.
- Left/right arrows, including Ctrl or Cmd+arrow, move between lyric or chord boxes at their edges; up/down navigate lines. Enter on a word's chord moves the word and chord to a new line.
- Tab moves chord text after the cursor forward, shifting occupied blocks as needed. Shift+Tab before a chord moves it backward only when the previous block is empty. Backspace at the start moves and combines a chord with the previous one, or navigates back if empty; Ctrl or Cmd+Backspace in an empty chord block jumps to the previous non-empty chord.
- Drag across lyrics or from the paper margin to copy lyrics with chords; drag across chords to copy them separately. Pasting into ordinary text gives plain lyrics or a single line of chords. In the editor, pasted chords keep their lines, skip section headings, and add blocks after short lyric lines.
- A title with its key in parentheses, intro lines, and section headings at a column's top use only their needed space. A single-word colon label takes precedence over title detection, is bold, and has no chord slots. `Intro:` immediately after a title stays compact with extra space above it. The in-app formatting and page tips cover chords, sections, and page breaks.
- Sheets use 11-point Georgia in two columns on US Letter pages with half-inch margins. Scroll through them, print, or save a PDF through the browser with the Print button or Ctrl/Cmd+P. For matching output, select Letter, 100% scale, and half-inch margins in the print dialog if the browser does not apply them automatically. The interface uses Inter from Google Fonts with a system-font fallback.

### Pages and saving

- Sheets are saved in browser local storage on the current device and hostname, not on the server or across devices. A new sheet replaces the saved sheet; print or save a PDF before clearing browser data.
- Export downloads an editable, versioned `.chords.json` file named from the title(s), stopping at each recognized key, e.g. `Desert Song (G)`. Import also accepts older `.worship.json` exports with lyrics and chord placements. With existing content, choose Replace, Add to sheet on a new page, or Cancel. Imports can be undone.
- The save status and an “Import ‘It Is Well With My Soul (C)’” sample action appear below the formatting and page tips. The sample action asks whether to replace the current sheet, add it on a new page, or cancel.
- Click a page preview on the right to jump to it, or drag previews or use their arrows to rearrange pages. Reordering adds page breaks to keep pages together and can be undone. Split a line that spans pages before rearranging. Backspace on an empty line after a page break removes it.
- The sheet remains full-sized on narrow or zoomed-in screens; scroll horizontally to reach the sidebar. To move a sheet from the former worship hostname, export it there and import it on the new hostname; the old hostname may need to be restored temporarily.
- Use only lyrics you have permission to reproduce.

Browser regression tests run with `node --test tests/chords.browser.test.js` when Playwright and its WebKit browser are installed; otherwise they are skipped. Set `CHORDS_BROWSER=chromium` to test Chromium instead.

### Hosting

On this server, the HTTP virtual host is `/etc/nginx/sites-available/beeffilet`, enabled through `/etc/nginx/sites-enabled/beeffilet`. Point the `chords` DNS record at the server and configure HTTPS. For another server, add:

```nginx
server {
    listen 80;
    server_name chords.beeffilet.com;

    root /home/ubuntu/beeffiletserver;

    location = / {
        try_files /chords.html =404;
    }

    location = "/It Is Well With My Soul (C).chords.json" {
        try_files $uri =404;
    }

    location / {
        return 404;
    }
}
```

Test and reload Nginx as described below. This host currently serves HTTP at the origin; configure an origin certificate and HTTPS before using Cloudflare Full (strict) or direct HTTPS. Nginx serves the HTML directly, so edits do not require a Node restart.

## Root domain: beeffilet.com

Edit `index.html` for the deliberately minimal “Hi” page or `robots.txt` for crawler instructions. Nginx serves them directly from this directory; no Node restart is needed. The virtual-host configuration is `/etc/nginx/sites-available/beeffilet`.

`robots.txt` asks well-behaved crawlers not to crawl the site. The root response also sends `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet`. These are requests to compliant crawlers, not access control; the page remains publicly accessible.

After changing Nginx configuration, test and reload:

```sh
sudo nginx -t
sudo systemctl reload nginx
```

## sTetris

`tetris.html` is a standalone, mobile-only game. It uses guideline gravity (capped at 20G) and scoring (combos, back-to-back clears, perfect clears, and drop points), grid-stepped falling, a quick snap animation, and a brief hard-drop trail. Side-to-side dragging is calibrated; a slow downward drag holds soft drop.

- Pieces lock after 500 ms on the stack. Successful grounded moves and rotations reset the timer up to 15 times per piece; it pauses while airborne.
- New and held pieces appear immediately with a 150 ms touch-friendly grace period before gravity. Movement and rotation remain available; soft or hard drop bypasses the wait.
- Resuming shows a 3-2-1 countdown over the board and resets the lock timer. Switching away pauses the game. The latest clear and its points, including combo and back-to-back bonuses, appear below the board.
- Pixel is the default style; the selected style is saved in browser local storage. Tapping the style toggle seven times within eight seconds unlocks a debug action that clears the board for 800 × current-level points and four lines, making that run leaderboard-ineligible.
- Scores can be submitted to the shared leaderboard through the Devo Node service API. Run timing regression tests with `node --test tests/tetris-timing.test.js`.

To host `tetris.beeffilet.com`, point its DNS record at the server and add a separate Nginx virtual host. The game file is already in the web root, so no Node restart is needed:

```nginx
server {
    listen 80;
    server_name tetris.beeffilet.com;

    root /home/ubuntu/beeffiletserver;
    index tetris.html;

    location ^~ /api/tetris/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = / {
        try_files /tetris.html =404;
    }

    location / {
        return 404;
    }
}
```

The API location must be checked before the static-file locations so `/api/tetris/leaderboard` reaches the Node service. Test and reload Nginx after adding the block, then configure HTTPS as for the other subdomains.

## Devo app

The Node.js app fetches Alistair Begg's daily devotional and Further Reading passage from [Truth For Life](https://www.truthforlife.org/daily/?tab=alistair_begg_devotional), preserving paragraph and scripture-line formatting; Further Reading is collapsible and closed by default. `server.js` parses the source, caches each day's devotional in memory for 30 minutes, renders the HTML, and serves the Tetris leaderboard API. If the source markup changes or requests are blocked, the parser may need updating. Run the devotional parser tests with `node --test tests/devo.test.js`.

- Page markup and CSS are in `server.js`; there is no separate HTML file, build step, or package install. Node.js 18+ is required for its built-in `fetch`. The default port is `3000`; set `PORT` to change it.
- All submitted scores are saved in `tetris-leaderboard.json`, created after the first successful submission. The leaderboard shows each player's best score for the top 10 players, matching names case-insensitively, including Anonymous.
- `icon2.png` is Devo's browser and iOS home-screen icon. `tetris-icon.png` is the Tetris S-block browser and home-screen icon.
- Text size and the Paper, High Contrast White, and High Contrast Black appearances are saved in the visitor's browser, not on the server.

### Run manually

From the project directory:

```sh
cd /home/ubuntu/beeffiletserver
node server.js
```

Open `http://localhost:3000` on the server or the configured domain through Nginx. Stop the foreground process with `Ctrl+C`.

To run it in the background temporarily:

```sh
cd /home/ubuntu/beeffiletserver
nohup node server.js > /tmp/devo.log 2>&1 &
```

This is for a quick test, not production: it will not restart after a reboot or crash. Use systemd for that.

### Run with systemd

Create `/etc/systemd/system/beeffilet.service`:

```ini
[Unit]
Description=Beeffilet sites (Devo, Tetris API)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/beeffiletserver
ExecStart=/usr/bin/node /home/ubuntu/beeffiletserver/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Check Node's location with `command -v node`. If it is not `/usr/bin/node`, use the reported absolute path in `ExecStart`.

Install and start the service:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now beeffilet
sudo systemctl status beeffilet
```

After editing `server.js` or replacing the icon, restart and check the service:

```sh
sudo systemctl restart beeffilet
sudo systemctl status beeffilet
sudo journalctl -u beeffilet -n 50 --no-pager
```

Follow live logs with:

```sh
sudo journalctl -u beeffilet -f
```

If a manually started app is already using port 3000, find the listener:

```sh
sudo ss -ltnp | grep ':3000'
```

Stop only the specific PID shown before starting the service; do not run two copies on the same port.

### Nginx

Proxy the `devo.beeffilet.com` virtual host to `127.0.0.1:3000`. Add a separate `server` block to `/etc/nginx/sites-available/beeffilet` on this server; do not replace the other virtual hosts:

```nginx
server {
    listen 80;
    server_name devo.beeffilet.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Test and reload Nginx as above, then check the virtual host locally without DNS:

```sh
curl -i -H 'Host: devo.beeffilet.com' http://127.0.0.1/
curl -I -H 'Host: devo.beeffilet.com' http://127.0.0.1/icon2.png
```

### DNS and HTTPS

Create a `devo` A record pointing to the server's current public IPv4 address; confirm the address because it can change. If using Cloudflare proxying, match the other working subdomains. Check DNS:

```sh
dig +short devo.beeffilet.com
```

Once DNS points to the server and HTTP works, enable HTTPS. If using Certbot:

```sh
sudo certbot --nginx -d devo.beeffilet.com
```

Follow the prompts and verify HTTPS. If Cloudflare proxying is enabled, match its SSL/TLS mode to the certificate and origin setup.

### Updates

Edit `server.js` or `tetris.html`, or replace `icon2.png` (Devo) or `tetris-icon.png` (Tetris). Restart the Node app using the same method used to start it when changing `server.js` (`sudo systemctl restart beeffilet` under systemd); the directly served Tetris file needs no restart. Check service logs if Devo does not load. If Nginx configuration changes, run `sudo nginx -t` before reloading.
