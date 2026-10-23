(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(pointer: fine)").matches;
  const toads = Array.isArray(window.TOADS) ? window.TOADS : [];
  const safeUrl = (u) => (typeof u === "string" && /^https:\/\//.test(u) ? u : "");

  function link(text, href) {
    const url = safeUrl(href);
    if (!url) return document.createTextNode(text);
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = text;
    return a;
  }

  /* ===================== Звук «ква» (Web Audio, без файлов) ===================== */
  let audio = null;
  function croakSound() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      const t0 = audio.currentTime;
      for (let k = 0; k < 2; k++) {
        const st = t0 + k * 0.32;
        const osc = audio.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(150 - k * 15, st);
        osc.frequency.exponentialRampToValueAtTime(75, st + 0.26);

        // «рокот» жабьего горла: быстрая амплитудная модуляция
        const am = audio.createGain();
        am.gain.value = 0.5;
        const lfo = audio.createOscillator();
        lfo.type = "square";
        lfo.frequency.value = 36;
        const lfoGain = audio.createGain();
        lfoGain.gain.value = 0.5;
        lfo.connect(lfoGain).connect(am.gain);

        const filter = audio.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = 650;
        filter.Q.value = 1.8;

        const env = audio.createGain();
        env.gain.setValueAtTime(0.0001, st);
        env.gain.exponentialRampToValueAtTime(0.6, st + 0.03);
        env.gain.exponentialRampToValueAtTime(0.0001, st + 0.28);

        osc.connect(am).connect(filter).connect(env).connect(audio.destination);
        osc.start(st);
        osc.stop(st + 0.3);
        lfo.start(st);
        lfo.stop(st + 0.3);
      }
    } catch {
      /* звук не обязателен */
    }
  }

  /* ===================== 3D-жаба ===================== */
  const toadApi = initToad();

  function initToad() {
    const stage = $("#stage");
    const view = stage.querySelector(".stage-view");
    const canvas = $("#toad3d");

    let renderer;
    try {
      if (typeof THREE === "undefined") throw new Error("no three");
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      stage.classList.add("no-gl");
      $("#no-webgl").hidden = false;
      return null;
    }

    const PI = Math.PI;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    const target = new THREE.Vector3(0, 1.0, 0);

    // Свет
    scene.add(new THREE.HemisphereLight(0xe4ffd6, 0x183020, 1.5));
    const sun = new THREE.DirectionalLight(0xfff1d0, 2.8);
    sun.position.set(4, 8, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 25 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x8fffd8, 1.4);
    rim.position.set(-5, 3, -6);
    scene.add(rim);

    // Пятнистая текстура кожи
    function skinTexture(base, spot, count) {
      const c = document.createElement("canvas");
      c.width = 512;
      c.height = 256;
      const g = c.getContext("2d");
      g.fillStyle = base;
      g.fillRect(0, 0, 512, 256);
      for (let i = 0; i < count; i++) {
        const r = 6 + Math.random() * 22;
        g.globalAlpha = 0.2 + Math.random() * 0.4;
        g.fillStyle = spot;
        g.beginPath();
        g.ellipse(Math.random() * 512, Math.random() * 256, r * 1.4, r, Math.random() * PI, 0, PI * 2);
        g.fill();
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    const mat = {
      skin: new THREE.MeshStandardMaterial({ map: skinTexture("#7fa646", "#4c6a22", 80), roughness: 0.6 }),
      belly: new THREE.MeshStandardMaterial({ color: 0xf0e3aa, roughness: 0.7 }),
      wart: new THREE.MeshStandardMaterial({ color: 0xa08c3e, roughness: 0.8 }),
      eye: new THREE.MeshStandardMaterial({ color: 0xf2b62a, roughness: 0.15, metalness: 0.1, emissive: 0x3a2400, emissiveIntensity: 0.4 }),
      pupil: new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.1 }),
      shine: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      dark: new THREE.MeshStandardMaterial({ color: 0x24330f, roughness: 0.6 }),
      throat: new THREE.MeshStandardMaterial({ color: 0xf5e7b2, roughness: 0.3 }),
    };

    const sph = new THREE.SphereGeometry(1, 48, 32);
    const sphLow = new THREE.SphereGeometry(1, 16, 12);

    function blob(m, pos, scale, parent, geo = sph) {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.scale.set(scale[0], scale[1], scale[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    }

    // Бородавки: случайные точки на поверхности единичной сферы-родителя
    function addWarts(parent, count, minY, skip) {
      const inst = new THREE.InstancedMesh(sphLow, mat.wart, count);
      const dummy = new THREE.Object3D();
      const color = new THREE.Color();
      let i = 0;
      while (i < count) {
        const u = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
        if (u.lengthSq() > 1 || u.lengthSq() < 0.01) continue;
        u.normalize();
        if (u.y < minY || (skip && skip(u))) continue;
        dummy.position.copy(u).multiplyScalar(0.99);
        dummy.scale.setScalar(0.03 + Math.random() * 0.045);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
        inst.setColorAt(i, color.setHSL(0.13 + Math.random() * 0.05, 0.45, 0.32 + Math.random() * 0.12));
        i++;
      }
      parent.add(inst);
    }

    const toad = new THREE.Group();
    scene.add(toad);

    // Толстое туловище (дышит)
    const torso = new THREE.Group();
    toad.add(torso);
    const body = blob(mat.skin, [0, 1.0, -0.1], [1.4, 1.0, 1.25], torso);
    blob(mat.belly, [0, 0.78, 0.35], [1.15, 0.72, 0.95], torso);
    addWarts(body, 110, -0.15, (u) => u.z > 0.45 && u.y < 0.35);

    // Голова
    const head = new THREE.Group();
    head.position.set(0, 1.45, 0.75);
    toad.add(head);
    const headMesh = blob(mat.skin, [0, 0, 0], [1.1, 0.68, 0.9], head);
    blob(mat.belly, [0, -0.25, 0.15], [1.0, 0.42, 0.78], head);
    addWarts(headMesh, 30, 0.3, (u) => u.z > 0.5);

    // Широкий рот по контуру головы
    const mouth = new THREE.Group();
    mouth.position.y = -0.12;
    mouth.scale.set(1.1, 1, 0.9);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(1, 0.028, 8, 64, PI), mat.dark);
    lip.rotation.x = PI / 2;
    mouth.add(lip);
    head.add(mouth);

    // Ноздри
    for (const s of [-1, 1]) blob(mat.dark, [s * 0.16, 0.28, 0.81], [0.035, 0.025, 0.02], head, sphLow);

    // Глаза
    const eyeBalls = [];
    for (const s of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(s * 0.52, 0.5, 0.42);
      eye.rotation.y = s * 0.45;
      head.add(eye);
      blob(mat.skin, [0, 0, 0], [0.3, 0.3, 0.3], eye);
      const ball = new THREE.Group();
      ball.position.set(0, 0.04, 0.08);
      eye.add(ball);
      blob(mat.eye, [0, 0, 0], [0.25, 0.25, 0.25], ball);
      blob(mat.pupil, [0, 0.01, 0.23], [0.13, 0.06, 0.03], ball);
      blob(mat.shine, [0.07, 0.09, 0.225], [0.035, 0.035, 0.02], ball, sphLow);
      eyeBalls.push(ball);
      // Околоушные железы за глазами
      blob(mat.skin, [s * 0.62, 0.28, -0.12], [0.32, 0.18, 0.45], head);
    }

    // Горловой мешок (раздувается при кваканье)
    const throat = blob(mat.throat, [0, 1.05, 1.25], [0.55, 0.45, 0.5], toad);
    const throatBase = throat.scale.clone();

    // Лапка с пальцами
    function paw(parent, pos, rotY, size) {
      const g = new THREE.Group();
      g.position.set(pos[0], pos[1], pos[2]);
      g.rotation.y = rotY;
      g.scale.setScalar(size);
      parent.add(g);
      blob(mat.skin, [0, 0, 0], [0.3, 0.08, 0.42], g);
      for (let k = 0; k < 4; k++) {
        const a = (k - 1.5) * 0.38;
        const toe = blob(mat.skin, [Math.sin(a) * 0.45, 0, Math.cos(a) * 0.45], [0.06, 0.045, 0.2], g, sphLow);
        toe.rotation.y = a;
        blob(mat.belly, [Math.sin(a) * 0.64, 0, Math.cos(a) * 0.64], [0.065, 0.05, 0.065], g, sphLow);
      }
    }

    for (const s of [-1, 1]) {
      // Задние лапы: мощные бёдра по бокам
      const thigh = blob(mat.skin, [s * 1.15, 0.55, -0.45], [0.5, 0.48, 0.8], toad);
      thigh.rotation.y = s * 0.3;
      paw(toad, [s * 1.45, 0.06, 0.2], s * 0.5, 1.1);

      // Передние лапы
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.6, 8, 16), mat.skin);
      arm.position.set(s * 0.85, 0.5, 1.0);
      arm.rotation.set(-0.3, 0, s * 0.25);
      arm.castShadow = true;
      toad.add(arm);
      paw(toad, [s * 0.98, 0.04, 1.2], s * 0.35, 0.75);
    }

    // Кувшинка
    function makePad(radius) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.absarc(0, 0, radius, PI / 2 + 0.25, PI / 2 - 0.25 + PI * 2, false);
      shape.lineTo(0, 0);
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.04, bevelSegments: 2, curveSegments: 64,
      });
      geo.rotateX(-PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x2f8f3a, roughness: 0.5 }));
      m.position.y = -0.12;
      m.receiveShadow = true;
      m.castShadow = true;
      return m;
    }

    const R = 2.7;
    const pad = makePad(R);
    scene.add(pad);
    const veinMat = new THREE.MeshStandardMaterial({ color: 0x5cb85c, roughness: 0.6 });
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * PI * 2;
      if (Math.abs(a - PI) < 0.45) continue;
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, R * 0.9), veinMat);
      v.position.set(Math.sin(a) * R * 0.45, 0.015, Math.cos(a) * R * 0.45);
      v.rotation.y = a;
      v.receiveShadow = true;
      scene.add(v);
    }

    const smallPad1 = makePad(1);
    smallPad1.position.set(3.7, -0.12, 1.4);
    smallPad1.rotation.y = 1.2;
    scene.add(smallPad1);
    const smallPad2 = makePad(1.3);
    smallPad2.position.set(-3.6, -0.12, -1.6);
    smallPad2.rotation.y = -2;
    scene.add(smallPad2);

    // Цветок лотоса на маленькой кувшинке
    const flower = new THREE.Group();
    flower.position.set(-3.6, 0.05, -1.6);
    const petalMat = new THREE.MeshStandardMaterial({ color: 0xff9ecb, roughness: 0.45 });
    for (let layer = 0; layer < 2; layer++) {
      for (let k = 0; k < 8; k++) {
        const holder = new THREE.Group();
        holder.rotation.y = (k / 8) * PI * 2 + layer * 0.4;
        const p = blob(petalMat, [0, 0.12, 0.22 - layer * 0.06], [0.12, 0.05, 0.3 - layer * 0.06], holder);
        p.rotation.x = -0.5 - layer * 0.45;
        flower.add(holder);
      }
    }
    blob(new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.5 }), [0, 0.18, 0], [0.12, 0.08, 0.12], flower);
    scene.add(flower);

    // Вода с мягко тающим краем
    const fade = document.createElement("canvas");
    fade.width = fade.height = 256;
    const fg = fade.getContext("2d");
    const grad = fg.createRadialGradient(128, 128, 20, 128, 128, 128);
    grad.addColorStop(0, "#fff");
    grad.addColorStop(0.6, "#bbb");
    grad.addColorStop(1, "#000");
    fg.fillStyle = grad;
    fg.fillRect(0, 0, 256, 256);
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(7, 64),
      new THREE.MeshStandardMaterial({
        color: 0x0d4a3e, roughness: 0.15, metalness: 0.2,
        transparent: true, alphaMap: new THREE.CanvasTexture(fade), depthWrite: false,
      })
    );
    water.rotation.x = -PI / 2;
    water.position.y = -0.1;
    water.receiveShadow = true;
    scene.add(water);

    // Мухи, кружащие вокруг жабы
    const flies = [];
    const wingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
    for (let k = 0; k < 2; k++) {
      const fly = new THREE.Group();
      blob(mat.pupil, [0, 0, 0], [0.07, 0.06, 0.1], fly, sphLow);
      const wings = [];
      for (const s of [-1, 1]) {
        const w = new THREE.Group();
        w.position.y = 0.04;
        const wing = new THREE.Mesh(sphLow, wingMat);
        wing.scale.set(0.11, 0.01, 0.05);
        wing.position.x = s * 0.1;
        w.add(wing);
        w.userData.side = s;
        fly.add(w);
        wings.push(w);
      }
      fly.userData = { wings, phase: k * PI, speed: 0.9 + k * 0.35, radius: 2.3 + k * 0.6 };
      scene.add(fly);
      flies.push(fly);
    }

    // Круги на воде после прыжка
    const ripples = [];
    const rippleGeo = new THREE.RingGeometry(0.98, 1, 72);
    function spawnRipple(time) {
      const m = new THREE.Mesh(
        rippleGeo,
        new THREE.MeshBasicMaterial({ color: 0xc6ffe6, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
      );
      m.rotation.x = -PI / 2;
      m.position.y = -0.07;
      m.userData.t0 = time;
      scene.add(m);
      ripples.push(m);
    }

    /* ----- Управление камерой ----- */
    const ctl = { yaw: 0.55, pitch: 0.3, dist: 9, tYaw: 0.55, tPitch: 0.3, tDist: 9 };
    const MIN_D = 4.5;
    const MAX_D = 15;
    let lastInteract = -10;
    let time = 0;
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

    function resize() {
      const w = view.clientWidth;
      const h = view.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    // На узких экранах отодвигаем камеру, чтобы кувшинка влезла
    ctl.dist = ctl.tDist = clamp(9 * Math.max(1, 1.1 / camera.aspect), MIN_D, MAX_D);
    new ResizeObserver(resize).observe(view);

    const pointers = new Map();
    let downPos = null;
    let moved = 0;
    let pinchStart = 0;
    let pinchDist = 0;

    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.classList.add("grabbing");
      lastInteract = time;
      if (pointers.size === 1) {
        downPos = { x: e.clientX, y: e.clientY };
        moved = 0;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
        pinchDist = ctl.tDist;
        moved = 99;
      }
    });

    canvas.addEventListener("pointermove", (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      prev.x = e.clientX;
      prev.y = e.clientY;
      lastInteract = time;
      if (pointers.size === 1) {
        moved += Math.abs(dx) + Math.abs(dy);
        ctl.tYaw -= dx * 0.008;
        ctl.tPitch = clamp(ctl.tPitch + dy * 0.006, 0.02, 1.25);
      } else if (pointers.size === 2 && pinchStart) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        ctl.tDist = clamp(pinchDist * (pinchStart / d), MIN_D, MAX_D);
      }
    });

    function endPointer(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = 0;
      if (pointers.size === 0) {
        canvas.classList.remove("grabbing");
        if (e.type === "pointerup" && moved < 6 && downPos) tryPoke(e);
        downPos = null;
      }
    }
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);

    canvas.addEventListener(
      "wheel",
      (e) => {
        const next = clamp(ctl.tDist * (e.deltaY > 0 ? 1.1 : 0.9), MIN_D, MAX_D);
        if (Math.abs(next - ctl.tDist) < 0.001) return; // на пределе отдаём скролл странице
        e.preventDefault();
        ctl.tDist = next;
        lastInteract = time;
      },
      { passive: false }
    );

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    function tryPoke(e) {
      const r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.intersectObject(toad, true).length) croak();
    }

    /* ----- Кваканье и прыжок ----- */
    const bubble = $("#bubble");
    let croakStart = -10;
    let jumpStart = -10;
    let landed = true;

    function croak() {
      if (time - croakStart < 0.8) return;
      croakStart = time;
      jumpStart = time;
      landed = false;
      lastInteract = time;
      croakSound();
      bubble.classList.remove("show");
      void bubble.offsetWidth;
      bubble.classList.add("show");
    }

    $("#croak").addEventListener("click", croak);
    $("#rot-left").addEventListener("click", () => {
      ctl.tYaw += PI / 3;
      lastInteract = time;
    });
    $("#rot-right").addEventListener("click", () => {
      ctl.tYaw -= PI / 3;
      lastInteract = time;
    });

    /* ----- Анимация ----- */
    let visible = true;
    new IntersectionObserver(([en]) => (visible = en.isIntersecting)).observe(view);

    const clock = new THREE.Clock();
    let nextBlink = 2;
    const idle = reduceMotion ? 0 : 1;

    function animate() {
      requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      if (!visible) return;
      time += dt;
      const t = time;

      // Камера с плавным догоном и авто-вращением в простое
      if (!reduceMotion && t - lastInteract > 3 && pointers.size === 0) ctl.tYaw += dt * 0.22;
      ctl.yaw += (ctl.tYaw - ctl.yaw) * 0.1;
      ctl.pitch += (ctl.tPitch - ctl.pitch) * 0.1;
      ctl.dist += (ctl.tDist - ctl.dist) * 0.1;
      camera.position.set(
        target.x + ctl.dist * Math.cos(ctl.pitch) * Math.sin(ctl.yaw),
        target.y + ctl.dist * Math.sin(ctl.pitch),
        target.z + ctl.dist * Math.cos(ctl.pitch) * Math.cos(ctl.yaw)
      );
      camera.lookAt(target);

      // Дыхание и лёгкое покачивание головы
      const br = Math.sin(t * 2.2) * idle;
      torso.scale.set(1 + 0.025 * br, 1 + 0.035 * br, 1 + 0.025 * br);
      head.position.y = 1.45 + 0.02 * br;
      head.rotation.y = 0.12 * Math.sin(t * 0.7) * idle;
      head.rotation.z = 0.04 * Math.sin(t * 0.5) * idle;

      // Моргание
      if (t > nextBlink) {
        const p = (t - nextBlink) / 0.16;
        const s = p >= 1 ? 1 : 1 - 0.9 * Math.sin(p * PI);
        for (const b of eyeBalls) b.scale.y = s;
        if (p >= 1) nextBlink = t + 1.5 + Math.random() * 3.5;
      }

      // Горловой мешок: мелкая пульсация, при кваканье раздувается дважды
      let th = 0.3 + 0.05 * Math.sin(t * 7) * idle;
      const ct = t - croakStart;
      if (ct >= 0 && ct < 0.64) th = 0.3 + 0.75 * Math.sin(((ct % 0.32) / 0.32) * PI);
      throat.scale.copy(throatBase).multiplyScalar(th);

      // Прыжок: присед, полёт, приземление
      const jp = (t - jumpStart) / 0.8;
      if (jp >= 0 && jp < 1) {
        if (jp < 0.15) {
          const k = jp / 0.15;
          toad.position.y = 0;
          toad.scale.set(1 + 0.08 * k, 1 - 0.18 * k, 1 + 0.08 * k);
          toad.rotation.x = 0;
        } else if (jp < 0.85) {
          const q = (jp - 0.15) / 0.7;
          const arc = Math.sin(q * PI);
          toad.position.y = 1.3 * arc;
          toad.scale.set(1 - 0.05 * arc, 1 + 0.12 * arc, 1 - 0.05 * arc);
          toad.rotation.x = -0.18 * Math.cos(q * PI);
        } else {
          const k = (jp - 0.85) / 0.15;
          if (!landed) {
            landed = true;
            spawnRipple(t);
            spawnRipple(t + 0.25);
          }
          const sq = Math.sin(k * PI);
          toad.position.y = 0;
          toad.scale.set(1 + 0.1 * sq, 1 - 0.15 * sq, 1 + 0.1 * sq);
          toad.rotation.x = 0.18 * (1 - k);
        }
      } else {
        toad.position.y = 0;
        toad.scale.set(1, 1, 1);
        toad.rotation.x = 0;
      }

      // Мухи
      for (const fly of flies) {
        const d = fly.userData;
        const a = t * d.speed * idle + d.phase;
        fly.position.set(Math.cos(a) * d.radius, 2.5 + 0.35 * Math.sin(t * 3 + d.phase), Math.sin(a) * d.radius * 0.8);
        fly.rotation.y = -a;
        for (const w of d.wings) w.rotation.z = w.userData.side * (0.2 + 0.6 * Math.abs(Math.sin(t * 45)));
      }

      // Круги на воде
      for (let i = ripples.length - 1; i >= 0; i--) {
        const m = ripples[i];
        const k = (t - m.userData.t0) / 1.8;
        if (k < 0) continue;
        if (k >= 1) {
          scene.remove(m);
          m.material.dispose();
          ripples.splice(i, 1);
          continue;
        }
        const s = 2.8 + k * 3.2;
        m.scale.set(s, s, 1);
        m.material.opacity = 0.55 * (1 - k);
      }

      renderer.render(scene, camera);
    }
    animate();

    return { croak };
  }

  /* ===================== Светлячки на фоне ===================== */
  (function fireflies() {
    const canvas = $("#fireflies");
    const ctx = canvas.getContext("2d");
    let w = 0;
    let h = 0;
    let flies = [];

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(60, Math.floor((w * h) / 26000));
      flies = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        p: Math.random() * Math.PI * 2,
        s: 0.6 + Math.random() * 1.6,
      }));
    }

    function draw(now) {
      const t = (now || 0) / 1000;
      ctx.clearRect(0, 0, w, h);
      for (const f of flies) {
        if (!reduceMotion) {
          f.vx += (Math.random() - 0.5) * 0.02;
          f.vy += (Math.random() - 0.5) * 0.02;
          f.vx = Math.max(-0.4, Math.min(0.4, f.vx));
          f.vy = Math.max(-0.4, Math.min(0.4, f.vy));
          f.x = (f.x + f.vx + w) % w;
          f.y = (f.y + f.vy + h) % h;
        }
        const a = reduceMotion ? 0.6 : 0.25 + 0.75 * Math.max(0, Math.sin(t * f.s + f.p));
        ctx.globalAlpha = a * 0.25;
        ctx.fillStyle = "#d9ff6a";
        ctx.beginPath();
        ctx.arc(f.x, f.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = a;
        ctx.fillStyle = "#f6ffb8";
        ctx.beginPath();
        ctx.arc(f.x, f.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (!reduceMotion) requestAnimationFrame(draw);
    }

    resize();
    draw(0);
    window.addEventListener("resize", () => {
      resize();
      if (reduceMotion) draw(0);
    });
  })();

  /* ===================== Лайтбокс ===================== */
  const lb = $("#lightbox");
  const lbImg = $("#lb-img");
  const lbCap = $("#lb-cap");
  let lbIndex = 0;

  function showPhoto(i) {
    if (!toads.length) return;
    lbIndex = (i + toads.length) % toads.length;
    const t = toads[lbIndex];
    lbImg.classList.remove("anim");
    void lbImg.offsetWidth;
    lbImg.src = t.src;
    lbImg.alt = t.name;
    lbImg.classList.add("anim");
    const title = document.createElement("strong");
    title.textContent = t.name;
    lbCap.replaceChildren(
      title,
      document.createTextNode(`Фото: ${t.author} · `),
      link(t.license, t.licenseUrl),
      document.createTextNode(" · "),
      link("источник", t.page)
    );
  }

  function openPhoto(i) {
    showPhoto(i);
    if (!lb.open) lb.showModal();
  }

  $("#lb-close").addEventListener("click", () => lb.close());
  $("#lb-prev").addEventListener("click", () => showPhoto(lbIndex - 1));
  $("#lb-next").addEventListener("click", () => showPhoto(lbIndex + 1));
  lb.addEventListener("click", (e) => {
    if (e.target === lb) lb.close();
  });
  lb.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") showPhoto(lbIndex - 1);
    if (e.key === "ArrowRight") showPhoto(lbIndex + 1);
  });
  let swipeX = null;
  lbImg.addEventListener("pointerdown", (e) => (swipeX = e.clientX));
  lbImg.addEventListener("pointerup", (e) => {
    if (swipeX === null) return;
    const dx = e.clientX - swipeX;
    swipeX = null;
    if (Math.abs(dx) > 50) showPhoto(lbIndex + (dx < 0 ? 1 : -1));
  });
  lbImg.draggable = false;

  /* ===================== 3D-карусель фото ===================== */
  (function carousel() {
    const wrap = $("#ring-wrap");
    const ring = $("#ring");
    const N = toads.length;
    if (!N) return;
    const step = 360 / N;
    let radius = 500;
    let rot = 0;
    let targetRot = 0;
    let dragging = false;
    let dragMoved = false;
    let startX = 0;
    let startRot = 0;
    let lastX = 0;
    let vel = 0;
    let lastInteract = 0;
    let visible = false;

    const items = toads.map((t, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ring-item";
      b.setAttribute("aria-label", `Открыть фото: ${t.name}`);
      const img = document.createElement("img");
      img.src = t.src;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.draggable = false;
      const cap = document.createElement("span");
      cap.textContent = t.name;
      b.append(img, cap);
      b.addEventListener("click", (e) => {
        if (dragMoved) {
          e.preventDefault();
          return;
        }
        openPhoto(i);
      });
      // При навигации с клавиатуры поворачиваем карусель к фото
      b.addEventListener("focus", () => {
        const want = -i * step;
        targetRot = want + Math.round((rot - want) / 360) * 360;
        lastInteract = performance.now();
      });
      ring.append(b);
      return b;
    });

    function layout() {
      const cw = parseFloat(getComputedStyle(wrap).getPropertyValue("--cw")) || 210;
      radius = (cw / 2 / Math.tan(Math.PI / N)) * 1.08 + 10;
      items.forEach((el, i) => {
        el.style.transform = `rotateY(${i * step}deg) translateZ(${radius}px)`;
      });
    }
    layout();
    window.addEventListener("resize", layout);

    wrap.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      dragging = true;
      dragMoved = false;
      startX = lastX = e.clientX;
      startRot = rot;
      vel = 0;
      wrap.classList.add("grabbing");
    });
    window.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 6) dragMoved = true;
      vel = (e.clientX - lastX) * 0.25;
      lastX = e.clientX;
      rot = targetRot = startRot + dx * 0.25;
      lastInteract = performance.now();
    });
    function release() {
      if (!dragging) return;
      dragging = false;
      wrap.classList.remove("grabbing");
      targetRot = Math.round((rot + vel * 10) / step) * step;
      lastInteract = performance.now();
    }
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);

    $("#ring-prev").addEventListener("click", () => {
      targetRot = Math.round(targetRot / step) * step + step;
      lastInteract = performance.now();
    });
    $("#ring-next").addEventListener("click", () => {
      targetRot = Math.round(targetRot / step) * step - step;
      lastInteract = performance.now();
    });

    new IntersectionObserver(([en]) => (visible = en.isIntersecting)).observe(wrap);

    let lastAuto = 0;
    function frame(now) {
      requestAnimationFrame(frame);
      if (!visible) return;
      if (!dragging) {
        if (!reduceMotion && now - lastInteract > 4000 && now - lastAuto > 2600) {
          targetRot -= step;
          lastAuto = now;
        }
        rot += (targetRot - rot) * (reduceMotion ? 1 : 0.08);
      }
      ring.style.transform = `translateZ(${-radius}px) rotateY(${rot}deg)`;
      items.forEach((el, i) => {
        const c = Math.cos(((i * step + rot) * Math.PI) / 180);
        el.style.opacity = (0.12 + 0.88 * Math.pow((c + 1) / 2, 1.6)).toFixed(3);
        el.style.pointerEvents = c < -0.2 ? "none" : "";
      });
    }
    requestAnimationFrame(frame);
  })();

  /* ===================== Галерея и авторы ===================== */
  const masonry = $("#masonry");
  const credits = $("#credits-list");
  toads.forEach((t, i) => {
    const fig = document.createElement("figure");
    fig.className = "tile reveal";
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", `Открыть фото: ${t.name}`);
    const img = document.createElement("img");
    img.src = t.src;
    img.alt = t.name;
    img.loading = "lazy";
    img.decoding = "async";
    if (t.w && t.h) {
      img.width = t.w;
      img.height = t.h;
    }
    const cap = document.createElement("span");
    cap.className = "cap";
    cap.textContent = t.name;
    b.append(img, cap);
    b.addEventListener("click", () => openPhoto(i));
    fig.append(b);
    masonry.append(fig);

    const li = document.createElement("li");
    li.append(
      document.createTextNode(`${t.name}: ${t.author}, `),
      link(t.license, t.licenseUrl),
      document.createTextNode(", "),
      link("источник", t.page)
    );
    credits.append(li);
  });
  $("#photo-count").dataset.count = String(toads.length);

  /* ===================== Появление при скролле и счётчики ===================== */
  function countUp(el) {
    const target = Number(el.dataset.count);
    const dec = Number(el.dataset.decimals || 0);
    const fmt = (v) => v.toLocaleString("ru-RU", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    if (reduceMotion || target === 0) {
      el.textContent = fmt(target);
      return;
    }
    const start = performance.now();
    (function step(now) {
      const k = Math.min((now - start) / 1600, 1);
      const eased = 1 - Math.pow(1 - k, 3);
      const v = target * eased;
      el.textContent = fmt(dec ? v : Math.round(v));
      if (k < 1) requestAnimationFrame(step);
    })(start);
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("visible");
        entry.target.querySelectorAll("[data-count]").forEach(countUp);
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.12 }
  );
  document.querySelectorAll(".reveal").forEach((el, i) => {
    el.style.transitionDelay = `${(i % 4) * 0.08}s`;
    observer.observe(el);
  });

  /* ===================== Наклон карточек и магнитные кнопки ===================== */
  if (finePointer && !reduceMotion) {
    document.querySelectorAll(".tilt").forEach((card) => {
      card.addEventListener("pointermove", (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        card.style.transform = `perspective(800px) rotateX(${(0.5 - y) * 12}deg) rotateY(${(x - 0.5) * 12}deg) translateY(-4px)`;
        card.style.setProperty("--mx", `${x * 100}%`);
        card.style.setProperty("--my", `${y * 100}%`);
      });
      card.addEventListener("pointerleave", () => (card.style.transform = ""));
    });

    document.querySelectorAll(".magnetic").forEach((btn) => {
      btn.addEventListener("pointermove", (e) => {
        const r = btn.getBoundingClientRect();
        btn.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.25}px, ${(e.clientY - r.top - r.height / 2) * 0.35}px)`;
      });
      btn.addEventListener("pointerleave", () => (btn.style.transform = ""));
    });
  }

  // Клик по логотипу: жаба квакает
  $(".logo").addEventListener("click", () => toadApi && toadApi.croak());

  $("#year").textContent = new Date().getFullYear();
})();
