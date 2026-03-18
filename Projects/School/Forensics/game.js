(() => {
  "use strict";

  // -----------------------------
  // Tiny audio (no external assets)
  // -----------------------------
  const AudioFX = (() => {
    let enabled = true;
    let ctx = null;

    function ensure() {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      return ctx;
    }

    function beep({ freq = 440, dur = 0.06, type = "sine", gain = 0.04 } = {}) {
      if (!enabled) return;
      const ac = ensure();
      const t0 = ac.currentTime;

      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(g).connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    function success() {
      beep({ freq: 523.25, dur: 0.07, type: "triangle", gain: 0.05 });
      setTimeout(() => beep({ freq: 659.25, dur: 0.07, type: "triangle", gain: 0.05 }), 80);
      setTimeout(() => beep({ freq: 783.99, dur: 0.09, type: "triangle", gain: 0.05 }), 160);
    }

    function fail() {
      beep({ freq: 196, dur: 0.12, type: "sawtooth", gain: 0.03 });
      setTimeout(() => beep({ freq: 174.61, dur: 0.12, type: "sawtooth", gain: 0.03 }), 100);
    }

    function tick() {
      beep({ freq: 880, dur: 0.03, type: "square", gain: 0.02 });
    }

    function setEnabled(v) {
      enabled = !!v;
    }
    function getEnabled() {
      return enabled;
    }

    return { beep, success, fail, tick, setEnabled, getEnabled };
  })();

  // -----------------------------
  // DOM helpers
  // -----------------------------
  const $ = (sel) => document.querySelector(sel);
  const terminalEl = $("#terminal");
  const inputEl = $("#cmdInput");
  const cwdLabelEl = $("#cwdLabel");
  const objectiveTextEl = $("#objectiveText");
  const progressTextEl = $("#progressText");
  const traceFillEl = $("#traceFill");
  const tracePctEl = $("#tracePct");
  const statusPillEl = $("#statusPill");
  const hintBtn = $("#hintBtn");
  const soundBtn = $("#soundBtn");
  const toastEl = $("#toast");
  const overlayEl = $("#overlay");
  const resumeBtn = $("#resumeBtn");

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function nowISO() {
    const d = new Date();
    return d.toISOString();
  }

  // -----------------------------
  // Game content
  // -----------------------------
  // Mini-challenges (4) + final login:
  // 1) Read welcome message, learn about logs and "token"
  // 2) Log reading: grep for a tag; find ROT clue
  // 3) OSINT whois: find a base64 "case tag"
  // 4) Metadata analysis: cat a "png" which contains header lines
  // Final: combine pieces to get password; login <password>
  //
  // Password is generated per session to make it feel "unique".
  // It's still solvable via clues; no random unsignaled changes.

  const wordBank = [
    "noir", "cipher", "ember", "glitch", "neon", "sable", "trace", "vault",
    "signal", "shadow", "vector", "quartz", "nova", "mosaic", "orbit", "raven"
  ];

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function makeSessionPassword() {
    // Structure: <word>-<3 digits>-<word>
    const w1 = pick(wordBank);
    const w2 = pick(wordBank.filter(w => w !== w1));
    const digits = String(Math.floor(100 + Math.random() * 900));
    return `${w1}-${digits}-${w2}`;
  }

  const SESSION = {
    password: makeSessionPassword(),
    seedTag: null, // derived clue tag shown in logs
  };
  SESSION.seedTag = `CASE-${SESSION.password.split("-")[0].toUpperCase()}-${SESSION.password.split("-")[2].toUpperCase()}`;

  // Build clue pieces from password:
  // - Piece A (logs): ROT(13) of "word1"
  // - Piece B (whois): base64 of digits
  // - Piece C (metadata file): word2 in "X-META-LABEL: <word2>"
  //
  // They combine into final password: word1-digits-word2
  const passwordParts = (() => {
    const [w1, digits, w2] = SESSION.password.split("-");
    return { w1, digits, w2 };
  })();

  function rot13(s) {
    return s.replace(/[a-zA-Z]/g, (c) => {
      const base = c <= "Z" ? 65 : 97;
      const code = c.charCodeAt(0) - base;
      return String.fromCharCode(((code + 13) % 26) + base);
    });
  }

  function b64encode(s) {
    return btoa(unescape(encodeURIComponent(s)));
  }
  function b64decode(s) {
    return decodeURIComponent(escape(atob(s)));
  }

  const CLUES = {
    rotWord1: rot13(passwordParts.w1),
    b64Digits: b64encode(passwordParts.digits),
    metaWord2: passwordParts.w2,
  };

  // A small fake filesystem
  const FS = {
    "/": {
      type: "dir",
      entries: ["inbox", "logs", "osint", "lab", "vault"]
    },
    "/inbox": {
      type: "dir",
      entries: ["welcome.txt", "trainee_note.txt"]
    },
    "/logs": {
      type: "dir",
      entries: ["auth.log", "net.log", "training.log"]
    },
    "/osint": {
      type: "dir",
      entries: ["targets.txt"]
    },
    "/lab": {
      type: "dir",
      entries: ["evidence.png", "metadata.txt", "readme_lab.txt"]
    },
    "/vault": {
      type: "dir",
      entries: ["LOCKED.txt"]
    },

    "/inbox/welcome.txt": {
      type: "file",
      content:
`WELCOME, TRAINEE.
Scenario: "Operation Glass Lantern".
Your task: Access the training vault by discovering the password through evidence.

Training rule: no real hacking here — only reading clues.

Start here:
1) Check the logs for unusual tags.
2) Use safe OSINT (whois) on our dummy domain.
3) Inspect metadata in lab evidence.

Tip: Use 'help' for commands.
Hint system: type 'hint' at any time.

— Instructor M. Vale`
    },

    "/inbox/trainee_note.txt": {
      type: "file",
      content:
`Personal note (from another trainee):
If you see a CASE tag, search for it in /logs/net.log.
Sometimes the instructor hides a ROT shift clue in training.log.

Also: the final password format is:
<first-word>-<3 digits>-<second-word>

So you're looking for three pieces, not one guess.`
    },

    "/osint/targets.txt": {
      type: "file",
      content:
`OSINT TRAINING TARGETS
- nocturne-labs.test  (dummy training domain)
- training-gateway    (simulated network node)
- vault-door          (simulated service)
Note: This is a sandbox. Do not use these commands on real systems.`
    },

    "/logs/auth.log": {
      type: "file",
      content:
`[${nowISO()}] AUTH: Booted trainee console (sim).
[${nowISO()}] AUTH: Login attempts are rate-limited in the sim.
[${nowISO()}] AUTH: Instructor note: "A password is a story — follow the story."
[${nowISO()}] AUTH: Case tag assigned => ${SESSION.seedTag}`
    },

    "/logs/net.log": {
      type: "file",
      content:
`[${nowISO()}] NET: Link up -> node=training-gateway route=SIM/LOCAL
[${nowISO()}] NET: Packet banner: "forensics-first"
[${nowISO()}] NET: Tag observed: ${SESSION.seedTag}
[${nowISO()}] NET: Correlation hint: timestamps + tags + routes.
[${nowISO()}] NET: Trace algorithm watches for repeated scans.`
    },

    "/logs/training.log": {
      type: "file",
      content:
`[${nowISO()}] TRAIN: Lesson 02 — Reading logs:
  - 'grep' helps you find signals in noise.
  - timestamps matter; patterns repeat.

[${nowISO()}] TRAIN: Lesson 03 — Basic crypto (safe):
  - ROT is a simple letter shift (toy cipher).
  - Base64 is encoding, not encryption.

[${nowISO()}] TRAIN: Puzzle drop:
  ROT(13) => "${CLUES.rotWord1}"
  (Decode it to get the FIRST word.)`
    },

    "/lab/readme_lab.txt": {
      type: "file",
      content:
`LAB: Evidence Handling
You may inspect metadata and headers here.

Try:
- cat /lab/evidence.png
- cat /lab/metadata.txt

Hint: Some files start with human-readable header lines.`
    },

    "/lab/evidence.png": {
      type: "file",
      content:
`PNG
X-NOCTURNE-SIM: TRUE
X-META-AUTHOR: "M. Vale"
X-META-LABEL: "${CLUES.metaWord2}"
X-META-NOTE: "Second word lives in plain sight."

(binary data omitted...)`
    },

    "/lab/metadata.txt": {
      type: "file",
      content:
`Metadata checklist:
- creator
- timestamp
- label
- case tag

You already have a CASE tag. That can help tie evidence together.`
    },

    "/vault/LOCKED.txt": {
      type: "file",
      content:
`VAULT: LOCKED
Provide the password with: login <password>

Reminder: password format is <first-word>-<3 digits>-<second-word>`
    }
  };

  // Fake WHOIS database (domain -> record) includes base64 digits
  const WHOIS = {
    "nocturne-labs.test": {
      domain: "nocturne-labs.test",
      registrar: "Korbindev Domains Inc.",
      created: "2025-10-13",
      contact: "ops@nocturne-labs.test",
      note:
`Training record:
CaseTag: ${SESSION.seedTag}
DigitPack (b64): ${CLUES.b64Digits}
Hint: decode b64 to get the 3 digits.`
    }
  };

  // -----------------------------
  // Trace pressure mechanic
  // -----------------------------
  const TRACE = {
    value: 8,
    growthPerCommand: 2.4,
    slowUntil: 0, // timestamp ms
    checkpoint: 0, // stage index checkpoint
  };

  function traceGrowthMultiplier() {
    const t = Date.now();
    return t < TRACE.slowUntil ? 0.55 : 1.0;
  }

  function addTrace(amount, reason = "") {
    TRACE.value = clamp(TRACE.value + amount, 0, 100);
    updateTraceUI();
    if (reason) {
      // subtle tick to reinforce pressure
      if (TRACE.value >= 60) AudioFX.tick();
    }
    if (TRACE.value >= 100) seized();
  }

  function reduceTrace(amount, msg) {
    TRACE.value = clamp(TRACE.value - amount, 0, 100);
    updateTraceUI();
    toast(msg || `Trace reduced by ${amount}%`);
    AudioFX.success();
  }

  function updateTraceUI() {
    traceFillEl.style.width = `${TRACE.value}%`;
    tracePctEl.textContent = `${Math.round(TRACE.value)}%`;
    const pb = $(".traceBar");
    if (pb) pb.setAttribute("aria-valuenow", String(Math.round(TRACE.value)));

    if (TRACE.value < 45) {
      statusPillEl.textContent = "SIM: STABLE";
      statusPillEl.style.borderColor = "rgba(68,255,153,0.28)";
    } else if (TRACE.value < 80) {
      statusPillEl.textContent = "SIM: WATCHED";
      statusPillEl.style.borderColor = "rgba(255,211,90,0.35)";
    } else {
      statusPillEl.textContent = "SIM: HOT";
      statusPillEl.style.borderColor = "rgba(255,90,122,0.40)";
    }
  }

  function seized() {
    AudioFX.fail();
    overlayEl.classList.remove("hidden");
    inputEl.disabled = true;
  }

  function resumeFromCheckpoint() {
    overlayEl.classList.add("hidden");
    inputEl.disabled = false;
    inputEl.focus();
    // Reset trace, keep progress (checkpoint)
    TRACE.value = 12;
    updateTraceUI();
    // Re-print a short message
    printHr();
    printLine("SIM RECOVERY: Restored last checkpoint. Pattern-based correlation avoided this time.", "blue");
    printLine("Tip: Use defensive commands earlier if you spam scans.", "dim");
    printHr();
  }

  resumeBtn.addEventListener("click", resumeFromCheckpoint);

  // -----------------------------
  // Progress / objectives
  // -----------------------------
  const STAGES = [
    {
      id: "stage0",
      title: "Orientation",
      objective: "Read your welcome message: cat /inbox/welcome.txt",
      hint:
"Try: ls /inbox  then  cat /inbox/welcome.txt. You can also tap the “welcome” shortcut on the right.",
      onEnter() {}
    },
    {
      id: "stage1",
      title: "Log Reading",
      objective: "Find the CASE tag in logs, then locate the crypto clue.",
      hint:
"Try: cat /logs/auth.log to see a CASE tag, then grep that tag in /logs/net.log. Also read /logs/training.log for a ROT clue.",
      onEnter() {}
    },
    {
      id: "stage2",
      title: "OSINT (Safe WHOIS)",
      objective: "Use whois to find the base64 digits clue for the password.",
      hint:
"Try: whois nocturne-labs.test  then decode b64 <the_text> to reveal the 3 digits.",
      onEnter() {}
    },
    {
      id: "stage3",
      title: "Metadata Inspection",
      objective: "Inspect lab evidence metadata to find the second word.",
      hint:
"Try: cat /lab/evidence.png. Look for X-META-LABEL: ...",
      onEnter() {}
    },
    {
      id: "stage4",
      title: "Login",
      objective: "Assemble password: <first-word>-<3 digits>-<second-word> then: login <password>",
      hint:
"You need 3 pieces: first word from ROT, digits from base64 in whois, second word from evidence metadata. Then run login <password>.",
      onEnter() {}
    }
  ];

  const GAME = {
    stageIndex: 0,
    cwd: "/",
    history: [],
    historyIndex: -1,
    discovered: {
      firstWord: null,
      digits: null,
      secondWord: null,
      caseTagSeen: false
    },
    did: {
      readWelcome: false,
      readAuthLog: false,
      readTrainingLog: false,
      sawWhois: false,
      readEvidence: false
    },
    unlocked: {
      sanitize: false,
      decoy: false
    }
  };

  function setStage(idx, { checkpoint = false } = {}) {
    GAME.stageIndex = clamp(idx, 0, STAGES.length - 1);
    objectiveTextEl.textContent = STAGES[GAME.stageIndex].objective;
    progressTextEl.textContent = `${GAME.stageIndex}/${STAGES.length - 1} • ${STAGES[GAME.stageIndex].title}`;
    if (checkpoint) TRACE.checkpoint = GAME.stageIndex;
    STAGES[GAME.stageIndex].onEnter?.();
    celebrateObjective();
  }

  function celebrateObjective() {
    // light polish: small toast
    toast(`Objective updated: ${STAGES[GAME.stageIndex].title}`);
  }

  function maybeAdvance() {
    // Stage completion logic based on discovered bits.
    if (GAME.stageIndex === 0 && GAME.did.readWelcome) {
      setStage(1, { checkpoint: true });
      return;
    }

    if (GAME.stageIndex === 1) {
      // Need to have seen CASE tag AND decoded first word (or at least seen training log)
      if (GAME.discovered.caseTagSeen && GAME.discovered.firstWord) {
        // unlock one defensive tool as reward
        GAME.unlocked.sanitize = true;
        printLine("UNLOCKED: sanitize logs  (reduces trace a bit — defense)", "accent");
        AudioFX.success();
        setStage(2, { checkpoint: true });
        return;
      }
    }

    if (GAME.stageIndex === 2 && GAME.discovered.digits) {
      // unlock decoy packets
      GAME.unlocked.decoy = true;
      printLine("UNLOCKED: decoy packets  (reduces trace a bit — defense)", "accent");
      AudioFX.success();
      setStage(3, { checkpoint: true });
      return;
    }

    if (GAME.stageIndex === 3 && GAME.discovered.secondWord) {
      setStage(4, { checkpoint: true });
      return;
    }

    // stage4 advances on successful login
  }

  // -----------------------------
  // Terminal output (with light typing effect)
  // -----------------------------
  const UX = {
    typing: true,
    typingSpeed: 6 // chars per tick-ish
  };

  function scrollToBottom() {
    terminalEl.scrollTop = terminalEl.scrollHeight;
  }

  function makeLine(text, cls = "") {
    const div = document.createElement("div");
    div.className = `line ${cls}`.trim();
    div.textContent = text;
    return div;
  }

  function printLine(text, cls = "") {
    terminalEl.appendChild(makeLine(text, cls));
    scrollToBottom();
  }

  function printHr() {
    printLine("──────────────────────────────────────────────────────────────", "hr");
  }

  async function typeLines(lines, cls = "") {
    // Respect reduced motion
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (!UX.typing || reduce) {
      lines.forEach(l => printLine(l, cls));
      return;
    }

    for (const line of lines) {
      await typeLine(line, cls);
    }
  }

  function typeLine(text, cls = "") {
    return new Promise((resolve) => {
      const el = document.createElement("div");
      el.className = `line ${cls}`.trim();
      terminalEl.appendChild(el);

      let i = 0;
      const step = () => {
        i = Math.min(text.length, i + UX.typingSpeed);
        el.textContent = text.slice(0, i);
        scrollToBottom();
        if (i >= text.length) return resolve();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 1600);
  }

  // -----------------------------
  // Parsing helpers
  // -----------------------------
  function normalizeSpaces(s) {
    return s.trim().replace(/\s+/g, " ");
  }

  function isPath(s) {
    return s.startsWith("/");
  }

  function resolvePath(p) {
    if (!p) return GAME.cwd;
    if (p === ".") return GAME.cwd;
    if (p === "..") {
      if (GAME.cwd === "/") return "/";
      const parts = GAME.cwd.split("/").filter(Boolean);
      parts.pop();
      return "/" + parts.join("/");
    }
    if (p.startsWith("/")) return p;
    // relative
    if (GAME.cwd === "/") return `/${p}`;
    return `${GAME.cwd}/${p}`;
  }

  function exists(path) {
    return Object.prototype.hasOwnProperty.call(FS, path);
  }

  function isDir(path) {
    return exists(path) && FS[path].type === "dir";
  }

  function isFile(path) {
    return exists(path) && FS[path].type === "file";
  }

  function listDir(path) {
    if (!isDir(path)) return null;
    return FS[path].entries.slice();
  }

  function readFile(path) {
    if (!isFile(path)) return null;
    return FS[path].content;
  }

  // -----------------------------
  // Autocomplete
  // -----------------------------
  const COMMANDS = [
    "help","clear","ls","cat","grep","whois","decode","trace","scan","history","hint",
    "rotate proxy","sanitize logs","decoy packets","login"
  ];

  function getAllPaths() {
    return Object.keys(FS).sort();
  }

  function completeInput(raw) {
    const s = raw;
    const trimmedLeft = s.replace(/^\s+/, "");
    const parts = trimmedLeft.split(/\s+/);

    // If the user is typing a path as the last token, complete paths
    const last = parts[parts.length - 1] || "";
    const cmdCandidate = parts.slice(0, 1)[0] || "";

    const isCompletingPath = last.startsWith("/") || (parts.length >= 2 && (cmdCandidate.toLowerCase() === "cat" || cmdCandidate.toLowerCase() === "ls" || cmdCandidate.toLowerCase() === "grep"));

    if (isCompletingPath) {
      const prefix = last.startsWith("/") ? last : resolvePath(last);
      const matches = getAllPaths().filter(p => p.toLowerCase().startsWith(prefix.toLowerCase()));
      if (matches.length === 1) {
        // Replace last token
        parts[parts.length - 1] = matches[0];
        return parts.join(" ") + " ";
      }
      if (matches.length > 1) {
        printLine("Matches:", "dim");
        matches.slice(0, 14).forEach(m => printLine("  " + m, "dim"));
        if (matches.length > 14) printLine(`  ...and ${matches.length - 14} more`, "dim");
        return raw;
      }
      return raw;
    }

    // Otherwise complete commands (first token)
    const prefix = trimmedLeft.toLowerCase();
    const matches = COMMANDS.filter(c => c.startsWith(prefix));
    if (matches.length === 1) return matches[0] + " ";
    if (matches.length > 1) {
      printLine("Commands:", "dim");
      matches.forEach(m => printLine("  " + m, "dim"));
    }
    return raw;
  }

  // -----------------------------
  // Command implementations
  // -----------------------------
  function showHelp() {
    const lines = [
      "Available commands (training):",
      "  help",
      "  clear",
      "  ls [path]",
      "  cat <file>",
      "  grep <term> <file>",
      "  whois <domain>",
      "  decode <rot|b64> <text>",
      "  scan <target>",
      "  trace <tag>",
      "  rotate proxy",
      "  sanitize logs    (unlocks after Stage 1)",
      "  decoy packets    (unlocks after Stage 2)",
      "  history",
      "  hint",
      "  login <password>",
      "",
      "Examples:",
      "  ls /logs",
      "  cat /logs/training.log",
      "  grep CASE /logs/auth.log",
      "  whois nocturne-labs.test",
      "  decode rot " + CLUES.rotWord1,
      "  decode b64 " + CLUES.b64Digits
    ];
    return typeLines(lines, "dim");
  }

  function cmdClear() {
    terminalEl.innerHTML = "";
  }

  function cmdLs(arg) {
    const path = resolvePath(arg || GAME.cwd);
    if (!exists(path)) return printLine(`ls: cannot access '${path}': no such file or directory`, "danger");
    if (isFile(path)) return printLine(`ls: '${path}' is a file`, "warn");
    const entries = listDir(path);
    const pretty = entries.map(e => (FS[`${path === "/" ? "" : path}/${e}`]?.type === "dir" ? e + "/" : e));
    printLine(pretty.join("   "), "dim");
  }

  function cmdCat(arg) {
    if (!arg) return printLine("cat: missing file operand", "danger");
    const path = resolvePath(arg);
    if (!exists(path)) return printLine(`cat: ${path}: no such file`, "danger");
    if (isDir(path)) return printLine(`cat: ${path}: is a directory`, "warn");

    const content = readFile(path);
    if (content == null) return printLine("cat: read error", "danger");

    // Stage triggers:
    if (path === "/inbox/welcome.txt") GAME.did.readWelcome = true;
    if (path === "/logs/auth.log") GAME.did.readAuthLog = true;
    if (path === "/logs/training.log") GAME.did.readTrainingLog = true;
    if (path === "/lab/evidence.png") GAME.did.readEvidence = true;

    // Discover clues from content
    if (content.includes(SESSION.seedTag)) GAME.discovered.caseTagSeen = true;
    if (path === "/lab/evidence.png") {
      // second word is visible in metadata label line
      const m = content.match(/X-META-LABEL:\s*"(.*?)"/);
      if (m && m[1]) GAME.discovered.secondWord = m[1];
    }

    // Print content with typing effect
    const lines = content.split("\n");
    return typeLines(lines, "");
  }

  function cmdGrep(term, file) {
    if (!term || !file) return printLine("grep: usage: grep <term> <file>", "danger");
    const path = resolvePath(file);
    if (!exists(path) || isDir(path)) return printLine(`grep: ${path}: no such file`, "danger");

    const content = readFile(path);
    const lines = content.split("\n");
    const hits = [];
    lines.forEach((l, idx) => {
      if (l.toLowerCase().includes(term.toLowerCase())) hits.push({ idx: idx + 1, line: l });
    });

    if (hits.length === 0) {
      printLine(`grep: no matches for "${term}" in ${path}`, "warn");
      return;
    }

    hits.slice(0, 28).forEach(h => printLine(`${String(h.idx).padStart(3, " ")}: ${h.line}`, "dim"));
    if (hits.length > 28) printLine(`... ${hits.length - 28} more matches`, "dim");

    // Special discovery: if they grep ROT clue line, encourage decode
    if (path === "/logs/training.log" && term.toLowerCase().includes("rot")) {
      printLine("Tip: Use decode rot <text> to decode the FIRST word.", "blue");
    }
  }

  function cmdWhois(domain) {
    if (!domain) return printLine("whois: usage: whois <domain>", "danger");
    const key = domain.toLowerCase();
    const rec = WHOIS[key];
    if (!rec) {
      printLine(`whois: no record for '${domain}' in this training database`, "warn");
      printLine("Tip: Try whois nocturne-labs.test", "dim");
      return;
    }
    GAME.did.sawWhois = true;

    const lines = [
      `Domain Name: ${rec.domain}`,
      `Registrar: ${rec.registrar}`,
      `Created: ${rec.created}`,
      `Contact: ${rec.contact}`,
      "—",
      rec.note
    ];
    return typeLines(lines, "dim");
  }

  function cmdDecode(method, text) {
    if (!method || !text) return printLine("decode: usage: decode <rot|b64> <text>", "danger");
    const m = method.toLowerCase();
    const raw = text.trim();

    if (m === "rot" || m === "rot13") {
      const out = rot13(raw);
      printLine(`decode(rot13): ${out}`, "accent");
      // If this matches our first word clue, record it
      if (raw === CLUES.rotWord1 || out === passwordParts.w1) {
        GAME.discovered.firstWord = out.toLowerCase();
        printLine("✓ First word recorded.", "blue");
        AudioFX.success();
      } else {
        AudioFX.beep({ freq: 540, dur: 0.05, type: "triangle" });
      }
      return;
    }

    if (m === "b64" || m === "base64") {
      try {
        const out = b64decode(raw);
        printLine(`decode(base64): ${out}`, "accent");
        if (raw === CLUES.b64Digits || out === passwordParts.digits) {
          GAME.discovered.digits = out;
          printLine("✓ Digits recorded.", "blue");
          AudioFX.success();
        } else {
          AudioFX.beep({ freq: 540, dur: 0.05, type: "triangle" });
        }
      } catch (e) {
        printLine("decode(base64): invalid input (training expects clean base64 text).", "danger");
        AudioFX.fail();
      }
      return;
    }

    printLine(`decode: unknown method '${method}'. Try: decode rot ...  or  decode b64 ...`, "warn");
  }

  function cmdTrace(tag) {
    if (!tag) return printLine("trace: usage: trace <tag>", "danger");

    // Educational flavor: show a fake route and mention correlation.
    const t = tag.trim();
    const lines = [
      `TRACE starting for tag: ${t}`,
      "hop 1  trainee-console     10.1.0.12      (simulated)",
      "hop 2  training-gateway    10.1.0.1       (simulated)",
      "hop 3  nocturne-core       10.9.4.20      (simulated)",
      "hop 4  vault-door          10.9.4.99      (simulated)",
      "note: In real forensics, analysts correlate timestamps, routes, and identifiers.",
    ];
    typeLines(lines, "dim");
    addTrace(4.5 * traceGrowthMultiplier(), "trace");
  }

  function cmdScan(target) {
    if (!target) return printLine("scan: usage: scan <target>", "danger");

    // Increases trace more than other actions (spamming scan is noisy)
    const t = target.toLowerCase();
    const lines = [
      `SCAN: ${target}`,
      "Mode: training-safe enumeration (simulated)",
      "Result: open ports are redacted in training.",
      "Hint: scanning isn't always needed — try reading evidence and OSINT first.",
    ];
    typeLines(lines, "dim");

    if (t.includes("vault")) {
      printLine("Observation: the vault isn't about breaking in — it's about assembling the password story.", "blue");
    }
    addTrace(8.5 * traceGrowthMultiplier(), "scan");
  }

  function cmdRotateProxy() {
    // Slows trace growth for 30 seconds, small immediate reduction
    TRACE.slowUntil = Date.now() + 30000;
    reduceTrace(6, "Proxy rotated. Trace growth slowed briefly.");
  }

  function cmdSanitizeLogs() {
    if (!GAME.unlocked.sanitize) {
      printLine("sanitize logs: locked. Complete the Log Reading challenge first.", "warn");
      return;
    }
    reduceTrace(12, "Logs sanitized (training action). Trace reduced.");
  }

  function cmdDecoyPackets() {
    if (!GAME.unlocked.decoy) {
      printLine("decoy packets: locked. Complete the OSINT challenge first.", "warn");
      return;
    }
    reduceTrace(10, "Decoy packets deployed. Trace reduced.");
  }

  function cmdHistory() {
    if (GAME.history.length === 0) return printLine("(history is empty)", "dim");
    GAME.history.slice(-30).forEach((h, i) => printLine(`${String(Math.max(1, GAME.history.length - 30) + i).padStart(3, " ")}  ${h}`, "dim"));
  }

  function cmdHint() {
    printLine("HINT:", "warn");
    printLine(STAGES[GAME.stageIndex].hint, "dim");
    addTrace(1.0 * traceGrowthMultiplier(), "hint"); // small pressure: reading help takes time
  }

  function cmdLogin(pw) {
    if (!pw) return printLine("login: usage: login <password>", "danger");
    const attempt = pw.trim().toLowerCase();
    const real = SESSION.password.toLowerCase();

    if (GAME.stageIndex < 4) {
      printLine("login: you can try, but you haven't gathered all evidence yet.", "warn");
      addTrace(3.2 * traceGrowthMultiplier(), "login");
    }

    if (attempt === real) {
      AudioFX.success();
      printHr();
      printLine("ACCESS GRANTED ✅", "accent");
      printLine("Vault message:", "blue");
      printLine("“You didn’t ‘hack’ a system — you read the story in the data.”", "dim");
      printLine("Skills practiced: OSINT (whois), log reading (grep), metadata inspection, toy decoding.", "dim");
      printLine("Training complete. You may continue exploring with ls/cat/grep for fun.", "dim");
      printHr();
      // Freeze trace growth as a reward
      TRACE.value = 0;
      updateTraceUI();
      statusPillEl.textContent = "SIM: COMPLETE";
      statusPillEl.style.borderColor = "rgba(68,255,153,0.40)";
      setStage(4);
      objectiveTextEl.textContent = "Completed. Explore freely or refresh to replay with a new password.";
      return;
    }

    AudioFX.fail();
    printLine("ACCESS DENIED ❌", "danger");

    // Gentle helpful feedback:
    const parts = attempt.split("-");
    if (parts.length !== 3) {
      printLine("Hint: format is <first-word>-<3 digits>-<second-word>", "dim");
    } else {
      const [a,b,c] = parts;
      if (a !== passwordParts.w1.toLowerCase() && GAME.discovered.firstWord) {
        printLine("Your FIRST word doesn't match what you discovered.", "dim");
      }
      if (b !== passwordParts.digits && GAME.discovered.digits) {
        printLine("Your DIGITS don't match what you discovered.", "dim");
      }
      if (c !== passwordParts.w2.toLowerCase() && GAME.discovered.secondWord) {
        printLine("Your SECOND word doesn't match what you discovered.", "dim");
      }
    }

    addTrace(6.0 * traceGrowthMultiplier(), "login-fail");
  }

  // -----------------------------
  // Main parser
  // -----------------------------
  async function runCommand(raw) {
    const clean = normalizeSpaces(raw);
    if (!clean) return;

    GAME.history.push(clean);
    GAME.historyIndex = GAME.history.length;

    // echo input
    printLine(`$ ${clean}`, "dim");

    // Passive trace growth on every command
    addTrace(TRACE.growthPerCommand * traceGrowthMultiplier(), "cmd");

    const lower = clean.toLowerCase();

    // Multi-word commands (must be checked first)
    if (lower === "rotate proxy") return cmdRotateProxy();
    if (lower === "sanitize logs") return cmdSanitizeLogs();
    if (lower === "decoy packets") return cmdDecoyPackets();

    // Tokenize
    const [cmdRaw, ...rest] = clean.split(" ");
    const cmd = cmdRaw.toLowerCase();

    switch (cmd) {
      case "help": return showHelp();
      case "clear": return cmdClear();
      case "ls": return cmdLs(rest[0]);
      case "cat": return cmdCat(rest[0]);
      case "grep": return cmdGrep(rest[0], rest[1]);
      case "whois": return cmdWhois(rest[0]);
      case "decode": return cmdDecode(rest[0], rest.slice(1).join(" "));
      case "trace": return cmdTrace(rest.join(" "));
      case "scan": return cmdScan(rest.join(" "));
      case "history": return cmdHistory();
      case "hint": return cmdHint();
      case "login": return cmdLogin(rest.join(" "));
      default:
        AudioFX.fail();
        printLine(`Unknown command: '${cmdRaw}'. Type 'help' to see commands.`, "danger");
        // Helpful suggestion: if they typed a path by accident
        if (clean.startsWith("/")) printLine("Tip: To read a file, use: cat /path/to/file", "dim");
        return;
    }
  }

  // -----------------------------
  // Keyboard controls
  // -----------------------------
  inputEl.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      const v = inputEl.value;
      inputEl.value = "";
      await runCommand(v);
      maybeAdvance();
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      const next = completeInput(inputEl.value);
      inputEl.value = next;
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (GAME.history.length === 0) return;
      GAME.historyIndex = clamp(GAME.historyIndex - 1, 0, GAME.history.length - 1);
      inputEl.value = GAME.history[GAME.historyIndex] || "";
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (GAME.history.length === 0) return;
      GAME.historyIndex = clamp(GAME.historyIndex + 1, 0, GAME.history.length);
      inputEl.value = GAME.historyIndex === GAME.history.length ? "" : (GAME.history[GAME.historyIndex] || "");
      return;
    }
  });

  // Keep terminal focus friendly for keyboard-only users
  terminalEl.addEventListener("click", () => inputEl.focus());
  document.addEventListener("click", (e) => {
    // Don’t steal focus if they click buttons
    if (e.target.closest("button")) return;
    if (e.target.closest(".cmdInput")) return;
    if (overlayEl && !overlayEl.classList.contains("hidden")) return;
    inputEl.focus();
  });

  // Side shortcuts
  document.querySelectorAll("[data-run]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const cmd = btn.getAttribute("data-run");
      if (!cmd) return;
      inputEl.value = cmd;
      inputEl.focus();
    });
  });

  hintBtn.addEventListener("click", () => {
    runCommand("hint").then(() => maybeAdvance());
  });

  soundBtn.addEventListener("click", () => {
    const next = !AudioFX.getEnabled();
    AudioFX.setEnabled(next);
    soundBtn.textContent = `Sound: ${next ? "On" : "Off"}`;
    soundBtn.setAttribute("aria-pressed", next ? "true" : "false");
    toast(next ? "Sound enabled" : "Sound disabled");
    if (next) AudioFX.success();
  });

  // -----------------------------
  // Boot sequence
  // -----------------------------
  function boot() {
    updateTraceUI();
    setStage(0, { checkpoint: true });

    printHr();
    typeLines([
      "Hack Away",
      "Mode: Cyber Terminal",
      "Safety: fake targets only • beginner-friendly",
      "",
      "Your mission: discover the vault password through evidence.",
      "Type 'help' to see commands. Type 'hint' if you get stuck."
    ], "dim");
    printHr();
    printLine("Login prompt: vault-door is locked. Gather clues first.", "blue");
    printLine("Start: cat /inbox/welcome.txt", "accent");
    scrollToBottom();
    inputEl.focus();
  }

  // Extra: show cwd label (we keep it '/' for simplicity, but ready for expansion)
  cwdLabelEl.textContent = GAME.cwd;

  boot();

  // Expose nothing global (single-page, clean)
})();
