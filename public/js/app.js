// Claudio PWA App
(function () {
  var cv = localStorage.getItem("claudio-theme") || "dark";
  var ws = null, isPlaying = false, progress = 0, audioEl = null;
  var waveformBars = [], topBars = [], sampleHeights = [];
  var BAR_COUNT = 75, TOP_BAR_COUNT = 45, ktAnim = null;

  // 播放队列
  var playQueue = [], queueIndex = -1;
  var narrationActive = false, narrationExpected = false, narrationTimer = null;
  var karaokeAnimDone = true; // 当前播报动画是否已完成
  // 当前歌词行（LRC 解析结果）
  var lrcLines = [];
  // 队列视图是否可见
  var queueViewVisible = false;
  // 音频 Ducking
  var ttsAudio = null;
  // 防止 SSE 流和 WebSocket 重复显示
  var sseChatActive = false, lastSseDoneTime = 0;
  // 歌词手动滚动计时器（5 秒后才恢复自动滚动）
  var lastUserScroll = 0, userScrollTimer = null, userScrolling = false;

  function q(s) { return document.querySelector(s); }
  function qa(s) { return document.querySelectorAll(s); }

  // ==================== 点阵时钟 ====================
  // 5×7 点阵数字定义（列优先，从上到下 7 行，每行 5 位 bitmask）
  var DOT = [
    0b01110,0b10001,0b10011,0b10101,0b11001,0b10001,0b01110, // 0
    0b00100,0b01100,0b00100,0b00100,0b00100,0b00100,0b01110, // 1
    0b01110,0b10001,0b00001,0b00010,0b00100,0b01000,0b11111, // 2
    0b01110,0b10001,0b00001,0b00110,0b00001,0b10001,0b01110, // 3
    0b00010,0b00110,0b01010,0b10010,0b11111,0b00010,0b00010, // 4
    0b11111,0b10000,0b11110,0b00001,0b00001,0b10001,0b01110, // 5
    0b01110,0b10001,0b10000,0b11110,0b10001,0b10001,0b01110, // 6
    0b11111,0b00001,0b00010,0b00100,0b01000,0b01000,0b01000, // 7
    0b01110,0b10001,0b10001,0b01110,0b10001,0b10001,0b01110, // 8
    0b01110,0b10001,0b10001,0b01111,0b00001,0b10001,0b01110, // 9
  ];

  function initClock() {
    var box = q("#dotClock");
    if (!box) return;
    var canvas = document.createElement("canvas");
    canvas.width = 68; canvas.height = 20;
    canvas.style.display = "block";
    box.innerHTML = "";
    box.appendChild(canvas);
    drawClock(canvas);
    setInterval(function () { drawClock(canvas); }, 1000);
  }

  function drawClock(canvas) {
    var ctx = canvas.getContext("2d");
    var now = new Date();
    var h = now.getHours().toString().padStart(2, "0");
    var m = now.getMinutes().toString().padStart(2, "0");
    var str = h + ":" + m;
    var dotSize = 1.5, gap = 0.8, colW = dotSize * 5 + gap * 4, charW = colW + 2;
    var startX = 1, startY = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (var ci = 0; ci < str.length; ci++) {
      var ch = str[ci];
      if (ch === ":") {
        var cx = startX + ci * charW + colW / 2;
        ctx.fillStyle = "#aaa";
        ctx.fillRect(cx - 0.8, startY + 6, 1.6, 1.6);
        ctx.fillRect(cx - 0.8, startY + 13, 1.6, 1.6);
        continue;
      }
      var base = parseInt(ch) * 7;
      var x0 = startX + ci * charW;
      for (var row = 0; row < 7; row++) {
        for (var col = 0; col < 5; col++) {
          var bit = (DOT[base + row] >> (4 - col)) & 1;
          ctx.fillStyle = bit ? "#ddd" : "#2a2a2a";
          ctx.fillRect(x0 + col * (dotSize + gap), startY + row * (dotSize + gap), dotSize, dotSize);
        }
      }
    }
  }

  // ==================== 天气角标 ====================
  function fetchWeather() {
    var badge = q("#weatherBadge");
    fetch("/api/weather")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok && d.data) {
          var w = d.data;
          var icon = iconForWeather(w.icon || w.description);
          badge.textContent = icon + " " + (w.temp != null ? w.temp + "°" : "--°");
          badge.title = w.description + " | " + (w.feelsLike != null ? "体感 " + w.feelsLike + "°" : "") + " | " + w.city;
        }
      })
      .catch(function () {});
    // 每 15 分钟刷新
    setTimeout(fetchWeather, 15 * 60 * 1000);
  }

  function iconForWeather(code) {
    if (!code) return "🌤";
    if (code === "01d") return "☀";
    if (code === "01n") return "🌙";
    if (code.startsWith("02")) return "⛅";
    if (code.startsWith("03") || code.startsWith("04")) return "☁";
    if (code.startsWith("09") || code.startsWith("10")) return "🌧";
    if (code.startsWith("11")) return "⛈";
    if (code.startsWith("13")) return "❄";
    if (code.startsWith("50")) return "🌫";
    return "🌤";
  }

  // ==================== 歌词 LRC 解析 & 逐字高亮 ====================
  function parseLRC(lrcText) {
    if (!lrcText) return [];
    var lines = lrcText.split("\n");
    var result = [];
    for (var i = 0; i < lines.length; i++) {
      var match = lines[i].match(/^\[(\d{2}):(\d{2}\.\d{2,3})\](.*)$/);
      if (match) {
        var mins = parseInt(match[1]);
        var secs = parseFloat(match[2]);
        var text = match[3].trim();
        if (text) result.push({ time: mins * 60 + secs, text: text });
      }
    }
    return result.sort(function (a, b) { return a.time - b.time; });
  }

  function showReasonInLyrics(text) {
    if (!text) return;
    var box = q("#lyricsBox");
    if (!box) return;
    var chars = [];
    for (var i = 0; i < text.length; i++) {
      chars.push('<span class="word-node">' + escHtml(text[i]) + '</span>');
    }
    box.innerHTML = '<div class="reason-block" id="reasonBlock">' +
      '<div class="reason-label">Claudio 说</div>' +
      '<div class="reason-text">' + chars.join("") + '</div>' +
      '</div>';
    // 滑动高亮时长按文本量自适应，最少 3 秒
    karaokeAnim("#reasonBlock .word-node", Math.max(3000, text.length * 50));
  }

  function karaokeAnim(selector, duration) {
    var nodes = qa(selector);
    if (!nodes.length) return;
    var start = Date.now();
    function t() {
      var p = Math.min((Date.now() - start) / duration, 1);
      var idx = Math.floor(p * nodes.length);
      nodes.forEach(function (n) { n.classList.remove("active"); });
      if (idx < nodes.length && nodes[idx]) nodes[idx].classList.add("active");
      if (p < 1) requestAnimationFrame(t);
    }
    requestAnimationFrame(t);
  }

  function showLyrics(lrcText) {
    lrcLines = parseLRC(lrcText);
    var box = q("#lyricsBox");
    if (!box) return;
    // 保留已有的播报词（reason block）
    var reasonHtml = "";
    var reasonEl = q("#reasonBlock");
    if (reasonEl) reasonHtml = reasonEl.outerHTML;
    if (lrcLines.length === 0) {
      box.innerHTML = '<div class="lyrics-placeholder">纯音乐</div>';
      return;
    }
    box.innerHTML = reasonHtml + lrcLines.map(function (line, i) {
      // 逐词拆开，与 DJ 播报词保持一致的 KTV 高亮效果
      var words = splitWords(line.text);
      var spans = words.map(function (w, j) {
        return '<span class="word-node" data-line="' + i + '" data-word="' + j + '">' + escHtml(w) + '</span>';
      }).join("");
      return '<div class="lrc-line" data-idx="' + i + '">' + spans + '</div>';
    }).join("");
  }

  function splitWords(text) {
    // 逐字拆分：中文每字独立，英文单词保持完整，标点单独
    var result = [];
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (/[一-鿿]/.test(ch)) {
        result.push(ch);
      } else if (/[a-zA-Z0-9]/.test(ch)) {
        if (i > 0 && /[a-zA-Z0-9]/.test(text[i - 1])) {
          result[result.length - 1] += ch;
        } else {
          result.push(ch);
        }
      } else if (!/\s/.test(ch)) {
        result.push(ch);
      }
    }
    return result;
  }

  function updateLyricsHighlight(currentTime) {
    if (!lrcLines.length) return;
    var active = -1;
    for (var i = 0; i < lrcLines.length; i++) {
      if (currentTime >= lrcLines[i].time) active = i;
      else break;
    }
    if (active < 0) return;

    // 计算在当前行内的进度比例
    var lineStart = lrcLines[active].time;
    var lineEnd = (active + 1 < lrcLines.length) ? lrcLines[active + 1].time : lineStart + 5;
    var lineDuration = Math.max(lineEnd - lineStart, 1);
    var progressInLine = Math.min((currentTime - lineStart) / lineDuration, 1);

    // 高亮当前行
    var allLines = qa(".lrc-line");
    allLines.forEach(function (el) {
      var idx = parseInt(el.dataset.idx);
      el.classList.toggle("active", idx === active);
    });

    // 滑动窗口逐词高亮：先清除所有旧高亮，再只亮当前一个字
    qa(".word-node.active").forEach(function (w) { w.classList.remove("active"); });
    var words = qa('.lrc-line[data-idx="' + active + '"] .word-node');
    var totalWords = words.length;
    var highlightIdx = Math.floor(progressInLine * totalWords);
    if (highlightIdx < totalWords && words[highlightIdx]) {
      words[highlightIdx].classList.add("active");
    }

    // 用户手动滚动时暂停自动跳转，5 秒无滚动后恢复
    if (allLines[active] && !userScrolling) {
      allLines[active].scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function karaokeDJ(text) {
    lrcLines = [];
    // 逐字拆分：中文每字独立，英文单词保持完整
    var chars = [];
    for (var ci2 = 0; ci2 < text.length; ci2++) {
      var ch = text[ci2];
      if (/[一-鿿]/.test(ch)) {
        chars.push(ch);
      } else if (/[a-zA-Z0-9]/.test(ch)) {
        if (ci2 > 0 && /[a-zA-Z0-9]/.test(text[ci2 - 1])) {
          chars[chars.length - 1] += ch;
        } else {
          chars.push(ch);
        }
      } else if (/\s/.test(ch)) {
        chars.push(" ");
      } else {
        chars.push(ch);
      }
    }
    if (!chars.length) {
      box.innerHTML = '<div class="lyrics-placeholder">' + escHtml(text) + '</div>';
      return;
    }
    box.innerHTML = chars.map(function (w, i) {
      if (w === " " || w === "\n") return " ";
      return '<span class="word-node" data-idx="' + i + '">' + escHtml(w) + '</span>';
    }).join("");

    var validChars = chars.filter(function (c) { return c !== " " && c !== "\n"; });
    var duration = Math.max(4000, validChars.length * 250);
    var startTime = Date.now();
    if (ktAnim) cancelAnimationFrame(ktAnim);
    karaokeAnimDone = false;

    function tick() {
      var elapsed = Date.now() - startTime;
      var p = Math.min(elapsed / duration, 1);
      var idx = Math.floor(p * chars.length);
      var nodes = qa("#lyricsBox .word-node");
      nodes.forEach(function (n) { n.classList.remove("active"); });
      if (idx < nodes.length && nodes[idx]) {
        nodes[idx].classList.add("active");
      }
      if (p < 1) { ktAnim = requestAnimationFrame(tick); }
      else { karaokeAnimDone = true; tryFinishNarration(); }
    }
    ktAnim = requestAnimationFrame(tick);
  }

  function escHtml(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // ==================== 音频 + 队列 ====================
  function initAudio() {
    audioEl = new Audio();
    audioEl.addEventListener("timeupdate", function () {
      if (audioEl.duration) progress = audioEl.currentTime / audioEl.duration;
      // 播报词期间：用 intro 间奏循环做背景音，不让歌曲完整播放
      if ((narrationActive || narrationExpected) && audioEl.currentTime > 25) {
        audioEl.currentTime = 0;
      }
      var td = q("#timeDisplay");
      if (td && audioEl.duration) {
        var cm = Math.floor(audioEl.currentTime / 60);
        var cs = Math.floor(audioEl.currentTime % 60);
        var dm = Math.floor(audioEl.duration / 60);
        var ds = Math.floor(audioEl.duration % 60);
        td.textContent = cm + ":" + (cs < 10 ? "0" : "") + cs + " / " + dm + ":" + (ds < 10 ? "0" : "") + ds;
      }
      // 驱动歌词高亮
      updateLyricsHighlight(audioEl.currentTime);
    });
    audioEl.addEventListener("ended", function () {
      isPlaying = false; updBtn();
      playNext();
    });
    audioEl.addEventListener("play", function () { isPlaying = true; updBtn(); });
    audioEl.addEventListener("pause", function () { isPlaying = false; updBtn(); });
  }

  function playTrack(url, title, artist, songId) {
    if (!url) return;
    audioEl.src = url;
    // 如果正等待播报词，以低音量间奏 BGM 启动
    audioEl.volume = (narrationExpected || narrationActive) ? 0.2 : 1.0;
    audioEl.play().then(function () {
      console.log("播放开始:", title, artist);
      var pp = q("#btnPlayPause");
      if (pp) pp.style.animation = "";
    }).catch(function (e) {
      console.warn("自动播放被浏览器阻止，点击播放按钮开始:", e.message);
      // 闪烁播放按钮提示用户点击
      var pp = q("#btnPlayPause");
      if (pp) pp.style.animation = "pulse 0.8s infinite";
    });
    updBtn();

    // 尝试加载歌词
    if (songId) {
      fetch("/api/song/" + songId)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.ok && d.data && d.data.lyric && d.data.lyric.lyric) {
            showLyrics(d.data.lyric.lyric);
          } else {
            lrcLines = [];
          }
        })
        .catch(function () { lrcLines = []; });
    } else {
      lrcLines = [];
    }
  }

  function clearNarration() {
    narrationExpected = false;
    narrationActive = false;
    karaokeAnimDone = true;
    clearTimeout(narrationTimer);
    if (audioEl && audioEl.src) audioEl.volume = 1.0;
  }

  function playNext() {
    clearNarration();
    if (playQueue.length === 0) return;
    var nextIdx = queueIndex + 1;
    if (nextIdx >= playQueue.length) nextIdx = 0;
    playFromQueue(nextIdx);
  }

  function playPrev() {
    clearNarration();
    if (playQueue.length === 0) return;
    var prevIdx = queueIndex - 1;
    if (prevIdx < 0) prevIdx = playQueue.length - 1;
    playFromQueue(prevIdx);
  }

  function playFromQueue(idx) {
    var song = playQueue[idx];
    if (!song) return;
    queueIndex = idx;
    renderQueue();
    var st3 = q("#songTitle"); if (st3) st3.textContent = (song.song || "?") + " - " + (song.artist || "");
    // 在歌词区域显示这首歌的推荐理由（如 AI 播报词）
    if (song.reason) {
      showReasonInLyrics(song.reason);
    }
    // 如果已经解析过 URL
    if (song._url) {
      playTrack(song._url, song.song, song.artist, song._id);
      return;
    }
    // 搜索并播放
    var qs = song.song + " " + (song.artist || "");
    fetch("/api/search?q=" + encodeURIComponent(qs))
      .then(function (r) { return r.json(); })
      .then(function (sd) {
        if (sd.ok && sd.data.length > 0) {
          song._id = sd.data[0].id;
          return fetch("/api/song/" + sd.data[0].id);
        }
        throw new Error("not found");
      })
      .then(function (sr2) { return sr2.json(); })
      .then(function (sd2) {
        if (sd2.ok && sd2.data.url && sd2.data.url.url) {
          song._url = sd2.data.url.url;
          playTrack(song._url, song.song, song.artist, song._id);
        }
      })
      .catch(function (ex) {
        console.warn("队列播放失败:", ex.message);
      });
  }

  function setQueue(songs) {
    // 新推荐的歌插到队列最前面（LRU 策略），总是立即播放第一首
    if (!songs || !songs.length) return;
    playQueue = songs.concat(playQueue);
    // 标记等待播报词：playTrack 会以低音量 BGM 模式启动
    narrationExpected = true;
    clearTimeout(narrationTimer);
    narrationTimer = setTimeout(function () {
      // TTS 超时未到，放弃等待，直接恢复歌曲
      if (narrationExpected) {
        narrationExpected = false;
        tryFinishNarration();
      }
    }, 15000);
    playFromQueue(0);
  }

  function renderQueue() {
    var container = q("#queueItems");
    var countEl = q("#queueCount");
    if (!container) return;
    if (countEl) countEl.textContent = playQueue.length + " 首";

    if (playQueue.length === 0) {
      container.innerHTML = '<div class="queue-empty">队列为空，和 Claudio 聊聊让他推荐音乐吧</div>';
      return;
    }

    container.innerHTML = playQueue.map(function (song, i) {
      var isPlaying = (i === queueIndex);
      var idxHtml = isPlaying
        ? '<div class="queue-now-indicator"></div>'
        : '<span class="queue-song-idx">' + (i + 1) + '</span>';
      var cls = "queue-song" + (isPlaying ? " playing" : "");
      return '<div class="' + cls + '" data-qi="' + i + '">' +
        idxHtml +
        '<div class="queue-song-info">' +
          '<div class="queue-song-title">' + escHtml(song.song || "未知") + '</div>' +
          '<div class="queue-song-artist">' + escHtml(song.artist || "") + '</div>' +
          (song.reason ? '<div class="queue-song-reason">' + escHtml(song.reason) + '</div>' : '') +
        '</div>' +
      '</div>';
    }).join("");

    // 绑定歌点击事件
    qa(".queue-song").forEach(function (el) {
      el.addEventListener("click", function () {
        var qi = parseInt(this.dataset.qi);
        if (!isNaN(qi) && qi !== queueIndex) {
          clearNarration();
          playFromQueue(qi);
        }
      });
    });

    // 绑定播报词展开/折叠（阻止冒泡防止触发切歌）
    qa(".queue-song-reason").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.stopPropagation();
        this.classList.toggle("expanded");
      });
    });
  }

  function toggleQueueView() {
    var lyricsEl = q("#lyricsBox");
    var queueEl = q("#queueList");
    var listBtn = q("#listBtn");
    if (!lyricsEl || !queueEl) return;
    queueViewVisible = !queueViewVisible;
    lyricsEl.style.display = queueViewVisible ? "none" : "";
    queueEl.style.display = queueViewVisible ? "" : "none";
    if (listBtn) listBtn.classList.toggle("active", queueViewVisible);
    if (queueViewVisible) renderQueue();
  }

  function updBtn() {
    var b = q("#btnPlayPause");
    if (!b) return;
    b.innerHTML = isPlaying
      ? '<div style="display:flex;gap:3px"><div style="width:3px;height:12px;background:#fff;border-radius:1px"></div><div style="width:3px;height:12px;background:#fff;border-radius:1px"></div></div>'
      : '<div class="play-icon"></div>';
  }

  // ==================== 音频 Ducking（播报词期间压低音乐作间奏 BGM） ====================
  function initAudioDucking() {
    ttsAudio = new Audio();
    ttsAudio.addEventListener("play", function () {
      narrationActive = true;
      duckMusic(0.2);
    });
    ttsAudio.addEventListener("ended", function () {
      narrationActive = false;
      restartSongFromZero();
    });
    ttsAudio.addEventListener("pause", function () {
      narrationActive = false;
      restartSongFromZero();
    });
  }

  function tryFinishNarration() {
    // 播报动画完成 且 TTS 不在播放 且 不再等待 TTS 到达 → 歌曲从头开始
    if (karaokeAnimDone && !narrationActive && !narrationExpected) {
      if (audioEl && audioEl.src) {
        audioEl.currentTime = 0;
        audioEl.volume = 1.0;
      }
    }
  }

  function restartSongFromZero() {
    // TTS 结束后不直接切歌，等 tryFinishNarration 统一判断
    tryFinishNarration();
  }

  function duckMusic(level) {
    audioEl.volume = level;
  }

  function rampMusicUp() {
    // 保留：用于非播报场景的淡入
    var startVol = audioEl.volume;
    var start = Date.now();
    var dur = 1500;
    function step() {
      var p = Math.min((Date.now() - start) / dur, 1);
      audioEl.volume = startVol + (1 - startVol) * p;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function playNarration(url) {
    if (!ttsAudio) return;
    var enabled = localStorage.getItem("claudio-tts");
    if (enabled === "false") return;
    narrationActive = true;
    narrationExpected = false;
    clearTimeout(narrationTimer);
    ttsAudio.src = url;
    ttsAudio.play().catch(function () {});
  }

  // ==================== 顶部破碎波形 ====================
  function initTop() {
    var c = q("#topViz");
    if (!c) return;
    c.innerHTML = ""; topBars = [];
    // 根据容器宽度动态计算条数，铺满屏幕
    var barW = 2, barGap = 2;
    var count = Math.floor(c.offsetWidth / (barW + barGap));
    for (var i = 0; i < count; i++) {
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

  // ==================== 镜像波形进度条 ====================
  var waveThumb = null;
  function initWave() {
    var c = q("#waveform");
    if (!c) return;
    c.innerHTML = ""; waveformBars = []; sampleHeights = [];
    // 重建拖拽指示点
    waveThumb = document.createElement("div"); waveThumb.className = "wave-thumb"; waveThumb.id = "waveThumb";
    c.appendChild(waveThumb);
    for (var i = 0; i < BAR_COUNT; i++) {
      var h = Math.abs(Math.sin(i * 0.1) * 15 + Math.sin(i * 0.5) * 10 + Math.random() * 8);
      sampleHeights.push(Math.max(4, h));
    }
    for (var j = 0; j < BAR_COUNT; j++) {
      var b = document.createElement("div"); b.className = "wave-chunk";
      c.appendChild(b); waveformBars.push(b);
    }
    var dragging = false;
    c.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      dragging = true;
      var r = c.getBoundingClientRect();
      var ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      if (audioEl && audioEl.duration && !isNaN(audioEl.duration) && isFinite(audioEl.duration)) {
        audioEl.currentTime = ratio * audioEl.duration;
        progress = ratio;
        if (waveThumb) waveThumb.style.left = (progress * 100) + "%";
      }
    });
    c.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      e.preventDefault();
      var r = c.getBoundingClientRect();
      var ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      if (audioEl && audioEl.duration && !isNaN(audioEl.duration) && isFinite(audioEl.duration)) {
        audioEl.currentTime = ratio * audioEl.duration;
        progress = ratio;
        if (waveThumb) waveThumb.style.left = (progress * 100) + "%";
      }
    });
    var endDrag = function (e) {
      dragging = false;
      try { c.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    c.addEventListener("pointerup", endDrag);
    c.addEventListener("pointercancel", endDrag);
    c.addEventListener("pointerleave", endDrag);
  }
  function renderWf() {
    var t = Date.now() * 0.002;
    waveformBars.forEach(function (b, i) {
      var baseH = sampleHeights[i];
      var j = Math.sin(t + i * 0.2) * 2;
      b.style.height = (baseH + j) + "px";
      b.classList.toggle("played", i / BAR_COUNT < progress);
    });
    if (waveThumb) waveThumb.style.left = (progress * 100) + "%";
    requestAnimationFrame(renderWf);
  }

  // ==================== WebSocket ====================
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
    if (m.type === "chat_reply" && m.reply) {
      // SSE 流活跃中，或刚刚结束（2 秒内），跳过以防止重复
      if (sseChatActive || Date.now() - lastSseDoneTime < 2000) return;
      addChat("assistant", m.reply.say || "");
      karaokeDJ(m.reply.say || "");
    } else if (m.type === "tts_ready" && m.url) {
      playNarration(m.url);
    } else if (m.type === "now_playing" && m.track) {
      var t = q("#songTitle"); if (t) t.textContent = m.track.song || "";
      var a = q("#songArtist"); if (a) a.textContent = m.track.artist || "";
    }
  }

  // ==================== 聊天 ====================
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
    sseChatActive = true;  // 标记 SSE 流进行中，防止 WS 重复

    // 解锁音频自动播放（利用用户点击手势）
    audioEl.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
    audioEl.play().then(function () {
      audioEl.pause();
      audioEl.currentTime = 0;
      audioEl.src = "";
    }).catch(function () {});

    // 创建一个空的助手气泡用于流式填充
    var bubble = createStreamBubble();

    try {
      var r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg })
      });

      var reader = r.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";
      var fullSay = "";

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (var li = 0; li < lines.length; li++) {
          var line = lines[li].trim();
          if (!line.startsWith("data:")) continue;
          var jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;

          try {
            var evt = JSON.parse(jsonStr);
            if (evt.c) {
              fullSay += evt.c;
              bubble.textContent = fullSay;
              // 滚动聊天流
              var stream = q("#chatStream");
              if (stream) stream.scrollTop = stream.scrollHeight;
            }
            if (evt.done) {
              // 全部歌曲加入队列，自动播放第一首
              if (evt.play && evt.play.length > 0) {
                setQueue(evt.play);
              }
              try { karaokeDJ(evt.say || fullSay); } catch (e) {}
              sseChatActive = false;
              lastSseDoneTime = Date.now();
            }
          } catch (e) { /* 跳过格式错误的行 */ }
        }
      }
    } catch (ex) {
      sseChatActive = false;
      lastSseDoneTime = Date.now();
      if (bubble.textContent === "...") {
        bubble.textContent = "网络连接失败，请检查服务器是否运行";
      }
    }
  }

  function createStreamBubble() {
    var s = q("#chatStream");
    if (!s) return { textContent: "" }; // fallback
    var empty = s.querySelector(".chat-empty");
    if (empty) empty.remove();

    var msg = document.createElement("div");
    msg.className = "chat-msg assistant";

    var avatar = document.createElement("div");
    avatar.className = "chat-avatar";
    avatar.textContent = "C";

    var bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    bubble.textContent = "...";

    msg.appendChild(avatar);
    msg.appendChild(bubble);
    s.appendChild(msg);
    s.scrollTop = s.scrollHeight;
    return bubble;
  }

  // ==================== 事件绑定 ====================
  function bindEvts() {
    qa(".tab-btn").forEach(function (b) {
      b.addEventListener("click", function () { switchView(b.dataset.tab); });
    });

    var pp = q("#btnPlayPause");
    if (pp) pp.addEventListener("click", function () {
      if (isPlaying) { audioEl.pause(); return; }
      // 如果有 src 就直接播，否则从队列找
      if (audioEl.src && audioEl.src !== window.location.href && audioEl.src !== "") {
        audioEl.play().catch(function () {});
      } else if (playQueue.length > 0) {
        playNext();
      }
    });

    var cs = q("#chatSendBtn");
    if (cs) cs.addEventListener("click", sendChat);

    var ci = q("#chatInput");
    if (ci) ci.addEventListener("keydown", function (e) {
      if (e.key === "Enter") sendChat();
    });

    var ts2 = q("#themeSelect");
    if (ts2) ts2.addEventListener("change", function (e) { applyTheme(e.target.value); });

    var tts = q("#ttsToggle");
    if (tts) {
      var saved = localStorage.getItem("claudio-tts");
      if (saved !== null) tts.checked = saved === "true";
      tts.addEventListener("change", function (e) {
        localStorage.setItem("claudio-tts", e.target.checked);
      });
    }

    // 播放器导航按钮
    var prevBtn = q(".nav-btn:nth-child(1)");
    var nextBtn = q(".nav-btn:nth-child(3)");
    var listBtn = q("#listBtn");
    if (prevBtn) prevBtn.addEventListener("click", playPrev);
    if (nextBtn) nextBtn.addEventListener("click", playNext);
    if (listBtn) listBtn.addEventListener("click", toggleQueueView);

    // 点击歌曲标题区：如果在队列视图则返回歌词
    var titleGroup = q(".song-title-group");
    if (titleGroup) titleGroup.addEventListener("click", function () {
      if (queueViewVisible) toggleQueueView();
    });
  }

  // ==================== 主题 & 视图 ====================
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
    moveTabIndicator(btn);
  }

  function moveTabIndicator(btn) {
    var indicator = q("#tabIndicator");
    if (!indicator || !btn) return;
    var bar = btn.parentElement;
    var barRect = bar.getBoundingClientRect();
    var btnRect = btn.getBoundingClientRect();
    var cx = btnRect.left - barRect.left + btnRect.width / 2;
    indicator.style.transform = "translateX(" + (cx - indicator.offsetWidth / 2) + "px)";
  }

  // ==================== 状态恢复 ====================
  function loadHistory() {
    fetch("/api/history")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) return;

        // 恢复聊天记录
        var msgs = d.data.messages || [];
        for (var i = 0; i < msgs.length; i++) {
          var m = msgs[i];
          // 跳过 system 角色
          if (m.role === "system") continue;
          addChat(m.role, m.content);
        }

        // 恢复播放队列（最近播放作为队列）
        var plays = d.data.plays || [];
        if (plays.length > 0) {
          for (var j = 0; j < plays.length; j++) {
            var p = plays[j];
            var ctx = {};
            try { ctx = typeof p.context === "string" ? JSON.parse(p.context) : (p.context || {}); } catch (_) {}
            playQueue.push({
              song: p.song_name,
              artist: p.artist || "",
              song_id: p.song_id || "",
              reason: ctx.reason || "",
            });
          }
          renderQueue();
        }
      })
      .catch(function () {});
  }

  function init() {
    applyTheme(cv);
    initClock();
    fetchWeather();
    initTop();
    initWave();
    initAudio();
    initAudioDucking();
    initWS();
    bindEvts();
    loadHistory();
    // 初始化底部 tab 指示滑块
    requestAnimationFrame(function () { moveTabIndicator(q(".tab-btn.active")); });
    window.addEventListener("resize", function () { moveTabIndicator(q(".tab-btn.active")); });

    // 歌词区手动滚动：防抖 5 秒后才恢复自动跳转
    var lyricsBox = q("#lyricsBox");
    if (lyricsBox) {
      lyricsBox.addEventListener("scroll", function () {
        userScrolling = true;
        clearTimeout(userScrollTimer);
        userScrollTimer = setTimeout(function () {
          userScrolling = false;
          lastUserScroll = Date.now();
        }, 5000);
      }, { passive: true });
    }
  }

  init(); animTop(); renderWf();
})();
