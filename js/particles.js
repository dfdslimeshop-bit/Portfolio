/* ==========================================================================
   VESPER — particles.js
   Ambient starfield background + confetti burst effect.
   ========================================================================== */
(function(){

  /* ---------------- Ambient background ---------------- */
  const bg = document.getElementById('bgCanvas');
  const bgCtx = bg.getContext('2d');
  let bgParticles = [];
  let bgW = 0, bgH = 0;
  let quality = 'high';

  function resizeBg(){
    bgW = window.innerWidth; bgH = window.innerHeight;
    bg.width = bgW * (window.devicePixelRatio||1);
    bg.height = bgH * (window.devicePixelRatio||1);
    bg.style.width = bgW+'px'; bg.style.height = bgH+'px';
    bgCtx.setTransform(window.devicePixelRatio||1,0,0,window.devicePixelRatio||1,0,0);
    seedBgParticles();
  }

  function seedBgParticles(){
    const counts = { high: 90, medium: 55, low: 26 };
    const n = counts[quality] ?? 90;
    bgParticles = Array.from({length:n}, ()=> ({
      x: Math.random()*bgW,
      y: Math.random()*bgH,
      r: Math.random()*1.6 + 0.4,
      vy: Math.random()*0.15 + 0.02,
      vx: (Math.random()-0.5)*0.06,
      hue: Math.random() < 0.5 ? 190 : 320,
      tw: Math.random()*Math.PI*2,
      twSpeed: Math.random()*0.02 + 0.005
    }));
  }

  function drawBg(){
    bgCtx.clearRect(0,0,bgW,bgH);
    const isLight = document.body.getAttribute('data-theme') === 'light';
    bgCtx.globalCompositeOperation = 'lighter';
    for (const p of bgParticles){
      p.y -= p.vy; p.x += p.vx; p.tw += p.twSpeed;
      if (p.y < -10) { p.y = bgH+10; p.x = Math.random()*bgW; }
      if (p.x < -10) p.x = bgW+10;
      if (p.x > bgW+10) p.x = -10;
      const alpha = (Math.sin(p.tw)*0.3 + 0.5) * (isLight ? 0.35 : 0.8);
      bgCtx.beginPath();
      bgCtx.fillStyle = `hsla(${p.hue}, 100%, 65%, ${alpha})`;
      bgCtx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      bgCtx.fill();
    }
    bgCtx.globalCompositeOperation = 'source-over';
    requestAnimationFrame(drawBg);
  }

  window.addEventListener('resize', resizeBg);
  resizeBg();
  requestAnimationFrame(drawBg);

  window.VesperBG = {
    setQuality(q){ quality = q; seedBgParticles(); }
  };

  /* ---------------- Mouse glow ---------------- */
  const glow = document.getElementById('mouseGlow');
  let glowX = -999, glowY = -999, curX = -999, curY = -999;
  window.addEventListener('pointermove', (e)=>{
    glowX = e.clientX; glowY = e.clientY;
  }, { passive:true });
  function animGlow(){
    curX += (glowX-curX)*0.15; curY += (glowY-curY)*0.15;
    glow.style.left = curX+'px'; glow.style.top = curY+'px';
    requestAnimationFrame(animGlow);
  }
  animGlow();

  /* ---------------- Confetti ---------------- */
  const confettiCanvas = document.getElementById('confettiCanvas');
  const cCtx = confettiCanvas.getContext('2d');
  let confetti = [];
  let confettiRunning = false;

  function resizeConfetti(){
    confettiCanvas.width = window.innerWidth * (window.devicePixelRatio||1);
    confettiCanvas.height = window.innerHeight * (window.devicePixelRatio||1);
    confettiCanvas.style.width = window.innerWidth+'px';
    confettiCanvas.style.height = window.innerHeight+'px';
    cCtx.setTransform(window.devicePixelRatio||1,0,0,window.devicePixelRatio||1,0,0);
  }
  window.addEventListener('resize', resizeConfetti);
  resizeConfetti();

  function burstConfetti(x, y, count){
    const colors = ['#00e5ff','#ff2e88','#ffd23f','#8b5cf6','#3ce6a3'];
    count = count || 90;
    x = x ?? window.innerWidth/2;
    y = y ?? window.innerHeight/3;
    for (let i=0;i<count;i++){
      const angle = Math.random()*Math.PI*2;
      const speed = Math.random()*7 + 3;
      confetti.push({
        x, y,
        vx: Math.cos(angle)*speed,
        vy: Math.sin(angle)*speed - 3,
        size: Math.random()*7+4,
        color: colors[(Math.random()*colors.length)|0],
        rot: Math.random()*Math.PI,
        vr: (Math.random()-0.5)*0.3,
        life: 1
      });
    }
    if (!confettiRunning){ confettiRunning = true; requestAnimationFrame(tickConfetti); }
  }

  function tickConfetti(){
    cCtx.clearRect(0,0,window.innerWidth, window.innerHeight);
    confetti.forEach(p=>{
      p.vy += 0.14;
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      p.life -= 0.012;
      cCtx.save();
      cCtx.globalAlpha = Math.max(p.life,0);
      cCtx.translate(p.x, p.y);
      cCtx.rotate(p.rot);
      cCtx.fillStyle = p.color;
      cCtx.fillRect(-p.size/2, -p.size/4, p.size, p.size/2);
      cCtx.restore();
    });
    confetti = confetti.filter(p=> p.life > 0 && p.y < window.innerHeight+50);
    if (confetti.length){
      requestAnimationFrame(tickConfetti);
    } else {
      confettiRunning = false;
      cCtx.clearRect(0,0,window.innerWidth, window.innerHeight);
    }
  }

  window.VesperConfetti = { burst: burstConfetti };

})();
