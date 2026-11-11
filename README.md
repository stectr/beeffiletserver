# Beeffilet sites

This folder contains the `beeffilet.com` root page, the touch-only sTetris game for `tetris.beeffilet.com`, and the Devo Node.js app for `devo.beeffilet.com`.

## Root domain: beeffilet.com

- `index.html` is the deliberately minimal “Hi” page.
- `tetris.html` is the standalone, mobile-only sTetris game with guideline gravity (capped at 20G), guideline scoring including combos, back-to-back clears, perfect clears, and drop points, grid-stepped falling and quick snap animation, a brief hard-drop trail, calibrated side-to-side dragging, and slow downward drags that act as a soft-drop hold. Tapping the style toggle seven times within eight seconds unlocks a debug action to clear the board for 800 × current-level points and four lines; using it makes the run ineligible for the leaderboard. Pixel is the default style; a player's selected style is saved in browser local storage. Scores can be submitted to the shared leaderboard through the Devo Node service API.
- Pieces lock after 500 ms on the stack; successful grounded moves and rotations reset that timer up to 15 times per piece, and the timer pauses while airborne. New and held pieces appear immediately with a 150 ms touch-friendly grace period before gravity starts; movement and rotation remain available, and soft or hard drop bypasses the wait. Resuming a paused game shows a 3-2-1 countdown over the board and resets the lock timer; switching away from the page pauses the game. The latest clear and its awarded points, including combo and back-to-back bonuses, appear below the board.
- Run the Tetris timing regression tests with `node --test tests/tetris-timing.test.js`.
- `robots.txt` asks all well-behaved crawlers not to crawl the site.
- Nginx serves these files directly from this directory. The nginx virtual-host configuration itself lives at `/etc/nginx/sites-available/beeffilet`.
- The root-domain response also sends `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet`.

To change the root page, edit `index.html`; to change crawler instructions, edit `robots.txt`. Nginx serves the files directly, so no Node restart is needed. After changing nginx config, test and reload:

```sh
sudo nginx -t
sudo systemctl reload nginx
```

Robots directives are requests to compliant crawlers, not access control. The public page remains accessible to anyone.

To serve the game at `tetris.beeffilet.com`, point its DNS record at this server and add a separate Nginx virtual host. The game file is in the existing web root, so no Node restart is needed:

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

The API location must be checked before the static-file locations so `/api/tetris/leaderboard` reaches the Node service. Test and reload Nginx after adding the block. Configure HTTPS for the new host using the same approach as the other subdomains.

## Devo app

A small Node.js website that fetches Alistair Begg's daily devotional and its Further Reading passage from Truth For Life and presents them in a simple, readable layout with a collapsible Further Reading section.

## How it works

- `server.js` fetches and parses the source page, caches each day's devotional in memory for 30 minutes, returns the rendered HTML, and serves the Tetris leaderboard API.
- Tetris leaderboard entries are stored in `tetris-leaderboard.json` in this project folder; the file is created automatically after the first successful score submission. After editing `server.js`, restart the Node process using the same method you used to start it.
- `icon2.png` is Devo's browser and iOS home-screen icon; `tetris-icon.png` is the Tetris S-block home-screen and browser icon.
- There is no build step, package install, or separate HTML file. The page markup and CSS are in `server.js`.
- Node.js 18 or newer is required (the app uses the built-in `fetch` API).
- The app listens on port `3000` by default. Set `PORT` to change it.

The source page is `https://www.truthforlife.org/daily/?tab=alistair_begg_devotional`. If Truth For Life changes its page markup or blocks requests, the devotional parser may need an update.

## Run it manually

From the project directory:

```sh
cd /home/ubuntu/beeffiletserver
node server.js
```

Open `http://localhost:3000` on the server, or browse to the configured domain through nginx. Stop the foreground process with `Ctrl+C`.

To run it in the background temporarily:

```sh
cd /home/ubuntu/beeffiletserver
nohup node server.js > /tmp/devo.log 2>&1 &
```

This is suitable for a quick test, not as a reliable production process: it will not automatically restart after a reboot or crash. Use the systemd setup below for that.

## Keep it running with systemd

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

Check the location of Node with `command -v node`. If it is not `/usr/bin/node`, use the reported absolute path in `ExecStart`.

Install and start the service:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now beeffilet
sudo systemctl status beeffilet
```

After editing `server.js` or replacing the icon, restart and check it:

```sh
sudo systemctl restart beeffilet
sudo systemctl status beeffilet
sudo journalctl -u beeffilet -n 50 --no-pager
```

Follow live logs with:

```sh
sudo journalctl -u beeffilet -f
```

If the manually started app is already using port 3000, stop that process before starting the service. Check the listener with:

```sh
sudo ss -ltnp | grep ':3000'
```

Stop only the specific PID shown by that command, then start the service. Do not run a second copy on the same port.

## Nginx

Nginx should proxy the `devo.beeffilet.com` virtual host to the app on `127.0.0.1:3000`. Add a separate `server` block to the existing site file (on this server, `/etc/nginx/sites-available/beeffilet`); do not replace the other virtual hosts in that file:

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

Test before reloading nginx:

```sh
sudo nginx -t
sudo systemctl reload nginx
```

Check the virtual host locally, without depending on DNS:

```sh
curl -i -H 'Host: devo.beeffilet.com' http://127.0.0.1/
curl -I -H 'Host: devo.beeffilet.com' http://127.0.0.1/icon2.png
```

## DNS and HTTPS

In the DNS provider for `beeffilet.com`, create an `A` record named `devo` pointing to this server's current public IPv4 address. The address can change, so confirm it rather than relying on an old value. If using Cloudflare proxying, keep the setting consistent with the other working subdomains.

Check that DNS resolves:

```sh
dig +short devo.beeffilet.com
```

Once DNS points to this server and HTTP works, enable HTTPS. If this server uses Certbot, a typical command is:

```sh
sudo certbot --nginx -d devo.beeffilet.com
```

Follow Certbot's prompts and verify the HTTPS site afterward. When Cloudflare proxying is enabled, configure its SSL/TLS mode to match the certificate and origin setup.

## Updating the site

1. Edit `server.js` or `tetris.html`, or replace `icon2.png` (Devo) or `tetris-icon.png` (Tetris).
2. Restart the app (`sudo systemctl restart beeffilet` if using systemd) only when changing `server.js`.
3. Check the service logs if the Devo page does not load.
4. If you changed nginx configuration, run `sudo nginx -t` before reloading nginx.

The display options (text size, plus Paper, High Contrast White, and High Contrast Black appearance) are saved in the visitor's browser, not on the server.
