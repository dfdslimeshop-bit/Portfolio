/* ==========================================================================
   VESPER — app.js
   Wires the game engine to the site UI: persistence, HUD, achievements,
   daily challenge, settings, modals, toasts, and PWA bits.
   ========================================================================== */
(function(){
  'use strict';

  const SAVE_KEY = 'vesper_save_v1';

  const ACHIEVEMENTS = [
    { id:'first_flight', name:'First Flight', desc:'Complete your first run', icon:'🕊️', check: s => s.totalRuns >= 1 },
    { id:'century', name:'Century', desc:'Score 100 in a single run', icon:'💯', check: s => s.lastRun.score >= 100 },
    { id:'high_flyer', name:'High Flyer', desc:'Score 500 in a single run', icon:'🚀', check: s => s.lastRun.score >= 500 },
    { id:'ace', name:'Void Ace', desc:'Score 1500 in a single run', icon:'🏆', check: s => s.lastRun.score >= 1500 },
    { id:'collector', name:'Shard Collector', desc:'Collect 200 shards total', icon:'💎', check: s => s.totalCoins >= 200 },
    { id:'combo5', name:'Combo Master', desc:'Reach a ×5 combo in a run', icon:'🔥', check: s => s.lastRun.combo >= 5 },
    { id:'untouchable', name:'Untouchable', desc:'Survive a hit using a shield', icon:'🛡️', check: s => s.shieldSaves >= 1 },
    { id:'dedicated', name:'Dedicated Pilot', desc:'Play 25 runs', icon:'⭐', check: s => s.totalRuns >= 25 },
  ];

  const DAILY_TEMPLATES = [
    { kind:'score', label: t => `Score at least ${t} in a single run.`, targets:[150,250,400,600] },
    { kind:'coins', label: t => `Collect ${t} shards in a single run.`, targets:[15,25,35,50] },
    { kind:'survive', label: t => `Survive ${t} seconds in a single run.`, targets:[20,35,50,70] },
  ];

  const SKIN_UNLOCKS = [
    { level:1, skin:'aurora', name:'Aurora' },
    { level:3, skin:'ember', name:'Ember' },
    { level:5, skin:'gold', name:'Gold Rush' },
    { level:8, skin:'violet', name:'Violet Drift' },
  ];

  function defaultSave(){
    return {
      bestScore:0, totalRuns:0, totalCoins:0, xp:0, level:1,
      unlockedSkins:['aurora'], equippedSkin:'aurora',
      achievements:{}, shieldSaves:0,
      scores:[], // {score, coins, combo, date}
      dailyDate:null, dailyTarget:null, dailyCompleted:false, dailyProgress:0,
      settings:{ theme:'dark', quality:'high', volume:70, muted:false, vibrate:true, fps:false },
      lastRun:{ score:0, coins:0, combo:1, duration:0 },
      secretUnlocked:false
    };
  }

  function loadSave(){
    try{
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return defaultSave();
      const parsed = JSON.parse(raw);
      return Object.assign(defaultSave(), parsed, { settings: Object.assign(defaultSave().settings, parsed.settings||{}) });
    } catch(e){ return defaultSave(); }
  }
  function persist(){
    try{ localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch(e){ /* storage unavailable */ }
  }

  let save = loadSave();

  /* ---------------- DOM refs ---------------- */
  const $ = id => document.getElementById(id);
  const gameCanvas = $('gameCanvas');
  const heroPreview = $('heroPreview');

  /* ---------------- Loader ---------------- */
  window.addEventListener('load', ()=>{
    const fill = $('loaderFill');
    let p = 0;
    const iv = setInterval(()=>{
      p += Math.random()*22;
      if (p>=100){ p=100; clearInterval(iv); }
      fill.style.width = p+'%';
      if (p>=100){
        setTimeout(()=>{ $('loader').classList.add('hidden'); revealHero(); }, 260);
      }
    }, 110);
  });

  function revealHero(){
    document.querySelectorAll('.hstat-num').forEach(el=>{
      const target = parseInt(el.getAttribute('data-target')||'0',10);
      animateCount(el, target);
    });
  }

  function animateCount(el, target){
    const dur = 900; const start = performance.now(); const from = 0;
    function step(now){
      const p = Math.min((now-start)/dur, 1);
      const eased = 1 - Math.pow(1-p, 3);
      el.textContent = Math.round(from + (target-from)*eased).toLocaleString();
      if (p<1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ---------------- Apply settings ---------------- */
  function applySettings(){
    document.body.setAttribute('data-theme', save.settings.theme);
    document.body.setAttribute('data-quality', save.settings.quality);
    VesperGame.setQuality(save.settings.quality);
    VesperBG.setQuality(save.settings.quality);
    VesperAudio.setVolume(save.settings.volume/100);
    VesperAudio.setMuted(save.settings.muted);
    $('themeSelect').value = save.settings.theme;
    $('qualitySelect').value = save.settings.quality;
    $('fpsToggle').checked = save.settings.fps;
    $('volumeRange').value = save.settings.volume;
    $('muteCheck').checked = save.settings.muted;
    $('vibrateToggle').checked = save.settings.vibrate;
    $('fpsCounter').hidden = !save.settings.fps;
    updateMuteIcon();
  }

  function updateMuteIcon(){
    const on = document.querySelector('.icon-vol-on');
    const off = document.querySelector('.icon-vol-off');
    on.hidden = save.settings.muted;
    off.hidden = !save.settings.muted;
  }

  /* ---------------- Toasts ---------------- */
  function toast(message, opts){
    opts = opts || {};
    const el = document.createElement('div');
    el.className = 'toast' + (opts.achievement ? ' achievement':'');
    el.innerHTML = (opts.icon ? `<span>${opts.icon}</span>` : '') + `<span>${message}</span>`;
    $('toastStack').appendChild(el);
    setTimeout(()=>{
      el.classList.add('leaving');
      setTimeout(()=>el.remove(), 320);
    }, opts.duration || 3200);
  }

  /* ---------------- Daily challenge ---------------- */
  function todayStr(){
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
  }
  function seededRandom(seedStr){
    let h = 0;
    for (let i=0;i<seedStr.length;i++){ h = (h*31 + seedStr.charCodeAt(i))|0; }
    return () => {
      h = (h*1103515245 + 12345) & 0x7fffffff;
      return (h % 1000)/1000;
    };
  }
  function ensureDaily(){
    const today = todayStr();
    if (save.dailyDate !== today){
      const rnd = seededRandom(today);
      const tpl = DAILY_TEMPLATES[Math.floor(rnd()*DAILY_TEMPLATES.length)];
      const target = tpl.targets[Math.floor(rnd()*tpl.targets.length)];
      save.dailyDate = today;
      save.dailyTarget = { kind: tpl.kind, value: target, label: tpl.label(target) };
      save.dailyCompleted = false;
      save.dailyProgress = 0;
      persist();
    }
    renderDaily();
  }
  function renderDaily(){
    const dt = save.dailyTarget;
    $('dailyDate').textContent = new Date().toLocaleDateString(undefined,{ month:'short', day:'numeric' });
    $('dailyDesc').textContent = dt ? dt.label : '—';
    const pct = dt ? clamp01(save.dailyProgress/dt.value)*100 : 0;
    $('dailyFill').style.width = pct+'%';
    $('dailyProgressText').textContent = dt ? `${Math.min(save.dailyProgress,dt.value)} / ${dt.value}` : '0 / 0';
    $('dailyReward').textContent = save.dailyCompleted ? 'Reward claimed today ✓' : 'Reward: 40 shards';
  }
  function clamp01(v){ return Math.max(0,Math.min(1,v)); }

  function updateDailyProgress(runStats){
    const dt = save.dailyTarget;
    if (!dt || save.dailyCompleted) return;
    let val = 0;
    if (dt.kind==='score') val = runStats.score;
    else if (dt.kind==='coins') val = runStats.coins;
    else if (dt.kind==='survive') val = runStats.duration;
    save.dailyProgress = Math.max(save.dailyProgress, Math.floor(val));
    if (save.dailyProgress >= dt.value){
      save.dailyCompleted = true;
      save.totalCoins += 40;
      toast('Daily Challenge complete — +40 shards', { icon:'✅', achievement:true });
      VesperConfetti.burst(window.innerWidth/2, 160, 70);
    }
    persist();
    renderDaily();
  }

  /* ---------------- Level / XP ---------------- */
  function xpForLevel(l){ return Math.round(80 * Math.pow(l, 1.35)); }
  function addXP(amount){
    save.xp += amount;
    let leveled = false;
    while (save.xp >= xpForLevel(save.level)){
      save.xp -= xpForLevel(save.level);
      save.level++;
      leveled = true;
      const unlock = SKIN_UNLOCKS.find(u=>u.level===save.level);
      if (unlock && !save.unlockedSkins.includes(unlock.skin)){
        save.unlockedSkins.push(unlock.skin);
        save.equippedSkin = unlock.skin;
        toast(`Level ${save.level} — "${unlock.name}" skin unlocked!`, { icon:'✨', achievement:true });
      } else {
        toast(`Pilot Level ${save.level} reached!`, { icon:'⬆️' });
      }
    }
    if (leveled) VesperConfetti.burst(window.innerWidth/2, 160, 50);
    renderLevel();
  }
  function renderLevel(){
    $('levelTag').textContent = 'Lv. '+save.level;
    const need = xpForLevel(save.level);
    $('xpFill').style.width = clamp01(save.xp/need)*100+'%';
    $('xpText').textContent = `${save.xp} / ${need} XP`;
    const next = SKIN_UNLOCKS.find(u=>u.level>save.level);
    $('levelSkinNote').textContent = next ? `Reach Lv. ${next.level} to unlock "${next.name}".` : 'All skins unlocked.';
    VesperGame.setSkin(save.equippedSkin);
  }

  /* ---------------- Achievements ---------------- */
  function renderAchievements(){
    const list = $('achieveList');
    list.innerHTML = '';
    let done = 0;
    ACHIEVEMENTS.forEach(a=>{
      const isDone = !!save.achievements[a.id];
      if (isDone) done++;
      const li = document.createElement('li');
      li.className = 'achieve-item' + (isDone?' done':'');
      li.innerHTML = `<span class="achieve-icon">${isDone ? '✓' : a.icon}</span>
        <span class="achieve-info"><strong>${a.name}</strong><span>${a.desc}</span></span>`;
      list.appendChild(li);
    });
    $('achieveCount').textContent = `${done} / ${ACHIEVEMENTS.length}`;
  }
  function checkAchievements(){
    ACHIEVEMENTS.forEach(a=>{
      if (!save.achievements[a.id] && a.check(save)){
        save.achievements[a.id] = true;
        toast(`Achievement unlocked: ${a.name}`, { icon:'🏅', achievement:true, duration:4200 });
        VesperAudio.achievement();
        VesperConfetti.burst(window.innerWidth/2, 160, 60);
      }
    });
    renderAchievements();
  }

  /* ---------------- Scores table ---------------- */
  function renderScores(){
    const table = $('scoresTable');
    const empty = $('scoresEmpty');
    const rows = [...save.scores].sort((a,b)=>b.score-a.score).slice(0,10);
    table.querySelectorAll('.score-row').forEach(r=>r.remove());
    if (!rows.length){ empty.hidden = false; return; }
    empty.hidden = true;
    rows.forEach((r,i)=>{
      const div = document.createElement('div');
      div.className = 'score-row';
      const date = new Date(r.date);
      div.innerHTML = `<span class="score-rank">#${i+1}</span>
        <span class="score-date">${date.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</span>
        <span class="score-coins">${r.coins} shards</span>
        <span class="score-val">${r.score}</span>`;
      table.appendChild(div);
    });
  }

  /* ---------------- Hero stats ---------------- */
  function refreshHeroStats(){
    $('statBest').setAttribute('data-target', save.bestScore);
    $('statRuns').setAttribute('data-target', save.totalRuns);
    $('statCoins').setAttribute('data-target', save.totalCoins);
    $('statLevel').setAttribute('data-target', save.level);
    $('hudBest').textContent = save.bestScore;
  }

  /* ==========================================================================
     GAME WIRING
     ========================================================================== */
  VesperGame.init(gameCanvas);
  VesperGame.setSkin(save.equippedSkin);

  let runStartTime = 0;
  let comboPeak = 1;

  VesperGame.hooks.start = ()=>{
    $('startOverlay').hidden = true;
    $('gameOverOverlay').hidden = true;
    $('pauseOverlay').hidden = true;
    $('powerupBar').innerHTML = '';
    $('shieldIndicator').hidden = true;
    comboPeak = 1;
    runStartTime = performance.now();
    VesperAudio.resume();
    VesperAudio.startMusic();
  };

  VesperGame.hooks.pause = ()=>{ $('pauseOverlay').hidden = false; VesperAudio.stopMusic(); };
  VesperGame.hooks.resume = ()=>{ $('pauseOverlay').hidden = true; VesperAudio.startMusic(); };
  VesperGame.hooks.escape = ()=>{
    if (VesperGame.running && !VesperGame.over){
      if (VesperGame.paused) VesperGame.resume(); else VesperGame.pause();
    }
  };

  VesperGame.hooks.fps = (fps)=>{ $('fpsCounter').textContent = fps+' fps'; };

  VesperGame.hooks.coin = (total)=>{
    $('hudCoins').textContent = total;
    VesperAudio.coin();
  };
  VesperGame.hooks.gate = ()=>{ VesperAudio.gate(); };
  VesperGame.hooks.combo = (c)=>{
    comboPeak = Math.max(comboPeak, c);
    const el = $('hudCombo');
    el.textContent = '×'+(Math.round(c*10)/10);
    el.parentElement.classList.remove('pop');
    void el.offsetWidth;
    el.parentElement.classList.add('pop');
  };
  VesperGame.hooks.checkpoint = (n)=>{ toast(`Checkpoint ${n} reached`, { icon:'🚩', duration:1800 }); };
  VesperGame.hooks.shieldBreak = ()=>{
    save.shieldSaves++; persist();
    $('shieldIndicator').hidden = true;
    toast('Shield broke — you survived the hit!', { icon:'🛡️' });
    VesperAudio.hit();
    if (navigator.vibrate && save.settings.vibrate) navigator.vibrate(60);
  };
  VesperGame.hooks.power = (kind)=>{
    VesperAudio.power();
    const meta = {
      shield:{ label:'Shield', color:'#00e5ff' },
      magnet:{ label:'Magnet', color:'#ff2e88' },
      double:{ label:'2× Score', color:'#ffd23f' },
      dash:{ label:'Dash', color:'#8b5cf6' }
    }[kind];
    if (kind==='shield') $('shieldIndicator').hidden = false;
    const chip = document.createElement('span');
    chip.className = 'powerup-chip';
    chip.innerHTML = `<span class="dot" style="background:${meta.color}"></span>${meta.label}`;
    $('powerupBar').appendChild(chip);
    const life = kind==='shield' ? 999999 : kind==='dash' ? 2600 : kind==='magnet' ? 7200 : 8200;
    if (life < 999999) setTimeout(()=>chip.remove(), life);
    toast(meta.label+' activated', { icon:'⚡', duration:1600 });
  };

  VesperGame.hooks.gameover = (result)=>{
    VesperAudio.stopMusic();
    VesperAudio.gameOver();
    const duration = Math.round((performance.now()-runStartTime)/1000);

    save.totalRuns++;
    save.totalCoins += result.coins;
    save.lastRun = { score: result.score, coins: result.coins, combo: comboPeak, duration };
    const isNewBest = result.score > save.bestScore;
    if (isNewBest) save.bestScore = result.score;
    save.scores.push({ score: result.score, coins: result.coins, combo: comboPeak, date: Date.now() });
    save.scores = save.scores.sort((a,b)=>b.score-a.score).slice(0,10);

    const xpEarned = Math.round(result.score*0.6 + result.coins*2);
    addXP(xpEarned);
    persist();

    updateDailyProgress({ score: result.score, coins: result.coins, duration });
    checkAchievements();
    renderScores();
    refreshHeroStats();

    $('resultScore').textContent = result.score;
    $('resultCoins').textContent = result.coins;
    $('resultCombo').textContent = '×'+comboPeak;
    $('resultXP').textContent = '+'+xpEarned;
    $('newBestFlag').hidden = !isNewBest;
    $('gameOverTitle').textContent = isNewBest ? 'New personal best!' : pickDeathLine();
    $('gameOverOverlay').hidden = false;
    if (isNewBest) VesperConfetti.burst(window.innerWidth/2, window.innerHeight/2.4, 100);

    $('hudScore').textContent = 0;
    $('hudCombo').textContent = '×1';
  };

  function pickDeathLine(){
    const lines = ['The void caught you','So close to the next gate','The shaft claims another pilot','Gravity wins this round'];
    return lines[(Math.random()*lines.length)|0];
  }

  // live HUD score update
  (function pollScore(){
    if (VesperGame.running && !VesperGame.over){
      $('hudScore').textContent = Math.floor(VesperGame.score);
    }
    requestAnimationFrame(pollScore);
  })();

  /* ==========================================================================
     UI BINDINGS
     ========================================================================== */
  function startGame(){ VesperAudio.resume(); VesperAudio.click(); VesperGame.start(); }
  $('startBtn').addEventListener('click', startGame);
  $('heroPlayBtn').addEventListener('click', ()=>{ document.getElementById('play').scrollIntoView({behavior:'smooth'}); setTimeout(startGame, 400); });
  $('navPlayBtn').addEventListener('click', ()=>{ document.getElementById('play').scrollIntoView({behavior:'smooth'}); });
  $('retryBtn').addEventListener('click', startGame);
  $('resumeBtn').addEventListener('click', ()=>{ VesperAudio.click(); VesperGame.resume(); });
  $('restartFromPauseBtn').addEventListener('click', ()=>{ VesperAudio.click(); startGame(); });
  $('pauseBtn').addEventListener('click', ()=>{
    if (!VesperGame.running || VesperGame.over) return;
    VesperAudio.click();
    VesperGame.paused ? VesperGame.resume() : VesperGame.pause();
  });

  $('fullscreenBtn').addEventListener('click', ()=>{
    const el = $('gameViewport');
    if (!document.fullscreenElement){ el.requestFullscreen?.(); }
    else { document.exitFullscreen?.(); }
  });

  $('shareBtn').addEventListener('click', async ()=>{
    const text = `I scored ${save.lastRun.score} in VESPER — can you beat it?`;
    if (navigator.share){
      try{ await navigator.share({ text, title:'VESPER' }); } catch(e){ /* cancelled */ }
    } else {
      try{ await navigator.clipboard.writeText(text); toast('Score copied to clipboard', { icon:'📋' }); }
      catch(e){ toast(text, { icon:'📋', duration:5000 }); }
    }
  });

  $('muteToggle').addEventListener('click', ()=>{
    save.settings.muted = !save.settings.muted;
    VesperAudio.setMuted(save.settings.muted);
    updateMuteIcon(); persist();
  });

  $('settingsToggle').addEventListener('click', ()=>openModal('settingsModal'));
  document.querySelectorAll('[data-modal]').forEach(btn=>{
    btn.addEventListener('click', ()=>openModal(btn.getAttribute('data-modal')));
  });
  document.querySelectorAll('[data-close-modal]').forEach(btn=>{
    btn.addEventListener('click', ()=> btn.closest('.modal-backdrop').setAttribute('hidden',''));
  });
  document.querySelectorAll('.modal-backdrop').forEach(m=>{
    m.addEventListener('click', (e)=>{ if (e.target===m) m.setAttribute('hidden',''); });
  });
  function openModal(id){ VesperAudio.click(); $(id).removeAttribute('hidden'); }

  $('themeSelect').addEventListener('change', e=>{ save.settings.theme = e.target.value; applySettings(); persist(); });
  $('qualitySelect').addEventListener('change', e=>{ save.settings.quality = e.target.value; applySettings(); persist(); });
  $('fpsToggle').addEventListener('change', e=>{ save.settings.fps = e.target.checked; applySettings(); persist(); });
  $('volumeRange').addEventListener('input', e=>{ save.settings.volume = +e.target.value; VesperAudio.setVolume(save.settings.volume/100); persist(); });
  $('muteCheck').addEventListener('change', e=>{ save.settings.muted = e.target.checked; VesperAudio.setMuted(e.target.checked); updateMuteIcon(); persist(); });
  $('vibrateToggle').addEventListener('change', e=>{ save.settings.vibrate = e.target.checked; persist(); });

  function resetProgress(){
    if (!confirm('Reset all VESPER progress? This clears scores, shards, XP, achievements and settings on this device.')) return;
    save = defaultSave();
    persist();
    applySettings();
    ensureDaily();
    renderLevel();
    renderAchievements();
    renderScores();
    refreshHeroStats();
    revealHero();
    toast('Progress reset', { icon:'🗑️' });
  }
  $('resetProgressBtn').addEventListener('click', resetProgress);
  $('settingsResetBtn').addEventListener('click', resetProgress);

  /* ---------------- Easter egg: Konami code ---------------- */
  const KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  let konamiPos = 0;
  window.addEventListener('keydown', (e)=>{
    const key = e.key;
    if (key === KONAMI[konamiPos] || key.toLowerCase() === KONAMI[konamiPos]){
      konamiPos++;
      if (konamiPos === KONAMI.length){
        konamiPos = 0;
        if (!save.secretUnlocked){
          save.secretUnlocked = true;
          if (!save.unlockedSkins.includes('violet')) save.unlockedSkins.push('violet');
          save.equippedSkin = 'violet';
          persist();
          VesperGame.setSkin('violet');
          toast('Secret code accepted — Violet Drift unlocked!', { icon:'🕹️', achievement:true, duration:5000 });
          VesperConfetti.burst(window.innerWidth/2, window.innerHeight/2, 120);
        } else {
          toast('The void winks back at you.', { icon:'🕹️' });
        }
      }
    } else {
      konamiPos = (key === KONAMI[0]) ? 1 : 0;
    }
  });

  /* ---------------- Dev console (` key) ---------------- */
  VesperGame.hooks.devconsole = ()=>{
    toast(`dev: score=${Math.floor(VesperGame.score)} speed=${Math.floor(VesperGame.speed)} fps~${Math.round(VesperGame._fpsAcc||0)}`, { icon:'🖥️', duration:4000 });
  };

  /* ---------------- Hero mini preview (idle ambient canvas) ---------------- */
  (function heroPreviewLoop(){
    const ctx = heroPreview.getContext('2d');
    function resize(){
      const r = heroPreview.getBoundingClientRect();
      heroPreview.width = r.width*(window.devicePixelRatio||1);
      heroPreview.height = r.height*(window.devicePixelRatio||1);
      ctx.setTransform(window.devicePixelRatio||1,0,0,window.devicePixelRatio||1,0,0);
    }
    window.addEventListener('resize', resize); resize();
    const dots = Array.from({length:26}, ()=>({
      x:Math.random(), y:Math.random(), r:Math.random()*2+1,
      hue: Math.random()<0.5?'#00e5ff':'#ff2e88', s:Math.random()*0.4+0.1, ph:Math.random()*10
    }));
    let orbY = 0.5, orbVy = 0, t=0;
    function loop(){
      t += 0.016;
      const w = heroPreview.clientWidth, h = heroPreview.clientHeight;
      ctx.clearRect(0,0,w,h);
      const grad = ctx.createRadialGradient(w*0.5,h*0.4,10,w*0.5,h*0.4,w*0.8);
      grad.addColorStop(0,'rgba(0,229,255,.10)'); grad.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);
      dots.forEach(d=>{
        const y = ((d.y + t*d.s*0.02) % 1) * h;
        ctx.globalAlpha = 0.5 + Math.sin(t+d.ph)*0.3;
        ctx.fillStyle = d.hue;
        ctx.beginPath(); ctx.arc(d.x*w, y, d.r, 0, Math.PI*2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      orbVy += Math.sin(t*0.9)*0.02;
      orbY += orbVy*0.02;
      orbY = 0.3 + Math.sin(t*0.7)*0.18;
      const cx = w*0.5, cy = h*orbY;
      ctx.save();
      ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 24;
      ctx.fillStyle = '#00e5ff';
      ctx.beginPath(); ctx.arc(cx,cy,10,0,Math.PI*2); ctx.fill();
      ctx.restore();
      requestAnimationFrame(loop);
    }
    loop();
  })();

  /* ---------------- Init ---------------- */
  applySettings();
  ensureDaily();
  renderLevel();
  renderAchievements();
  renderScores();
  refreshHeroStats();

  /* ---------------- Service worker ---------------- */
  if ('serviceWorker' in navigator){
    window.addEventListener('load', ()=>{
      navigator.serviceWorker.register('sw.js').catch(()=>{ /* offline support unavailable */ });
    });
  }

})();
