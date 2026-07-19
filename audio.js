/* ==========================================================================
   VESPER — audio.js
   Every sound is synthesized in-browser with the Web Audio API.
   No external audio files, so the game works fully offline.
   ========================================================================== */
(function(){
  const Audio2 = {
    ctx: null,
    master: null,
    musicGain: null,
    sfxGain: null,
    muted: false,
    volume: 0.7,
    musicNodes: [],
    musicPlaying: false,
    musicTimer: null,

    init(){
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.35;
      this.musicGain.connect(this.master);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 1;
      this.sfxGain.connect(this.master);
    },

    resume(){
      this.init();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },

    setVolume(v){
      this.volume = v;
      if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05);
    },

    setMuted(m){
      this.muted = m;
      if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
    },

    // --- low level helpers ---
    _osc(type, freq, dest, detune){
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      if (detune) o.detune.value = detune;
      o.connect(dest);
      return o;
    },

    _env(gainNode, t0, attack, decay, sustainLevel, release, peak){
      const g = gainNode.gain;
      g.cancelScheduledValues(t0);
      g.setValueAtTime(0.0001, t0);
      g.linearRampToValueAtTime(peak, t0 + attack);
      g.linearRampToValueAtTime(peak * sustainLevel, t0 + attack + decay);
      g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay + release);
    },

    play(fn){
      if (!this.ctx) this.init();
      if (!this.ctx) return;
      this.resume();
      try { fn(); } catch(e){ /* ignore audio glitches */ }
    },

    // --- sound effects ---
    jump(){
      this.play(()=>{
        const t = this.ctx.currentTime;
        const g = this.ctx.createGain(); g.connect(this.sfxGain);
        const o = this._osc('triangle', 260, g);
        o.frequency.exponentialRampToValueAtTime(560, t + 0.11);
        this._env(g, t, 0.005, 0.09, 0.4, 0.09, 0.22);
        o.start(t); o.stop(t + 0.22);
      });
    },
    coin(){
      this.play(()=>{
        const t = this.ctx.currentTime;
        const g = this.ctx.createGain(); g.connect(this.sfxGain);
        const o = this._osc('square', 880, g);
        o.frequency.setValueAtTime(880, t);
        o.frequency.setValueAtTime(1320, t + 0.06);
        this._env(g, t, 0.001, 0.05, 0.3, 0.12, 0.18);
        o.start(t); o.stop(t + 0.2);
      });
    },
    gate(){
      this.play(()=>{
        const t = this.ctx.currentTime;
        const g = this.ctx.createGain(); g.connect(this.sfxGain);
        const o = this._osc('sine', 440, g);
        o.frequency.exponentialRampToValueAtTime(660, t + 0.15);
        this._env(g, t, 0.01, 0.1, 0.3, 0.15, 0.2);
        o.start(t); o.stop(t + 0.3);
      });
    },
    power(){
      this.play(()=>{
        const t = this.ctx.currentTime;
        const g = this.ctx.createGain(); g.connect(this.sfxGain);
        const o1 = this._osc('sawtooth', 220, g);
        const o2 = this._osc('sawtooth', 330, g, 6);
        o1.frequency.exponentialRampToValueAtTime(660, t + 0.3);
        o2.frequency.exponentialRampToValueAtTime(990, t + 0.3);
        this._env(g, t, 0.01, 0.2, 0.5, 0.2, 0.22);
        o1.start(t); o2.start(t); o1.stop(t + 0.45); o2.stop(t + 0.45);
      });
    },
    hit(){
      this.play(()=>{
        const t = this.ctx.currentTime;
        const g = this.ctx.createGain(); g.connect(this.sfxGain);
        const bufSize = this.ctx.sampleRate * 0.3;
        const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i=0;i<bufSize;i++) data[i] = (Math.random()*2-1) * (1 - i/bufSize);
        const noise = this.ctx.createBufferSource(); noise.buffer = buf;
        const filt = this.ctx.createBiquadFilter(); filt.type='lowpass'; filt.frequency.value=1800;
        noise.connect(filt); filt.connect(g);
        this._env(g, t, 0.001, 0.06, 0.3, 0.22, 0.5);
        noise.start(t); noise.stop(t + 0.32);

        const o = this._osc('sawtooth', 90, g);
        o.frequency.exponentialRampToValueAtTime(30, t + 0.3);
        o.start(t); o.stop(t + 0.3);
      });
    },
    gameOver(){
      this.play(()=>{
        const t = this.ctx.currentTime;
        const notes = [440, 370, 294, 220];
        notes.forEach((f,i)=>{
          const g = this.ctx.createGain(); g.connect(this.sfxGain);
          const o = this._osc('triangle', f, g);
          this._env(g, t + i*0.12, 0.01, 0.1, 0.3, 0.18, 0.22);
          o.start(t + i*0.12); o.stop(t + i*0.12 + 0.32);
        });
      });
    },
    click(){
      this.play(()=>{
        const t = this.ctx.currentTime;
        const g = this.ctx.createGain(); g.connect(this.sfxGain);
        const o = this._osc('square', 700, g);
        this._env(g, t, 0.001, 0.03, 0.2, 0.05, 0.1);
        o.start(t); o.stop(t + 0.1);
      });
    },
    achievement(){
      this.play(()=>{
        const t = this.ctx.currentTime;
        const notes = [523, 659, 784, 1046];
        notes.forEach((f,i)=>{
          const g = this.ctx.createGain(); g.connect(this.sfxGain);
          const o = this._osc('triangle', f, g);
          this._env(g, t + i*0.08, 0.005, 0.08, 0.4, 0.2, 0.2);
          o.start(t + i*0.08); o.stop(t + i*0.08 + 0.3);
        });
      });
    },

    // --- ambient music: simple generative arpeggio loop ---
    startMusic(){
      if (!this.ctx) this.init();
      if (!this.ctx || this.musicPlaying) return;
      this.musicPlaying = true;
      const scale = [220, 261.6, 293.7, 329.6, 392, 440, 523.3];
      let step = 0;
      const playStep = () => {
        if (!this.musicPlaying) return;
        const t = this.ctx.currentTime;
        const freq = scale[step % scale.length] * (step % 8 === 0 ? 0.5 : 1);
        const g = this.ctx.createGain(); g.connect(this.musicGain);
        const o = this._osc('sine', freq, g);
        const o2 = this._osc('sine', freq*2, g, 4);
        o2.connect(g);
        this._env(g, t, 0.02, 0.25, 0.2, 0.3, 0.12);
        o.start(t); o2.start(t); o.stop(t+0.6); o2.stop(t+0.6);
        step++;
        this.musicTimer = setTimeout(playStep, 340);
      };
      playStep();
    },
    stopMusic(){
      this.musicPlaying = false;
      if (this.musicTimer) clearTimeout(this.musicTimer);
    }
  };

  window.VesperAudio = Audio2;
})();
