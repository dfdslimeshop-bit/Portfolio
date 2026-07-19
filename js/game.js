/* ==========================================================================
   VESPER — game.js
   Self-contained canvas game engine. One-touch flight through a procedurally
   generated shaft of gaps, gates, shards and power-ups.
   ========================================================================== */
(function(){

  const SKIN_COLORS = {
    aurora: { core:'#00e5ff', glow:'rgba(0,229,255,.55)' },
    ember:  { core:'#ff2e88', glow:'rgba(255,46,136,.55)' },
    gold:   { core:'#ffd23f', glow:'rgba(255,210,63,.55)' },
    violet: { core:'#8b5cf6', glow:'rgba(139,92,246,.55)' }
  };
  const GATE_HUES = ['#00e5ff','#ff2e88','#ffd23f'];

  function rand(a,b){ return a + Math.random()*(b-a); }
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  function Game(){
    this.canvas = null; this.ctx = null;
    this.w = 0; this.h = 0; this.dpr = 1;
    this.running = false; this.paused = false; this.over = false;
    this.quality = 'high';
    this.skin = 'aurora';

    this.hooks = {}; // set externally

    this.reset();
  }

  Game.prototype.init = function(canvas){
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._resize();
    window.addEventListener('resize', ()=>this._resize());

    // input
    const press = (e)=>{ if(e.cancelable) e.preventDefault(); this.thrust = true; if(!this.running && !this.over) this.start(); };
    const release = ()=>{ this.thrust = false; };
    canvas.addEventListener('pointerdown', press);
    window.addEventListener('pointerup', release);
    canvas.addEventListener('touchstart', press, { passive:false });
    window.addEventListener('touchend', release);
    window.addEventListener('keydown', (e)=>{
      if (e.code === 'Space' || e.code === 'ArrowUp'){
        e.preventDefault();
        this.thrust = true;
        if(!this.running && !this.over) this.start();
      }
      if (e.code === 'Escape'){ this._emit('escape'); }
      if (e.code === 'Backquote'){ this._emit('devconsole'); }
    });
    window.addEventListener('keyup', (e)=>{
      if (e.code === 'Space' || e.code === 'ArrowUp') this.thrust = false;
    });

    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  };

  Game.prototype._resize = function(){
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio||1, 2);
    this.w = rect.width; this.h = rect.height;
    this.canvas.width = this.w*this.dpr; this.canvas.height = this.h*this.dpr;
    this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
  };

  Game.prototype.setQuality = function(q){ this.quality = q; };
  Game.prototype.setSkin = function(s){ if (SKIN_COLORS[s]) this.skin = s; };

  Game.prototype.reset = function(){
    this.t = 0;
    this.speed = 200;              // px/s scroll speed
    this.baseSpeed = 200;
    this.gravity = 900;
    this.thrustPower = 2000;
    this.maxVy = 620;

    this.player = { x: 130, y: 200, vy: 0, r: 15, trail: [] };
    this.obstacles = [];
    this.particles = [];
    this.floaters = []; // score popups

    this.spawnTimer = 0;
    this.spawnInterval = 1.35;
    this.distance = 0;
    this.score = 0;
    this.coins = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.bestComboRun = 1;
    this.lastCheckpoint = 0;

    this.shieldActive = false;
    this.magnetTimer = 0;
    this.doubleTimer = 0;
    this.dashTimer = 0;
    this.invuln = 0;

    this.shake = 0;
    this.slowmo = 1;
    this.thrust = false;
    this.running = false;
    this.paused = false;
    this.over = false;

    this.aura = 0; // color cycle index float
  };

  Game.prototype.start = function(){
    this.reset();
    this.running = true;
    this._emit('start');
  };

  Game.prototype.pause = function(){ if(this.running && !this.over){ this.paused = true; this._emit('pause'); } };
  Game.prototype.resume = function(){ if(this.running && !this.over){ this.paused = false; this._emit('resume'); } };

  Game.prototype._emit = function(name, data){
    if (this.hooks[name]) this.hooks[name](data);
  };

  Game.prototype._spawnSet = function(){
    const w = this.w, h = this.h;
    const difficultyT = clamp(this.score/900, 0, 1);
    const gapSize = clamp(rand(0.30,0.36) - difficultyT*0.08, 0.20, 0.4) * h;
    const gapY = rand(0.18, 0.82) * h;
    const isGate = Math.random() < 0.4;
    const hue = GATE_HUES[(Math.random()*GATE_HUES.length)|0];

    this.obstacles.push({
      type: isGate ? 'gate' : 'spike',
      x: w + 40,
      width: isGate ? 14 : 34,
      gapY, gapSize,
      hue,
      passed: false,
      wobble: Math.random()*Math.PI*2
    });

    // shard cluster in the gap, sometimes
    if (Math.random() < 0.75){
      const count = 3 + ((Math.random()*3)|0);
      const arc = Math.random() < 0.5;
      for (let i=0;i<count;i++){
        this.obstacles.push({
          type:'coin',
          x: w + 40 + 90 + i*26,
          y: gapY + (arc ? Math.sin(i/(count-1||1)*Math.PI)*-26 : 0),
          r: 6,
          collected:false,
          spin: Math.random()*Math.PI*2
        });
      }
    }

    // power-up, rare
    if (Math.random() < 0.12){
      const kinds = ['shield','magnet','double','dash'];
      this.obstacles.push({
        type:'power',
        kind: kinds[(Math.random()*kinds.length)|0],
        x: w + 220,
        y: rand(h*0.25, h*0.75),
        r: 15,
        collected:false
      });
    }
  };

  Game.prototype._addParticles = function(x,y,color,count,speed,life){
    const mult = this.quality==='high' ? 1 : this.quality==='medium' ? 0.55 : 0.25;
    count = Math.ceil(count*mult);
    for (let i=0;i<count;i++){
      const a = Math.random()*Math.PI*2;
      const s = rand(speed*0.3, speed);
      this.particles.push({
        x,y, vx:Math.cos(a)*s, vy:Math.sin(a)*s,
        life: life||1, maxLife:life||1, color, size: rand(2,5)
      });
    }
  };

  Game.prototype._loop = function(now){
    requestAnimationFrame(this._loop);
    if (!this._last) this._last = now;
    let dt = (now - this._last)/1000;
    this._last = now;
    dt = Math.min(dt, 0.033);
    this._fpsAcc = (this._fpsAcc||0)*0.9 + (1/Math.max(dt,0.0001))*0.1;
    this._emit('fps', Math.round(this._fpsAcc));

    if (this.running && !this.paused && !this.over){
      this._update(dt);
    }
    this._draw();
  };

  Game.prototype._update = function(dt){
    const realDt = dt;
    this.slowmo += (1-this.slowmo)*0.08;
    dt *= this.slowmo;
    this.t += dt;
    this.aura += dt*0.6;

    // difficulty ramp
    this.speed = this.baseSpeed + Math.min(this.t*6, 240) + Math.min(this.score*0.15, 160);
    this.spawnInterval = clamp(1.35 - this.t*0.01, 0.62, 1.35);

    // score by distance
    const scoreGain = dt * (this.speed/40) * (this.doubleTimer>0?2:1) * (1 + (this.combo-1)*0.15);
    this.score += scoreGain;

    // checkpoint every 250 pts
    if (Math.floor(this.score/250) > this.lastCheckpoint){
      this.lastCheckpoint = Math.floor(this.score/250);
      this.coins += 5;
      this._emit('checkpoint', this.lastCheckpoint);
      this._addParticles(this.player.x, this.player.y, '#3ce6a3', 30, 220, 0.8);
    }

    // player physics
    const p = this.player;
    if (this.thrust) p.vy -= this.thrustPower*dt;
    p.vy += this.gravity*dt;
    p.vy = clamp(p.vy, -this.maxVy, this.maxVy);
    p.y += p.vy*dt;

    // trail
    p.trail.unshift({x:p.x,y:p.y});
    if (p.trail.length > 16) p.trail.pop();

    // bounds
    if (p.y < p.r){ p.y = p.r; p.vy = 0; }
    if (p.y > this.h - p.r){
      this._die(); return;
    }

    // timers
    if (this.magnetTimer>0) this.magnetTimer -= realDt;
    if (this.doubleTimer>0) this.doubleTimer -= realDt;
    if (this.dashTimer>0){ this.dashTimer -= realDt; this.invuln = Math.max(this.invuln, 0.01); }
    if (this.invuln>0) this.invuln -= realDt;
    if (this.comboTimer>0){
      this.comboTimer -= realDt;
    } else if (this.combo>1){
      this.combo = 1;
      this._emit('combo', this.combo);
    }
    this.shake *= 0.9;

    // spawn
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0){
      this._spawnSet();
      this.spawnTimer = this.spawnInterval;
    }

    // move & handle obstacles
    const dashSpeedMult = this.dashTimer>0 ? 1.6 : 1;
    for (let i=this.obstacles.length-1;i>=0;i--){
      const o = this.obstacles[i];
      o.x -= this.speed*dashSpeedMult*dt;

      if (o.type==='coin'){
        if (!o.collected){
          if (this.magnetTimer>0){
            const dx = p.x-o.x, dy=p.y-(o.y??this.h/2);
            const d = Math.hypot(dx,dy);
            if (d < 160){ o.x += dx*0.12; o.y = (o.y??this.h/2)+dy*0.12; }
          }
          const oy = o.y ?? this.h/2;
          if (Math.hypot(p.x-o.x, p.y-oy) < p.r+o.r){
            o.collected = true;
            this.coins++;
            this._registerPickup();
            this._addParticles(o.x, oy, '#ffd23f', 10, 140, 0.5);
            this._emit('coin', this.coins);
          }
        }
      } else if (o.type==='power'){
        if (!o.collected && Math.hypot(p.x-o.x, p.y-o.y) < p.r+o.r+2){
          o.collected = true;
          this._applyPower(o.kind);
        }
      } else if (o.type==='spike' || o.type==='gate'){
        if (!o.passed && o.x + o.width < p.x - p.r){
          o.passed = true;
          if (o.type==='gate'){
            this._registerPickup();
            this.score += 15;
            this._addParticles(o.x, p.y, o.hue, 16, 160, 0.5);
            this._emit('gate');
          }
        }
        // collision (skip if invulnerable)
        if (this.invuln<=0 && o.x < p.x+p.r && o.x+o.width > p.x-p.r){
          const topEdge = o.gapY - o.gapSize/2;
          const botEdge = o.gapY + o.gapSize/2;
          if (p.y - p.r < topEdge || p.y + p.r > botEdge){
            this._hit();
          }
        }
      }

      // cull offscreen
      if (o.x < -100){
        if ((o.type==='spike'||o.type==='gate') && !o.passed){ /* missed gate, no penalty */ }
        this.obstacles.splice(i,1);
      }
    }

    // particles
    for (let i=this.particles.length-1;i>=0;i--){
      const pt = this.particles[i];
      pt.x += pt.vx*dt; pt.y += pt.vy*dt;
      pt.vx *= 0.96; pt.vy *= 0.96;
      pt.life -= dt*1.6;
      if (pt.life<=0) this.particles.splice(i,1);
    }
    for (let i=this.floaters.length-1;i>=0;i--){
      const f = this.floaters[i];
      f.y -= dt*40; f.life -= dt;
      if (f.life<=0) this.floaters.splice(i,1);
    }
  };

  Game.prototype._registerPickup = function(){
    this.combo = Math.min(this.combo+0.5, 10);
    this.comboTimer = 2.2;
    this.bestComboRun = Math.max(this.bestComboRun, this.combo);
    this._emit('combo', this.combo);
  };

  Game.prototype._applyPower = function(kind){
    const p = this.player;
    this._addParticles(p.x,p.y,'#8b5cf6',26,200,0.6);
    this._emit('power', kind);
    if (kind==='shield'){ this.shieldActive = true; }
    else if (kind==='magnet'){ this.magnetTimer = 7; }
    else if (kind==='double'){ this.doubleTimer = 8; }
    else if (kind==='dash'){ this.dashTimer = 2.4; this.invuln = 2.4; this.shake = 8; this.slowmo = 0.4; }
  };

  Game.prototype._hit = function(){
    if (this.shieldActive){
      this.shieldActive = false;
      this.invuln = 1.2;
      this.shake = 10;
      this._addParticles(this.player.x, this.player.y, '#00e5ff', 24, 220, 0.6);
      this._emit('shieldBreak');
      return;
    }
    this._die();
  };

  Game.prototype._die = function(){
    if (this.over) return;
    this.over = true;
    this.running = false;
    this.shake = 18;
    this.slowmo = 0.25;
    this._addParticles(this.player.x, this.player.y, SKIN_COLORS[this.skin].core, 60, 260, 1.1);
    this._emit('gameover', {
      score: Math.floor(this.score),
      coins: this.coins,
      combo: Math.round(this.bestComboRun*10)/10
    });
  };

  Game.prototype._draw = function(){
    const ctx = this.ctx, w=this.w, h=this.h;
    ctx.clearRect(0,0,w,h);

    // shake offset
    const sx = (Math.random()-0.5)*this.shake;
    const sy = (Math.random()-0.5)*this.shake;
    ctx.save();
    ctx.translate(sx,sy);

    // backdrop grid
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = '#1c2540';
    ctx.lineWidth = 1;
    const gridStep = 46;
    const offset = (this.t*this.speed*0.5)%gridStep;
    for (let x=-offset; x<w; x+=gridStep){
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // obstacles
    for (const o of this.obstacles){
      if (o.type==='spike' || o.type==='gate'){
        const topEdge = o.gapY - o.gapSize/2;
        const botEdge = o.gapY + o.gapSize/2;
        if (o.type==='spike'){
          ctx.fillStyle = '#1a2036';
          ctx.strokeStyle = 'rgba(255,255,255,.08)';
          this._roundRect(ctx,o.x,0,o.width,topEdge,6); ctx.fill(); ctx.stroke();
          this._roundRect(ctx,o.x,botEdge,o.width,h-botEdge,6); ctx.fill(); ctx.stroke();
          // glow edge
          ctx.fillStyle = 'rgba(255,77,94,.5)';
          ctx.fillRect(o.x, topEdge-3, o.width, 3);
          ctx.fillRect(o.x, botEdge, o.width, 3);
        } else {
          ctx.save();
          ctx.shadowColor = o.hue; ctx.shadowBlur = this.quality==='low'?0:16;
          ctx.fillStyle = o.hue;
          ctx.fillRect(o.x, 0, o.width, topEdge);
          ctx.fillRect(o.x, botEdge, o.width, h-botEdge);
          ctx.restore();
        }
      } else if (o.type==='coin'){
        if (o.collected) continue;
        const oy = o.y ?? h/2;
        o.spin += 0.12;
        ctx.save();
        ctx.translate(o.x, oy);
        ctx.scale(Math.abs(Math.cos(o.spin))*0.8+0.2, 1);
        ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = this.quality==='low'?0:12;
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath(); ctx.arc(0,0,o.r,0,Math.PI*2); ctx.fill();
        ctx.restore();
      } else if (o.type==='power'){
        if (o.collected) continue;
        const colors = { shield:'#00e5ff', magnet:'#ff2e88', double:'#ffd23f', dash:'#8b5cf6' };
        const c = colors[o.kind];
        ctx.save();
        ctx.translate(o.x,o.y);
        ctx.rotate(this.t*1.4);
        ctx.shadowColor = c; ctx.shadowBlur = this.quality==='low'?0:18;
        ctx.strokeStyle = c; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0,0,o.r,0,Math.PI*2); ctx.stroke();
        ctx.fillStyle = c; ctx.globalAlpha = 0.25;
        ctx.beginPath(); ctx.arc(0,0,o.r-4,0,Math.PI*2); ctx.fill();
        ctx.restore();
      }
    }

    // particles
    for (const pt of this.particles){
      ctx.globalAlpha = clamp(pt.life,0,1);
      ctx.fillStyle = pt.color;
      ctx.beginPath(); ctx.arc(pt.x,pt.y,pt.size*pt.life,0,Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // player trail
    const skin = SKIN_COLORS[this.skin];
    const p = this.player;
    for (let i=0;i<p.trail.length;i++){
      const t = p.trail[i];
      const a = (1-i/p.trail.length)*0.35;
      ctx.globalAlpha = a;
      ctx.fillStyle = skin.core;
      ctx.beginPath(); ctx.arc(t.x,t.y, p.r*(1-i/p.trail.length*0.6), 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // player
    ctx.save();
    ctx.shadowColor = skin.core; ctx.shadowBlur = this.quality==='low'?6:26;
    ctx.fillStyle = skin.core;
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
    if (this.shieldActive){
      ctx.strokeStyle = 'rgba(0,229,255,.7)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r+7,0,Math.PI*2); ctx.stroke();
    }
    if (this.invuln>0 && !this.shieldActive){
      ctx.globalAlpha = 0.5 + Math.sin(this.t*20)*0.3;
      ctx.strokeStyle = '#8b5cf6'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r+10,0,Math.PI*2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    ctx.restore(); // shake

    if (!this.running && !this.over){
      // idle preview: gentle bob
      p.y = h/2 + Math.sin(performance.now()/500)*20;
    }
  };

  Game.prototype._roundRect = function(ctx,x,y,w,h,r){
    if (h<=0) return;
    r = Math.min(r, Math.abs(h)/2, w/2);
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath();
  };

  window.VesperGame = new Game();
})();
