// Claudio PWA App
(function () {
  var cv = localStorage.getItem("claudio-theme") || "dark";
  var ws = null, isPlaying = false, progress = 0, audioEl = null;
  var waveformBars = [], topBars = [], sampleHeights = [];
  var BAR_COUNT = 75, TOP_BAR_COUNT = 45, kt = null;

  function q(s) { return document.querySelector(s); }
  function qa(s) { return document.querySelectorAll(s); }

  function init() { applyTheme(cv); initTop(); initWave(); initAudio(); initWS(); bindEvts(); }

  function applyTheme(t) {
    cv = t;
    document.body.classList.toggle("light", t === "light");
    var s = q("#themeSelect");
    if (s) s.value = t;
    localStorage.setItem("claudio-theme", t);
  }

  function switchView(n) {
    qa(".view").forEach(function (v) { v.classList.remove("active"); });
    var viewId = "#view" + n.charAt(0).toUpperCase() + n.slice(1);
    var t = q(viewId);
    if (t) t.classList.add("active");
    qa(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
    var btn = q('[data-tab="' + n + '"]');
    if (btn) btn.classList.add("active");
  }

  // 顶部破碎波形
  function initTop() {
    var c = q("#topViz");
    if (!c) return;
    c.innerHTML = ""; topBars = [];
    for (var i = 0; i < TOP_BAR_COUNT; i++) {
      var b = document.createElement("div"); b.className = "j-bar";
      c.appendChild(b); topBars.push(b);
    }
  }
  var ts = 0;
  function animTop() {
    ts += 0.04;
    topBars.forEach(function (b, i) {
      var h = 45 + Math.sin(i * 0.3 + ts) * 25 + Math.sin(i * 0.9 - ts * 2) * 20 + Math.random() * 15;
      b.style.height = Math.max(8, h) + "px";
    });
    requestAnimationFrame(animTop);
  }

  // 镜像波形进度条
  function initWave() {
    var c = q("#waveform");
    if (!c) return;
    c.innerHTML = ""; waveformBars = []; sampleHeights = [];
    for (var i = 0; i < BAR_COUNT; i++) {
      var h = Math.abs(Math.sin(i * 0.1) * 15 + Math.sin(i * 0.5) * 10 + Math.random() * 8);
      sampleHeights.push(Math.max(4, h));
    }
    for (var j = 0; j < BAR_COUNT; j++) {
      var b = document.createElement("div"); b.className = "wave-chunk";
      c.appendChild(b); waveformBars.push(b);
    }
    c.addEventListener("click", function (e) {
      var r = c.getBoundingClientRect();
      progress = (e.clientX - r.left) / r.width;
      if (audioEl && audioEl.duration) audioEl.currentTime = progress * audioEl.duration;
    });
  }
  function renderWf() {
    var t = Date.now() * 0.002;
    waveformBars.forEach(function (b, i) {
      var baseH = sampleHeights[i];
      var j = Math.sin(t + i * 0.2) * 2;
      b.style.height = (baseH + j) + "px";
      b.classList.toggle("played", i / BAR_COUNT < progress);
    });
    requestAnimationFrame(renderWf);
  }

  // 音频
  function initAudio() {
    audioEl = new Audio();
    audioEl.addEventListener("timeupdate", function () {
      if (audioEl.duration) progress = audioEl.currentTime / audioEl.duration;
      var td = q("#timeDisplay");
      if (td && audioEl.duration) {
        var m = Math.floor(audioEl.currentTime / 60);
        var s = Math.floor(audioEl.currentTime % 60);
        td.textContent = m + ":" + (s < 10 ? "0" : "") + s;
      }
    });
    audioEl.addEventListener("ended", function () { isPlaying = false; updBtn(); });
    audioEl.addEventListener("play", function () { isPlaying = true; updBtn(); });
    audioEl.addEventListener("pause", function () { isPlaying = false; updBtn(); });
  }

  function playTrack(url, title, artist) {
    if (!url) return;
    audioEl.src = url;
    audioEl.play().catch(function () {});
    var t = q("#songTitle"); if (t) t.textContent = title || "Claudio";
    var a = q("#songArtist"); if (a) a.textContent = artist || "";
    updBtn();
  }

  function updBtn() {
    var b = q("#btnPlayPause");
    if (!b) return;
    b.innerHTML = isPlaying
      ? '<div style="display:flex;gap:3px"><div style="width:3px;height:12px;background:#fff;border-radius:1px"></div><div style="width:3px;height:12px;background:#fff;border-radius:1px"></div></div>'
      : '<div class="play-icon"></div>';
  }

  // 歌词逐字高亮
  function karaoke(text) {
    var box = q("#lyricsBox");
    if (!box) return;
    if (!text) { box.innerHTML = '<div class="lyrics-placeholder">...</div>'; return; }
    box.innerHTML = text.split(" ").map(function (w) { return '<span class="word-node">' + w + '</span>'; }).join(" ");
    var nodes = qa(".word-node");
    if (!nodes.length) return;
    var idx = 0;
    if (kt) clearInterval(kt);
    kt = setInterval(function () {
      nodes.forEach(function (n) { n.classList.remove("active"); });
      if (idx < nodes.length) { nodes[idx].classList.add("active"); idx++; } else idx = 0;
    }, 300);
  }

  // WebSocket
  function initWS() {
    var p = location.protocol === "https:" ? "wss:" : "ws:";
    var url = p + "//" + location.host + "/stream";
    try {
      ws = new WebSocket(url);
      ws.onopen = function () { console.log("WS connected"); };
      ws.onmessage = function (e) {
        try { var m = JSON.parse(e.data); handleWS(m); } catch (ex) {}
      };
      ws.onclose = function () { setTimeout(initWS, 3000); };
      ws.onerror = function () {};
    } catch (e) {}
  }

  function handleWS(m) {
    if (m.type === "chat_reply" && m.say) {
      addChat("assistant", m.say);
      karaoke(m.say);
    } else if (m.type === "now_playing" && m.track) {
      var t = q("#songTitle"); if (t) t.textContent = m.track.song || "";
      var a = q("#songArtist"); if (a) a.textContent = m.track.artist || "";
    }
  }

  // 聊天
  function addChat(role, text) {
    var s = q("#chatStream");
    if (!s) return;
    var empty = s.querySelector(".chat-empty");
    if (empty) empty.remove();

    var msg = document.createElement("div");
    msg.className = "chat-msg " + role;

    var avatar = document.createElement("div");
    avatar.className = "chat-avatar";
    avatar.textContent = role === "user" ? "U" : "C";

    var bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    bubble.textContent = text;

    msg.appendChild(avatar);
    msg.appendChild(bubble);
    s.appendChild(msg);
    s.scrollTop = s.scrollHeight;
  }

  async function sendChat() {
    var input = q("#chatInput");
    if (!input) return;
    var msg = input.value.trim();
    if (!msg) return;
    addChat("user", msg);
    input.value = "";

    try {
      var r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg })
      });
      var d = await r.json();
      if (d.ok && d.data) {
        var x = d.data;
        if (x.say) { addChat("assistant", x.say); karaoke(x.say); }

        // 播放推荐的第一首歌
        if (x.play && x.play.length > 0) {
          try {
            var qs = x.play[0].song + " " + (x.play[0].artist || "");
            var sr = await fetch("/api/search?q=" + encodeURIComponent(qs));
            var sd = await sr.json();
            if (sd.ok && sd.data.length > 0) {
              var sr2 = await fetch("/api/song/" + sd.data[0].id);
              var sd2 = await sr2.json();
              if (sd2.ok && sd2.data.url && sd2.data.url.url) {
                playTrack(sd2.data.url.url, x.play[0].song, x.play[0].artist);
              }
            }
          } catch (ex) { console.warn("播放失败:", ex.message); }
        }
      }
    } catch (ex) {
      addChat("assistant", "网络连接失败，请检查服务器是否运行");
    }
  }

  function bindEvts() {
    qa(".tab-btn").forEach(function (b) {
      b.addEventListener("click", function () { switchView(b.dataset.tab); });
    });

    var pp = q("#btnPlayPause");
    if (pp) pp.addEventListener("click", function () {
      if (isPlaying) audioEl.pause();
      else audioEl.play().catch(function () {});
    });

    var cs = q("#chatSendBtn");
    if (cs) cs.addEventListener("click", sendChat);

    var ci = q("#chatInput");
    if (ci) ci.addEventListener("keydown", function (e) {
      if (e.key === "Enter") sendChat();
    });

    var ts = q("#themeSelect");
    if (ts) ts.addEventListener("change", function (e) { applyTheme(e.target.value); });

    var tts = q("#ttsToggle");
    if (tts) {
      var saved = localStorage.getItem("claudio-tts");
      if (saved !== null) tts.checked = saved === "true";
      tts.addEventListener("change", function (e) {
        localStorage.setItem("claudio-tts", e.target.checked);
      });
    }

    // 底部播放控制按钮
    qa(".nav-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.textContent === "⏮") {
          // 上一首（暂未实现队列）
        } else if (b.textContent === "⏭") {
          // 下一首
        }
      });
    });
  }

  init(); animTop(); renderWf();
})();
