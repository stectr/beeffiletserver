const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

async function unusedPort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startServer(directory, port) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: directory,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += chunk; });
  await Promise.race([
    once(child.stdout, "data"),
    once(child, "exit").then(([code]) => { throw new Error(`Server exited (${code}): ${errors}`); })
  ]);
  return child;
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  await exited;
}

test("leaderboard displays each player's best score while retaining every submission", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tetris-leaderboard-test-"));
  let child;
  t.after(async () => {
    if (child) await stopServer(child);
    await fs.rm(directory, { recursive: true, force: true });
  });
  const root = path.join(__dirname, "..");
  await Promise.all(["server.js", "icon2.png"].map((file) =>
    fs.copyFile(path.join(root, file), path.join(directory, file))));
  const file = path.join(directory, "tetris-leaderboard.json");
  const initial = [
    { name: "Player", score: 1000, lines: 1, level: 1, date: "2026-01-01T00:00:00.000Z" },
    { name: "player", score: 900, lines: 2, level: 1, date: "2026-01-02T00:00:00.000Z" },
    ...Array.from({ length: 12 }, (_, i) => ({
      name: `User ${i}`, score: 800 - i, lines: 1, level: 1, date: "2026-01-01T00:00:00.000Z"
    }))
  ];
  await fs.writeFile(file, JSON.stringify(initial));
  const port = await unusedPort();
  const url = `http://127.0.0.1:${port}/api/tetris/leaderboard`;
  child = await startServer(directory, port);

  let response = await fetch(url);
  let { entries } = await response.json();
  assert.equal(entries.length, 10);
  assert.deepEqual(entries.map((entry) => entry.name), ["Player", ...initial.slice(2, 11).map((entry) => entry.name)]);

  response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: " PLAYER ", score: 1100, lines: 3, level: 1 })
  });
  assert.equal(response.status, 201);
  ({ entries } = await response.json());
  assert.equal(entries[0].name, "PLAYER");
  assert.equal(entries[0].score, 1100);
  assert.equal(entries.length, 10);
  assert.equal(JSON.parse(await fs.readFile(file, "utf8")).length, initial.length + 1);

  response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "player", score: 10, lines: 0, level: 1 })
  });
  assert.equal(response.status, 201);
  ({ entries } = await response.json());
  assert.equal(entries[0].score, 1100);
  assert.equal(JSON.parse(await fs.readFile(file, "utf8")).length, initial.length + 2);

  await stopServer(child);
  child = await startServer(directory, port);
  response = await fetch(url);
  const afterRestart = await response.json();
  assert.deepEqual(afterRestart.entries, entries);
  assert.equal(JSON.parse(await fs.readFile(file, "utf8")).length, initial.length + 2);
});
