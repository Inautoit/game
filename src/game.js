import * as THREE from 'three';
import { MODES, TIMES, SCORE, PLAYER, DRAW_DISTANCE, roadHalfWidth } from './config.js';
import { Road } from './road.js';
import { Traffic } from './traffic.js';
import { makeEnvironment } from './sky.js';

const STATE = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', OVER: 'over' };

export class Game {
  constructor({ renderer, scene, camera, player, input, sound, ui }) {
    Object.assign(this, { renderer, scene, camera, player, input, sound, ui });

    this.state = STATE.MENU;
    this.road = new Road(scene);
    this.traffic = new Traffic(scene);

    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x4a5a46, 1);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff4dd, 1.3);
    this.sun.position.set(-40, 70, 60);
    scene.add(this.sun);

    this.distance = 0;
    this.score = 0;
    this.overtakes = 0;
    this.nearMisses = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.shake = 0;
    this.overDelay = 0;
    this.menuAngle = 0;

    this.mode = MODES[ui.settings.mode];
    this.time = TIMES[ui.settings.time];
    this.applyTime(this.time);
    this.rebuild();
  }

  // Reconstruye carretera y decorado (al cambiar de modo o de hora).
  rebuild() {
    this.road.build(this.mode, this.time, this.renderer);
    this.traffic.reset(this.mode);
    this.roadHalf = roadHalfWidth(this.mode);
  }

  setMode(id) {
    this.mode = MODES[id];
    this.rebuild();
    if (this.state === STATE.MENU) this.player.reset(0);
  }

  setTime(id) {
    this.time = TIMES[id];
    this.applyTime(this.time);
    this.road.build(this.mode, this.time, this.renderer);
  }

  applyTime(t) {
    this.envRT?.dispose();
    this.envRT = makeEnvironment(this.renderer, t);
    this.scene.environment = this.envRT.texture;
    this.player.setEnvIntensity(t.id === 'night' ? 0.45 : 1);
    this.scene.background = new THREE.Color(t.sky);
    this.scene.fog = new THREE.Fog(t.fog, t.fogNear, Math.min(t.fogFar, DRAW_DISTANCE));
    this.hemi.color.setHex(t.hemiSky);
    this.hemi.groundColor.setHex(t.hemiGround);
    this.hemi.intensity = t.hemiInt;
    this.sun.color.setHex(t.sunColor);
    this.sun.intensity = t.sunInt;
    this.player.setNight(t.headlights);
    this.traffic.setNight(t.headlights);
    this.road.setTime?.(t);
  }

  bestKey() { return 'urus:best:' + this.mode.id; }
  get best() {
    try { return Number(localStorage.getItem(this.bestKey()) || 0); } catch { return 0; }
  }
  set best(v) {
    try { localStorage.setItem(this.bestKey(), String(Math.floor(v))); } catch { /* ignorar */ }
  }

  // ------------------------------------------------------------------ flujo
  toMenu() {
    this.state = STATE.MENU;
    this.player.reset(0);
    this.traffic.reset(this.mode);
    this.road.update(0);
    this.menuAngle = 0.7;
    this.sound.setActive(false);
    this.ui.showMenu(this.best);
  }

  start() {
    this.state = STATE.PLAYING;
    this.distance = 0;
    this.score = 0;
    this.overtakes = 0;
    this.nearMisses = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.shake = 0;
    this.overDelay = 0;
    this.player.reset(this.mode.lanes[this.mode.startLane].x);
    this.player.speed = 22;
    this.traffic.reset(this.mode);
    this.traffic.prefill();
    this.input.reset();
    this.input.recenterTilt();
    this.ui.resetHud();
    this.ui.showGame();
    this.sound.start();
    this.sound.resume();
    this.sound.setActive(true);
    this.camera.fov = 58;
    this.camera.updateProjectionMatrix();
  }

  pause(on) {
    if (on && this.state !== STATE.PLAYING) return;
    if (!on && this.state !== STATE.PAUSED) return;
    this.state = on ? STATE.PAUSED : STATE.PLAYING;
    this.input.reset();
    this.sound.setActive(!on);
    this.ui.showPause(on);
  }

  // ------------------------------------------------------------------ bucle
  update(dt) {
    if (this.state === STATE.MENU) return this._menuFrame(dt);
    if (this.state === STATE.PAUSED) return;

    this.input.update();

    if (this.state === STATE.PLAYING && this.input.consumeNitro() && this.player.tryNitro()) {
      this.sound.nitro();
      this.ui.toast('¡NITRO!', 'big');
    }

    this.player.update(dt, this.input, this.roadHalf);
    this.distance += this.player.speed * dt;
    this.road.update(this.distance);
    this.traffic.update(dt, this.player.speed, this.distance);

    if (this.state === STATE.PLAYING) {
      this._scoring(dt);
      this._collisions();
    } else if (this.state === STATE.OVER) {
      this.overDelay -= dt;
      if (this.overDelay <= 0 && !this._overShown) this._showOver();
    }

    this._updateCamera(dt);
    this._updateHud();
    this._updateSound();
  }

  _menuFrame(dt) {
    // Vuelta de presentación alrededor del coche.
    this.menuAngle += dt * 0.3;
    if (this.camera.fov !== 42) {
      this.camera.fov = 42;
      this.camera.updateProjectionMatrix();
    }
    // En vertical el campo horizontal es estrechísimo: calculamos la distancia
    // para que el coche entre en pantalla en cualquier móvil.
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hHalf = Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const r = THREE.MathUtils.clamp(2.35 / Math.tan(hHalf), 8, 15);
    this.camera.position.set(
      Math.sin(this.menuAngle) * r,
      2.9 + Math.sin(this.menuAngle * 0.7) * 0.6,
      Math.cos(this.menuAngle) * r,
    );
    this.camera.lookAt(0, 0.55, 0);
    this.player._spinWheels(dt * 0.12, 0);
  }

  _scoring(dt) {
    const fast = this.player.speed > SCORE.fastBonusSpeed ? 2 : 1;
    this.score += this.player.speed * dt * SCORE.perMeter * fast * this.mode.scoreMult;

    for (const pass of this.traffic.collectPasses(this.player.x, this.player.halfWidth)) {
      this.overtakes++;
      let pts = SCORE.overtake;
      if (pass.near) {
        this.nearMisses++;
        this.combo++;
        this.comboTimer = 2.4;
        pts += SCORE.nearMiss * (pass.oncoming ? 2 : 1);
        this.player.addNitro(SCORE.nitroPerNearMiss);
        this.sound.nearMiss();
        this.ui.toast(this.combo > 1 ? `¡AL LÍMITE x${this.combo}!` : '¡AL LÍMITE!', 'near');
      } else {
        this.player.addNitro(SCORE.nitroPerOvertake);
        this.sound.overtake();
      }
      this.score += pts * (1 + this.combo * 0.15) * this.mode.scoreMult;
    }

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
  }

  _collisions() {
    const hit = this.traffic.hitTest(this.player.x, this.player.halfWidth, this.player.halfLength);
    if (!hit) return;
    this.player.crash(Math.sign(this.player.x - hit.x) * (0.4 + Math.random() * 0.5));
    this.sound.crash();
    this.sound.setActive(false);
    this.ui.flash();
    this.shake = 1;
    this.state = STATE.OVER;
    this.overDelay = 1.5;
    this._overShown = false;
    if (navigator.vibrate) navigator.vibrate([40, 60, 120]);
  }

  _showOver() {
    this._overShown = true;
    const best = this.best;
    const newBest = this.score > best;
    if (newBest) this.best = this.score;
    this.ui.showOver({
      title: '¡Choque!',
      score: this.score,
      distance: this.distance,
      overtakes: this.overtakes,
      nearMisses: this.nearMisses,
      best: Math.max(best, this.score),
      newBest,
    });
  }

  _updateCamera(dt) {
    const p = this.player;
    const sp = p.speed / PLAYER.maxSpeed;
    const back = 8.3 + sp * 1.7;
    const height = 2.95 + sp * 0.4;

    const targetX = p.x * 0.88;
    this._camX = this._camX ?? targetX;
    this._camX += (targetX - this._camX) * Math.min(1, dt * 5.5);

    this.camera.position.set(this._camX, height, -back);
    this.camera.position.y += Math.min(0.12, sp * 0.05) * Math.sin(performance.now() * 0.012);

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.4);
      const s = this.shake * this.shake * 0.9;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }

    this.camera.lookAt(p.x * 0.94, 1.45, 13);

    const wantFov = 58 + sp * 14 + (p.nitroActive > 0 ? 8 : 0);
    if (Math.abs(this.camera.fov - wantFov) > 0.05) {
      this.camera.fov += (wantFov - this.camera.fov) * Math.min(1, dt * 3.2);
      this.camera.updateProjectionMatrix();
    }
  }

  _updateHud() {
    this.ui.setScore(this.score);
    this.ui.setDistance(this.distance);
    this.ui.setSpeed(this.player.speedKmh);
    const pct = (this.player.nitro / PLAYER.nitroMax) * 100;
    this.ui.setNitro(pct, this.player.nitro >= PLAYER.nitroMax * 0.35 && this.player.nitroActive <= 0);
  }

  _updateSound() {
    const ratio = Math.min(1, this.player.speed / PLAYER.maxSpeed);
    this.sound.engine(ratio, this.input.throttle > 0 ? 1 : 0, this.player.nitroActive > 0);
  }
}

export { STATE };
