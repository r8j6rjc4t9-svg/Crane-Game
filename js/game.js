(function () {
'use strict';

var DEG = Math.PI / 180;

// ---------------------------------------------------------------- config
var BOOM_BASE_LEN = 12;          // metres, base (non-telescoping) section
var TELE_SECTIONS = 4;
var TELE_SECTION_LEN = 12;       // each telescoping section
var TELE_MAX = TELE_SECTIONS * TELE_SECTION_LEN;
var ROPE_MIN = 2.5;
var GRAB_RADIUS = 2.8;
var GRAV = 15;

var PADS = [
  { name: 'A', pos: new THREE.Vector3(13, 0, 9) },
  { name: 'B', pos: new THREE.Vector3(-15, 0, 11) },
  { name: 'C', pos: new THREE.Vector3(5, 0, -17) }
];
var ZONES = [
  { name: 'RED',    color: 0xff3b30, pos: new THREE.Vector3(19, 0, -11) },
  { name: 'GREEN',  color: 0x34c759, pos: new THREE.Vector3(-18, 0, -13) },
  { name: 'BLUE',   color: 0x0a84ff, pos: new THREE.Vector3(-2, 0, 22) }
];
var ZONE_RADIUS = 4.2;

var CARGO_TYPES = [
  { name: 'CONTAINER', mass: 18, size: [6.0, 2.5, 2.4], color: 0xc0392b, kind: 'container' },
  { name: 'CRATE',     mass: 6,  size: [1.9, 1.9, 1.9], color: 0x9b6a33, kind: 'crate' },
  { name: 'CONCRETE BLOCK', mass: 24, size: [2.4, 1.4, 1.8], color: 0x9aa0a6, kind: 'block' },
  { name: 'STEEL BEAM', mass: 12, size: [8.0, 0.6, 0.6], color: 0x5d6d7e, kind: 'beam' }
];

// ---------------------------------------------------------------- state
var state = {
  started: false,
  muted: false,
  slew: 0,
  boomAngle: 62 * DEG,
  tele: 0,
  rope: 11,
  outriggers: 0,          // 0 = up, 1 = down (animated)
  camMode: 0,             // 0 orbit, 1 cab, 2 hook
  phase: 'idle',          // idle -> pickup -> carry -> done
  carrying: null,
  cargo: null,            // active mission cargo mesh
  mission: null,
  missionNum: 0,
  missionTime: 0,
  score: 0,
  deliveries: 0,
  combo: 1,
  lastDeliveryAt: -999,
  overload: 0,
  elapsed: 0
};
try { state.best = parseInt(localStorage.getItem('liebherr_best') || '0', 10) || 0; }
catch (e) { state.best = 0; }

var keys = {};

// ---------------------------------------------------------------- renderer / scene
var renderer, scene, camera, controls;
var sunLight;

function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.getElementById('game').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = makeSkyTexture();
  scene.fog = new THREE.Fog(0xa8c6de, 140, 460);

  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(28, 17, 28);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 6, 0);
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 6;
  controls.maxDistance = 220;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  var hemi = new THREE.HemisphereLight(0xcfe4ff, 0x8a7f66, 0.85);
  scene.add(hemi);

  // image-based lighting: a small procedural equirect env map for PBR reflections
  var pmrem = new THREE.PMREMGenerator(renderer);
  var envTex = pmrem.fromEquirectangular(makeEnvTexture()).texture;
  scene.environment = envTex;

  sunLight = new THREE.DirectionalLight(0xfff1d6, 1.35);
  sunLight.position.set(60, 95, 35);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  var s = 95;
  sunLight.shadow.camera.left = -s; sunLight.shadow.camera.right = s;
  sunLight.shadow.camera.top = s; sunLight.shadow.camera.bottom = -s;
  sunLight.shadow.camera.near = 10; sunLight.shadow.camera.far = 300;
  sunLight.shadow.bias = -0.0006;
  scene.add(sunLight);
  scene.add(sunLight.target);
  sunLight.target.position.set(0, 0, 0);

  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ---------------------------------------------------------------- materials / helpers
function std(color, opts) {
  var m = new THREE.MeshStandardMaterial(Object.assign({ color: color, roughness: 0.55, metalness: 0.25 }, opts || {}));
  return m;
}

var LIEBHERR_YELLOW = 0xffc400;
var DARK = 0x22262b;

function box(w, h, d, mat) {
  var mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cyl(rt, rb, h, mat, seg) {
  var mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 16), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeTextTexture(text, opts) {
  opts = opts || {};
  var c = document.createElement('canvas');
  c.width = opts.w || 512; c.height = opts.h || 128;
  var g = c.getContext('2d');
  g.fillStyle = opts.bg || '#ffc400';
  g.fillRect(0, 0, c.width, c.height);
  if (opts.stripes) {
    g.fillStyle = opts.stripeColor || 'rgba(0,0,0,0.18)';
    for (var x = 0; x < c.width; x += 42) g.fillRect(x, 0, 18, c.height);
  }
  g.fillStyle = opts.fg || '#1a1a1a';
  g.font = 'bold ' + (opts.font || 64) + 'px Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2);
  var tex = new THREE.CanvasTexture(c);
  tex.encoding = THREE.sRGBEncoding;
  tex.anisotropy = 4;
  return tex;
}

function makeSkyTexture() {
  var c = document.createElement('canvas');
  c.width = 16; c.height = 512;
  var g = c.getContext('2d');
  var grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.0, '#2e6fb8');
  grad.addColorStop(0.45, '#7fb2e0');
  grad.addColorStop(0.72, '#bcd6e8');
  grad.addColorStop(1.0, '#dfeaf0');
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 512);
  var tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

function makeEnvTexture() {
  var c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  var g = c.getContext('2d');
  var grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0.0, '#9ec8ee');
  grad.addColorStop(0.55, '#d8e7f2');
  grad.addColorStop(0.62, '#8f8a76');
  grad.addColorStop(1.0, '#5c584c');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 128);
  // sun blob for specular highlights
  var sun = g.createRadialGradient(190, 28, 2, 190, 28, 26);
  sun.addColorStop(0, 'rgba(255,250,230,1)');
  sun.addColorStop(1, 'rgba(255,250,230,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, 256, 128);
  var tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

function makeGroundTexture() {
  var c = document.createElement('canvas');
  c.width = c.height = 512;
  var g = c.getContext('2d');
  g.fillStyle = '#43464d';
  g.fillRect(0, 0, 512, 512);
  // gravel speckle
  for (var i = 0; i < 5200; i++) {
    var v = 58 + Math.random() * 34;
    g.fillStyle = 'rgb(' + (v | 0) + ',' + ((v + 2) | 0) + ',' + ((v + 7) | 0) + ')';
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  // tire tracks / stains
  for (var s2 = 0; s2 < 26; s2++) {
    g.fillStyle = 'rgba(20,20,24,' + (0.04 + Math.random() * 0.08) + ')';
    g.beginPath();
    g.ellipse(Math.random() * 512, Math.random() * 512, 12 + Math.random() * 40, 8 + Math.random() * 26, Math.random() * 3, 0, 7);
    g.fill();
  }
  // tile grid
  g.strokeStyle = 'rgba(255,255,255,0.07)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, 510, 510);
  // centerline
  g.strokeStyle = 'rgba(255,196,0,0.5)';
  g.lineWidth = 5;
  g.setLineDash([26, 20]);
  g.beginPath(); g.moveTo(256, 0); g.lineTo(256, 512); g.stroke();
  g.setLineDash([]);
  var tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 12);
  tex.encoding = THREE.sRGBEncoding;
  tex.anisotropy = 8;
  return tex;
}

function makeBuildingTexture(base, win) {
  var c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  var g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 256);
  for (var y = 8; y < 250; y += 22) {
    for (var x = 8; x < 122; x += 20) {
      g.fillStyle = Math.random() < 0.55 ? win : 'rgba(15,20,26,0.9)';
      g.fillRect(x, y, 12, 14);
    }
  }
  var tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

// ---------------------------------------------------------------- environment
function buildEnvironment() {
  var ground = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshStandardMaterial({ map: makeGroundTexture(), roughness: 0.95, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  var pad = box(24, 0.3, 17, std(0x565b63, { roughness: 0.9 }));
  pad.position.y = 0.15;
  pad.receiveShadow = true;
  scene.add(pad);

  var buildingPalettes = [
    ['#8d99a6', '#cfe4f5'], ['#6e7b8a', '#b8d4e8'], ['#a6958d', '#e8e0c8'], ['#7d8a99', '#d0e0ec']
  ];
  for (var i = 0; i < 14; i++) {
    var ang = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
    var dist = 95 + Math.random() * 120;
    var w = 14 + Math.random() * 18, h = 12 + Math.random() * 40, d = 14 + Math.random() * 18;
    var pal = buildingPalettes[i % buildingPalettes.length];
    var tex = makeBuildingTexture(pal[0], pal[1]);
    tex.repeat.set(Math.max(1, Math.round(w / 8)), Math.max(1, Math.round(h / 22)));
    var b = box(w, h, d, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.05 }));
    b.position.set(Math.cos(ang) * dist, h / 2, Math.sin(ang) * dist);
    scene.add(b);
    var roof = box(w + 0.4, 0.5, d + 0.4, std(0x3c4046, { roughness: 0.9 }));
    roof.position.set(b.position.x, h + 0.25, b.position.z);
    scene.add(roof);
  }

  // drifting clouds
  var cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, transparent: true, opacity: 0.88, fog: false });
  crane.clouds = [];
  for (var cl = 0; cl < 9; cl++) {
    var cg = new THREE.Group();
    for (var puff = 0; puff < 5; puff++) {
      var r = 6 + Math.random() * 9;
      var m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), cloudMat);
      m.position.set(puff * (r * 0.9) - 18, Math.random() * 3, Math.random() * 6 - 3);
      m.scale.y = 0.45;
      cg.add(m);
    }
    cg.position.set((Math.random() - 0.5) * 400, 55 + Math.random() * 30, (Math.random() - 0.5) * 400);
    scene.add(cg);
    crane.clouds.push(cg);
  }

  // site fence around the pad
  var fenceMat = std(0x9aa0a6, { roughness: 0.4, metalness: 0.7 });
  var fenceH = 2.2, per = 60;
  for (var side = 0; side < 4; side++) {
    var fx = side === 0 ? per / 2 : side === 1 ? -per / 2 : 0;
    var fz = side === 2 ? per / 2 : side === 3 ? -per / 2 : 0;
    for (var fi = -2; fi <= 2; fi++) {
      var post = cyl(0.05, 0.05, fenceH, fenceMat, 6);
      post.position.set(side % 2 === 0 ? fi * (per / 5) : fx, fenceH / 2, side % 2 === 0 ? fz : fi * (per / 5));
      scene.add(post);
    }
    var rail = box(side % 2 === 0 ? per : 0.08, 0.08, side % 2 === 0 ? 0.08 : per, fenceMat);
    rail.position.set(fx, fenceH - 0.15, fz);
    scene.add(rail);
    var meshPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(side % 2 === 0 ? per : 0.02, fenceH - 0.3),
      new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.5, metalness: 0.6, transparent: true, opacity: 0.28, side: THREE.DoubleSide })
    );
    meshPanel.position.set(fx, (fenceH - 0.3) / 2 + 0.1, fz);
    if (side % 2 === 1) meshPanel.rotation.y = Math.PI / 2;
    scene.add(meshPanel);
  }

  // containers as yard clutter
  var contColors = [0xb03a2e, 0x2471a3, 0x1e8449, 0x9a7d0a];
  for (var cc = 0; cc < 6; cc++) {
    var ca = Math.random() * Math.PI * 2, cd2 = 34 + Math.random() * 26;
    var cx = Math.cos(ca) * cd2, cz = Math.sin(ca) * cd2;
    var cont = box(6, 2.6, 2.4, std(contColors[cc % 4], { roughness: 0.6, metalness: 0.2 }));
    cont.position.set(cx, 1.3, cz);
    cont.rotation.y = Math.random() * Math.PI;
    scene.add(cont);
  }

  // light poles
  var poleMat = std(0x777d84, { roughness: 0.4, metalness: 0.6 });
  [[26, 26], [-26, 26], [26, -26], [-26, -26]].forEach(function (pp) {
    var pole = cyl(0.09, 0.12, 9, poleMat, 8);
    pole.position.set(pp[0], 4.5, pp[1]);
    var arm = box(2.2, 0.1, 0.1, poleMat);
    arm.position.set(pp[0] - (pp[0] > 0 ? 1.0 : -1.0), 9, pp[1]);
    var lamp = box(0.7, 0.15, 0.35, new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xffe9a8, emissiveIntensity: 0.9 }));
    lamp.position.set(pp[0] - (pp[0] > 0 ? 2.0 : -2.0), 8.95, pp[1]);
    scene.add(pole); scene.add(arm); scene.add(lamp);
  });

  var trunkMat = std(0x6b4a2f, { roughness: 1 });
  var leafMat = std(0x3e7d3a, { roughness: 1 });
  for (var t = 0; t < 22; t++) {
    var ta = Math.random() * Math.PI * 2;
    var td = 30 + Math.random() * 120;
    var x = Math.cos(ta) * td, z = Math.sin(ta) * td;
    if (Math.abs(x) < 22 && Math.abs(z) < 16) continue;
    var trunk = cyl(0.25, 0.35, 3, trunkMat, 6);
    trunk.position.set(x, 1.5, z);
    var leaf = new THREE.Mesh(new THREE.ConeGeometry(2 + Math.random() * 1.5, 5 + Math.random() * 3, 8), leafMat);
    leaf.position.set(x, 5.5, z);
    leaf.castShadow = true;
    scene.add(trunk); scene.add(leaf);
  }

  var coneMat = std(0xff6b1a, { roughness: 0.7 });
  for (var k = 0; k < 12; k++) {
    var ca = Math.random() * Math.PI * 2, cd = 14 + Math.random() * 30;
    var cone = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 8), coneMat);
    cone.position.set(Math.cos(ca) * cd, 0.55, Math.sin(ca) * cd);
    cone.castShadow = true;
    scene.add(cone);
  }

  PADS.forEach(function (p) {
    var slab = box(9, 0.25, 9, std(0xb08d2e, { roughness: 0.9 }));
    slab.position.set(p.pos.x, 0.12, p.pos.z);
    slab.receiveShadow = true;
    scene.add(slab);
    var ring = new THREE.Mesh(
      new THREE.RingGeometry(3.4, 4.1, 40),
      new THREE.MeshBasicMaterial({ color: 0xffc400, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.pos.x, 0.06, p.pos.z);
    scene.add(ring);
    p.ring = ring;
  });

  ZONES.forEach(function (z) {
    var ring = new THREE.Mesh(
      new THREE.RingGeometry(ZONE_RADIUS - 0.7, ZONE_RADIUS, 48),
      new THREE.MeshBasicMaterial({ color: z.color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(z.pos.x, 0.07, z.pos.z);
    scene.add(ring);
    var inner = new THREE.Mesh(
      new THREE.CircleGeometry(ZONE_RADIUS - 0.8, 48),
      new THREE.MeshBasicMaterial({ color: z.color, transparent: true, opacity: 0.12, side: THREE.DoubleSide })
    );
    inner.rotation.x = -Math.PI / 2;
    inner.position.set(z.pos.x, 0.06, z.pos.z);
    scene.add(inner);
    z.ring = ring;
    z.active = false;
  });
}

// ---------------------------------------------------------------- crane
var crane = {};   // named parts

function buildCrane() {
  var yellow = std(LIEBHERR_YELLOW, { roughness: 0.32, metalness: 0.35, envMapIntensity: 1.1 });
  var yellowDark = std(0xd9a400, { roughness: 0.42, metalness: 0.3 });
  var dark = std(DARK, { roughness: 0.55, metalness: 0.45 });
  var steel = std(0x3a3f45, { roughness: 0.35, metalness: 0.75 });
  var glass = std(0x18222e, { roughness: 0.08, metalness: 0.85, envMapIntensity: 1.4 });
  var white = std(0xf2f2f2, { roughness: 0.5 });

  var root = new THREE.Group();
  scene.add(root);
  crane.root = root;

  // carrier chassis with beveled look: main beam + side skirts
  var chassis = box(13.5, 0.75, 3.1, steel);
  chassis.position.y = 1.05;
  root.add(chassis);
  [-1, 1].forEach(function (s) {
    var skirt = box(13.5, 0.35, 0.12, dark);
    skirt.position.set(0, 0.85, s * 1.6);
    root.add(skirt);
  });
  // fuel tank + exhaust stack
  var tank = cyl(0.42, 0.42, 2.6, std(0x8f959c, { roughness: 0.35, metalness: 0.7 }), 14);
  tank.rotation.z = Math.PI / 2;
  tank.position.set(2.1, 1.05, -3.2);
  root.add(tank);
  var exhaust = cyl(0.07, 0.09, 1.6, steel, 8);
  exhaust.position.set(-2.2, 2.0, -4.6);
  root.add(exhaust);

  var deckUnder = box(8.5, 0.5, 3.4, dark);
  deckUnder.position.set(0, 1.6, -1.2);
  root.add(deckUnder);

  // carrier cab (front) with bumper, headlights, mirrors, steps
  var cabF = new THREE.Group();
  cabF.position.set(0, 1.4, 5.3);
  var cabBody = box(2.6, 2.1, 2.2, yellow);
  cabBody.position.y = 1.05;
  var cabGlass = box(2.4, 0.9, 2.24, glass);
  cabGlass.position.set(0, 1.75, 0);
  var grill = box(2.62, 0.5, 0.06, dark);
  grill.position.set(0, 0.7, 1.12);
  var bumper = box(2.8, 0.35, 0.25, dark);
  bumper.position.set(0, 0.35, 1.25);
  [-1, 1].forEach(function (s) {
    var hl = box(0.4, 0.22, 0.06, new THREE.MeshStandardMaterial({ color: 0xfff8e0, emissive: 0xfff2c0, emissiveIntensity: 0.8 }));
    hl.position.set(s * 0.85, 0.85, 1.13);
    var mir = box(0.06, 0.3, 0.18, dark);
    mir.position.set(s * 1.42, 1.9, 0.6);
    var step = box(0.5, 0.08, 0.4, dark);
    step.position.set(s * 0.9, 0.12, 1.4);
    cabF.add(hl); cabF.add(mir); cabF.add(step);
  });
  cabF.add(cabBody); cabF.add(cabGlass); cabF.add(grill); cabF.add(bumper);
  root.add(cabF);

  // wheels: 5 axles with tread rings and lug nuts
  var wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.5, 24);
  var hubGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.52, 14);
  var treadGeo = new THREE.CylinderGeometry(0.56, 0.56, 0.52, 24, 1, true);
  var tyreMat = std(0x17181a, { roughness: 0.92, metalness: 0 });
  var hubMat = std(0xc8cdd3, { roughness: 0.25, metalness: 0.8 });
  var axleZ = [-5.2, -3.6, -2.0, -0.4, 1.6];
  axleZ.forEach(function (z) {
    [-1.35, 1.35].forEach(function (x) {
      var w = new THREE.Mesh(wheelGeo, tyreMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.55, z);
      w.castShadow = true;
      var tread = new THREE.Mesh(treadGeo, std(0x0d0e10, { roughness: 1 }));
      tread.rotation.z = Math.PI / 2;
      tread.position.copy(w.position);
      var hub = new THREE.Mesh(hubGeo, hubMat);
      hub.rotation.z = Math.PI / 2;
      hub.position.set(x, 0.55, z);
      for (var lug = 0; lug < 6; lug++) {
        var la = lug / 6 * Math.PI * 2;
        var nut = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.54, 6), hubMat);
        nut.rotation.z = Math.PI / 2;
        nut.position.set(x + Math.cos(la) * 0.15, 0.55 + Math.sin(la) * 0.15, z);
        root.add(nut);
      }
      root.add(w); root.add(tread); root.add(hub);
    });
  });

  // outriggers (on carrier): box-section beams, double jacks, round pads
  crane.outriggers = [];
  var beamMat = std(0xd9a400, { metalness: 0.45, roughness: 0.4 });
  [[-1, 3.4], [1, 3.4], [-1, -5.6], [1, -5.6]].forEach(function (cfg) {
    var side = cfg[0], z = cfg[1];
    var grp = new THREE.Group();
    grp.position.set(0, 1.35, z);
    var beam = box(3.6, 0.5, 0.7, beamMat);
    var beamTop = box(3.6, 0.1, 0.5, dark);
    beamTop.position.y = 0.28;
    var jack = cyl(0.13, 0.13, 1.2, steel, 10);
    var jackRod = cyl(0.07, 0.07, 1.2, std(0xd7dce2, { metalness: 0.9, roughness: 0.2 }), 8);
    var pad = cyl(0.55, 0.62, 0.18, dark, 14);
    grp.add(beam); grp.add(beamTop); grp.add(jack); grp.add(jackRod); grp.add(pad);
    root.add(grp);
    crane.outriggers.push({ side: side, grp: grp, beam: beam, jack: jack, jackRod: jackRod, pad: pad });
  });

  // superstructure (slews)
  var sup = new THREE.Group();
  sup.position.set(0, 1.85, -1.2);
  root.add(sup);
  crane.sup = sup;

  var ring = cyl(1.25, 1.35, 0.3, dark, 24);
  ring.position.y = 0;
  sup.add(ring);
  // slew bearing bolts
  for (var bolt = 0; bolt < 12; bolt++) {
    var ba = bolt / 12 * Math.PI * 2;
    var sb = cyl(0.06, 0.06, 0.1, steel, 6);
    sb.position.set(Math.cos(ba) * 1.42, 0.16, Math.sin(ba) * 1.42);
    sup.add(sb);
  }

  var deck = box(7.2, 1.0, 4.8, yellow);
  deck.position.y = 0.65;
  sup.add(deck);
  // deck walkway with chequer plate + railing
  var walk = box(7.2, 0.06, 4.8, std(0xc79a00, { roughness: 0.6, metalness: 0.4 }));
  walk.position.y = 1.18;
  sup.add(walk);
  var railMat = steel;
  [[-3.55, 0], [3.55, 0]].forEach(function (rr) {
    var post1 = box(0.05, 0.9, 0.05, railMat);
    post1.position.set(rr[0], 1.6, -2.3);
    var post2 = post1.clone(); post2.position.z = 2.3;
    var topRail = box(0.05, 0.05, 4.7, railMat);
    topRail.position.set(rr[0], 2.05, 0);
    sup.add(post1); sup.add(post2); sup.add(topRail);
  });

  var deckLabel = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 1.15),
    new THREE.MeshBasicMaterial({ map: makeTextTexture('LIEBHERR', { bg: '#ffc400', fg: '#111111', font: 90, w: 512, h: 128 }) })
  );
  deckLabel.position.set(0, 0.68, 2.41);
  sup.add(deckLabel);
  var deckLabel2 = deckLabel.clone();
  deckLabel2.rotation.y = Math.PI;
  deckLabel2.position.z = -2.41;
  sup.add(deckLabel2);

  // counterweight (rear): stacked slabs + lifting eyes
  var cwMat = std(0x4a4f55, { roughness: 0.55, metalness: 0.35 });
  for (var slab = 0; slab < 3; slab++) {
    var cw = box(2.9 - slab * 0.25, 0.62, 1.7, cwMat);
    cw.position.set(0, 1.05 + slab * 0.64, -2.95);
    sup.add(cw);
    var stripe = box(2.92 - slab * 0.25, 0.08, 1.72, yellowDark);
    stripe.position.set(0, 1.05 + slab * 0.64 + 0.2, -2.95);
    sup.add(stripe);
  }
  var cwEye = cyl(0.09, 0.09, 0.5, steel, 8);
  cwEye.rotation.x = Math.PI / 2;
  cwEye.position.set(0, 3.1, -2.95);
  sup.add(cwEye);

  // rotating beacon on the deck
  crane.beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xff7a00, emissive: 0xff5e00, emissiveIntensity: 1.2 })
  );
  crane.beacon.position.set(3.3, 1.35, -2.0);
  sup.add(crane.beacon);

  // operator cab with frame, wiper, door line, mirrors
  var cab = new THREE.Group();
  cab.position.set(-1.55, 1.15, 1.35);
  var cabBody2 = box(1.9, 1.9, 1.7, yellow);
  cabBody2.position.y = 0.95;
  var cabWin = box(1.92, 0.85, 1.72, glass);
  cabWin.position.y = 1.55;
  var cabRoof = box(2.0, 0.12, 1.8, dark);
  cabRoof.position.y = 1.95;
  var cabPillar = box(0.08, 1.9, 0.08, dark);
  cabPillar.position.set(-0.9, 0.95, 0.86);
  var cabPillar2 = cabPillar.clone(); cabPillar2.position.z = -0.86;
  var wiper = box(0.06, 0.5, 0.04, dark);
  wiper.position.set(0.3, 1.45, 0.87);
  wiper.rotation.z = 0.4;
  var cabMir = box(0.05, 0.25, 0.15, dark);
  cabMir.position.set(-0.98, 1.7, 0.5);
  cab.add(cabBody2); cab.add(cabWin); cab.add(cabRoof); cab.add(cabPillar); cab.add(cabPillar2); cab.add(wiper); cab.add(cabMir);
  sup.add(cab);
  crane.cab = cab;

  // boom pivot (A-frame cheeks) + telescoping boom
  var pivot = new THREE.Group();
  pivot.position.set(0, 1.75, 1.55);
  sup.add(pivot);
  crane.pivot = pivot;

  [-0.55, 0.55].forEach(function (x) {
    var cheek = box(0.18, 1.7, 1.9, steel);
    cheek.position.set(x, -0.4, -0.2);
    pivot.add(cheek);
    // gusset plates
    var gus = box(0.2, 0.9, 0.7, steel);
    gus.position.set(x, -0.9, -1.0);
    pivot.add(gus);
  });
  // pivot pin
  var pin = cyl(0.16, 0.16, 1.3, std(0xd7dce2, { metalness: 0.9, roughness: 0.2 }), 12);
  pin.rotation.z = Math.PI / 2;
  pin.position.set(0, -0.4, -0.2);
  pivot.add(pin);

  // luffing cylinders (from deck to boom underside) — visual, follow boom angle
  crane.luffCyls = [];
  [-0.5, 0.5].forEach(function (x) {
    var base = new THREE.Group();
    base.position.set(x, 1.3, 0.4);
    var barrel = cyl(0.14, 0.14, 2.6, steel, 12);
    barrel.position.y = 1.3;
    var rod = cyl(0.08, 0.08, 2.6, std(0xd7dce2, { metalness: 0.9, roughness: 0.2 }), 10);
    rod.position.y = 2.4;
    base.add(barrel); base.add(rod);
    sup.add(base);
    crane.luffCyls.push({ base: base, barrel: barrel, rod: rod });
  });

  crane.boomSections = [];
  var widths = [1.15, 1.02, 0.89, 0.76, 0.63];
  var heights = [1.25, 1.1, 0.97, 0.84, 0.71];
  for (var i = 0; i <= TELE_SECTIONS; i++) {
    var len = (i === 0) ? BOOM_BASE_LEN : TELE_SECTION_LEN;
    var mat = (i === 0) ? yellow : ((i % 2 === 1) ? yellowDark : yellow);
    var sec = box(widths[i], heights[i], len, mat);
    sec.position.z = len / 2; // updated each frame for telescoping
    pivot.add(sec);
    // collar ring at the rear of each telescoping section
    var collar = box(widths[i] + 0.12, heights[i] + 0.12, 0.35, dark);
    collar.position.z = -len / 2 + 0.18;
    sec.add(collar);
    // top wear pads
    var padT = box(widths[i] * 0.7, 0.06, len * 0.9, white);
    padT.position.y = heights[i] / 2 + 0.03;
    sec.add(padT);
    crane.boomSections.push(sec);
  }
  // sheave head at the tip
  var head = box(0.7, 0.85, 0.55, steel);
  head.position.z = TELE_SECTION_LEN + 0.15;
  crane.boomSections[TELE_SECTIONS].add(head);
  [-0.18, 0.18].forEach(function (x) {
    var sh = cyl(0.2, 0.2, 0.1, std(0xd7dce2, { metalness: 0.9, roughness: 0.2 }), 12);
    sh.rotation.z = Math.PI / 2;
    sh.position.set(x, 0.1, TELE_SECTION_LEN + 0.15);
    crane.boomSections[TELE_SECTIONS].add(sh);
  });
  // white tip marker on last section
  var tipMark = box(0.66, 0.74, 0.5, white);
  tipMark.position.z = TELE_SECTION_LEN - 0.3;
  crane.boomSections[TELE_SECTIONS].add(tipMark);

  // hook block + hook: cheek plates, 2 sheaves, safety latch
  var hook = new THREE.Group();
  [-0.24, 0.24].forEach(function (x) {
    var cheekP = box(0.08, 0.9, 0.5, yellowDark);
    cheekP.position.set(x, -0.35, 0);
    hook.add(cheekP);
  });
  [-0.13, 0.13].forEach(function (x) {
    var sh = cyl(0.2, 0.2, 0.08, dark, 14);
    sh.rotation.z = Math.PI / 2;
    sh.position.set(x, 0.05, 0);
    hook.add(sh);
  });
  var crossBar = cyl(0.07, 0.07, 0.56, steel, 8);
  crossBar.rotation.z = Math.PI / 2;
  crossBar.position.y = 0.12;
  var hookCurve = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.07, 8, 16, Math.PI * 1.4), steel);
  hookCurve.position.y = -0.85;
  hookCurve.rotation.z = Math.PI;
  var latch = box(0.05, 0.3, 0.05, steel);
  latch.position.set(0.22, -0.62, 0);
  latch.rotation.z = -0.5;
  hook.add(crossBar); hook.add(hookCurve); hook.add(latch);
  scene.add(hook);
  crane.hook = hook;

  // cable rendered as a cylinder (updates scale/position each frame)
  var cable = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 1, 8),
    std(0x14161a, { roughness: 0.7, metalness: 0.3 })
  );
  cable.castShadow = true;
  scene.add(cable);
  crane.cable = cable;

  // hook physics state
  crane.hookPos = new THREE.Vector3(0, 4, 14);
  crane.hookVel = new THREE.Vector3();
}

function updateCraneKinematics() {
  crane.sup.rotation.y = state.slew;
  crane.pivot.rotation.x = -state.boomAngle;

  var totalLen = BOOM_BASE_LEN + TELE_MAX * state.tele;
  for (var i = 0; i <= TELE_SECTIONS; i++) {
    var len = (i === 0) ? BOOM_BASE_LEN : TELE_SECTION_LEN;
    var extBefore = TELE_SECTION_LEN * state.tele * i;
    crane.boomSections[i].position.z = (i === 0 ? 0 : BOOM_BASE_LEN + extBefore - TELE_SECTION_LEN) + len / 2;
  }

  crane.pivot.updateMatrixWorld(true);
  crane.tipWorld = crane.pivot.localToWorld(new THREE.Vector3(0, 0.15, totalLen));

  // outriggers
  var e = state.outriggers;
  crane.outriggers.forEach(function (o) {
    o.beam.position.x = o.side * (1.3 + e * 1.8);
    o.beam.children.forEach(function () {});
    o.grp.children.forEach(function (c) { if (c !== o.beam) c.position.x = o.side * (1.3 + e * 3.5); });
    o.jack.position.y = -0.55 * e;
    o.jack.scale.y = 0.4 + e * 0.9;
    o.jackRod.position.y = -0.55 * e - 0.5 * e;
    o.jackRod.scale.y = 0.3 + e * 1.0;
    o.pad.position.y = -1.12 * e;
  });

  // luffing cylinders follow the boom angle: pivot at deck, aim at boom underside
  var boomLen = totalLen * 0.55;
  crane.luffCyls.forEach(function (lc) {
    var tipLocal = new THREE.Vector3(0, -0.55, boomLen * 0.55);
    var world = crane.pivot.localToWorld(tipLocal.clone());
    var baseWorld = lc.base.getWorldPosition(new THREE.Vector3());
    var dir = world.clone().sub(baseWorld);
    var len = dir.length();
    lc.base.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    lc.barrel.scale.y = Math.min(1, len / 2.6);
    lc.rod.position.y = 1.3 + len * 0.35;
    lc.rod.scale.y = Math.max(0.2, (len - 2.4) / 2.6);
  });

  if (crane.beacon) crane.beacon.material.emissiveIntensity = 0.6 + (Math.sin(state.elapsed * 6) * 0.5 + 0.5) * 1.6;
}

// ---------------------------------------------------------------- cargo & zones
function buildCargoMesh(type) {
  var s = type.size;
  var mat;
  if (type.kind === 'container') {
    mat = new THREE.MeshStandardMaterial({
      map: makeTextTexture(type.mass + 't', { bg: '#c0392b', fg: '#ffffff', stripes: true, stripeColor: 'rgba(0,0,0,0.22)', font: 70 }),
      roughness: 0.6, metalness: 0.2
    });
  } else if (type.kind === 'crate') {
    mat = std(type.color, { roughness: 0.9 });
  } else if (type.kind === 'block') {
    mat = std(type.color, { roughness: 1 });
  } else {
    mat = std(type.color, { roughness: 0.35, metalness: 0.75 });
  }
  var m = box(s[0], s[1], s[2], mat);
  m.userData.type = type;
  m.userData.halfH = s[1] / 2;
  return m;
}

var padOccupied = {};

function spawnMission() {
  state.missionNum++;
  state.phase = 'pickup';
  state.missionTime = 0;

  var type = CARGO_TYPES[Math.floor(Math.random() * CARGO_TYPES.length)];
  if (state.missionNum > 3 && Math.random() < 0.4) type = CARGO_TYPES[2]; // heavier later

  var freePads = PADS.filter(function (p) { return !padOccupied[p.name]; });
  var pad = freePads[Math.floor(Math.random() * freePads.length)];
  padOccupied[pad.name] = true;

  var freeZones = ZONES.filter(function (z) { return !z.active && z.pos.distanceTo(pad.pos) > 8; });
  var zone = freeZones.length ? freeZones[Math.floor(Math.random() * freeZones.length)] : ZONES[Math.floor(Math.random() * ZONES.length)];
  zone.active = true;

  if (state.cargo) { scene.remove(state.cargo); state.cargo = null; state.carrying = null; }
  var cargo = buildCargoMesh(type);
  cargo.position.set(pad.pos.x, cargo.userData.halfH + 0.25, pad.pos.z);
  scene.add(cargo);

  state.cargo = cargo;
  state.mission = { type: type, pad: pad, zone: zone };
  toast('MISSION ' + state.missionNum + ': pick up the ' + type.name + ' (' + type.mass + 't) at pad ' + pad.name);
}

function releaseCargo(delivered) {
  if (!state.carrying) return;
  var cargo = state.carrying;
  state.carrying = null;
  if (delivered) {
    var m = state.mission;
    cargo.position.set(m.zone.pos.x, cargo.userData.halfH + 0.05, m.zone.pos.z);
    cargo.rotation.y = Math.random() * 0.6 - 0.3;
    var timeBonus = Math.max(0, Math.round(100 - state.missionTime * 2));
    var gained = Math.round((100 + timeBonus) * state.combo);
    state.score += gained;
    state.deliveries++;
    state.combo = (state.elapsed - state.lastDeliveryAt < 30) ? Math.min(3, state.combo + 1) : 1;
    state.lastDeliveryAt = state.elapsed;
    if (state.score > state.best) {
      state.best = state.score;
      try { localStorage.setItem('liebherr_best', String(state.best)); } catch (e) {}
    }
    banner('DELIVERED!  +' + gained);
    chime();
    m.zone.active = false;
    padOccupied[m.pad.name] = false;
    state.phase = 'done';
    state.nextMissionAt = state.elapsed + 2.6;
  } else {
    cargo.position.set(crane.hookPos.x, cargo.userData.halfH, crane.hookPos.z);
    cargo.rotation.y = state.slew;
    state.phase = 'pickup';
    thud();
    toast('LOAD DROPPED');
  }
}

function updateZones(dt) {
  ZONES.forEach(function (z) {
    if (z.active) {
      var p = 1 + Math.sin(state.elapsed * 5) * 0.06;
      z.ring.scale.set(p, p, 1);
    }
  });
}

// ---------------------------------------------------------------- hook physics
function updateHook(dt) {
  var tip = crane.tipWorld;
  var maxRope = Math.max(ROPE_MIN + 0.5, tip.y - 1.1);
  state.rope = Math.min(Math.max(state.rope, ROPE_MIN), maxRope);

  var steps = 3, h = dt / steps;
  for (var s = 0; s < steps; s++) {
    crane.hookVel.y -= GRAV * h;
    crane.hookVel.multiplyScalar(1 - 0.35 * h);
    crane.hookPos.addScaledVector(crane.hookVel, h);

    var d = crane.hookPos.clone().sub(tip);
    var dist = d.length();
    if (dist > state.rope && dist > 0.0001) {
      var n = d.multiplyScalar(1 / dist);
      crane.hookPos.copy(tip).addScaledVector(n, state.rope);
      var vr = crane.hookVel.dot(n);
      if (vr > 0) crane.hookVel.addScaledVector(n, -vr);
    }

    if (crane.hookPos.y < 0.55) {
      crane.hookPos.y = 0.55;
      if (crane.hookVel.y < 0) crane.hookVel.y *= -0.2;
      crane.hookVel.x *= 0.7; crane.hookVel.z *= 0.7;
    }
  }

  // overload check
  var loadMass = state.carrying ? state.carrying.userData.type.mass : 0;
  var r = Math.sqrt(crane.hookPos.x * crane.hookPos.x + crane.hookPos.z * crane.hookPos.z);
  var deployed = state.outriggers > 0.9;
  var cap = deployed
    ? Math.max(8, 130 - Math.max(0, r - 3) * 4.4 - state.tele * 20 - (state.boomAngle / DEG < 45 ? (45 - state.boomAngle / DEG) * 1.2 : 0))
    : Math.max(2, 26 - Math.max(0, r - 3) * 1.35);
  state.capacity = cap;
  if (state.carrying && loadMass > cap) {
    state.overload += dt;
    crane.hookVel.y -= 7 * dt;
    if (Math.floor(state.overload * 2) !== Math.floor((state.overload - dt) * 2)) beep();
    if (state.overload > 2.5) {
      toast('OVERLOAD! LOAD RELEASED');
      state.overload = 0;
      releaseCargo(false);
    }
  } else {
    state.overload = Math.max(0, state.overload - dt * 2);
  }

  crane.hook.position.copy(crane.hookPos);
  crane.hook.rotation.x = THREE.MathUtils.clamp(-crane.hookVel.z * 0.02, -0.3, 0.3);
  crane.hook.rotation.z = THREE.MathUtils.clamp(crane.hookVel.x * 0.02, -0.3, 0.3);

  var cable = crane.cable;
  var mid = tip.clone().add(crane.hookPos).multiplyScalar(0.5);
  mid.y += 0.22;
  cable.position.copy(mid);
  var d = tip.clone().sub(crane.hookPos);
  cable.scale.y = Math.max(0.001, d.length());
  cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());

  if (state.carrying) {
    var target = crane.hookPos.clone();
    target.y -= 1.15 + state.carrying.userData.halfH * 0.4;
    state.carrying.position.lerp(target, Math.min(1, 9 * dt));
  }
}

// ---------------------------------------------------------------- input
var audio = { ready: false };

function initAudio() {
  if (audio.ready) return;
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    audio.ctx = new AC();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = state.muted ? 0 : 0.5;
    audio.master.connect(audio.ctx.destination);

    audio.engineOsc = audio.ctx.createOscillator();
    audio.engineOsc.type = 'sawtooth';
    audio.engineOsc.frequency.value = 52;
    var lp = audio.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 220;
    audio.engineGain = audio.ctx.createGain();
    audio.engineGain.gain.value = 0.045;
    audio.engineOsc.connect(lp); lp.connect(audio.engineGain); audio.engineGain.connect(audio.master);
    audio.engineOsc.start();

    var lfo = audio.ctx.createOscillator();
    lfo.frequency.value = 2.2;
    var lfoGain = audio.ctx.createGain();
    lfoGain.gain.value = 5;
    lfo.connect(lfoGain); lfoGain.connect(audio.engineOsc.frequency);
    lfo.start();

    audio.hydOsc = audio.ctx.createOscillator();
    audio.hydOsc.type = 'square';
    audio.hydOsc.frequency.value = 240;
    audio.hydGain = audio.ctx.createGain();
    audio.hydGain.gain.value = 0;
    var hp = audio.ctx.createBiquadFilter();
    hp.type = 'bandpass'; hp.frequency.value = 900; hp.Q.value = 2;
    audio.hydOsc.connect(hp); hp.connect(audio.hydGain); audio.hydGain.connect(audio.master);
    audio.hydOsc.start();

    audio.ready = true;
  } catch (e) { /* audio unavailable */ }
}

function blip(freq, dur, type, vol, when) {
  if (!audio.ready || state.muted) return;
  var t0 = audio.ctx.currentTime + (when || 0);
  var o = audio.ctx.createOscillator();
  o.type = type || 'sine';
  o.frequency.value = freq;
  var g = audio.ctx.createGain();
  g.gain.setValueAtTime(vol || 0.2, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(audio.master);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
function clunk() { blip(85, 0.16, 'square', 0.3); blip(60, 0.22, 'sine', 0.35); }
function chime() { blip(660, 0.18, 'sine', 0.25); blip(880, 0.3, 'sine', 0.25, 0.12); blip(1320, 0.4, 'sine', 0.18, 0.24); }
function thud() { blip(70, 0.3, 'sine', 0.4); }
function beep() { blip(1250, 0.07, 'square', 0.12); }

function tryGrabOrDrop() {
  if (!state.cargo) return;
  if (state.carrying) {
    var z = state.mission.zone;
    var dx = crane.hookPos.x - z.pos.x, dz = crane.hookPos.z - z.pos.z;
    var inZone = Math.sqrt(dx * dx + dz * dz) < ZONE_RADIUS && crane.hookPos.y < 6.5;
    releaseCargo(inZone);
    if (inZone) state.phase = 'done';
  } else {
    var c = state.cargo;
    if (crane.hookPos.distanceTo(c.position) < GRAB_RADIUS * 1.6 && c.position.y < 6) {
      state.carrying = c;
      state.phase = 'carry';
      clunk();
      toast('GRABBED ' + c.userData.type.mass + 't — deliver to the ' + state.mission.zone.name + ' zone');
    } else {
      beep();
      toast('Hook too far from load');
    }
  }
}

window.addEventListener('keydown', function (e) {
  if (['Space', 'ArrowUp', 'ArrowDown'].indexOf(e.code) >= 0) e.preventDefault();
  if (!state.started) {
    state.started = true;
    initAudio();
    document.getElementById('start-hint').classList.add('hidden');
  }
  if (e.repeat) return;
  keys[e.code] = true;
  if (e.code === 'Space') tryGrabOrDrop();
  if (e.code === 'KeyO') {
    state.outriggers = state.outriggers > 0.5 ? 0 : 1;
    toast(state.outriggers ? 'OUTRIGGERS DOWN' : 'OUTRIGGERS UP');
    clunk();
  }
  if (e.code === 'KeyC') {
    state.camMode = (state.camMode + 1) % 3;
    var names = ['ORBIT CAM', 'CAB CAM', 'HOOK CAM'];
    toast(names[state.camMode]);
    controls.enabled = state.camMode === 0;
  }
  if (e.code === 'KeyH') {
    document.getElementById('help').classList.toggle('hidden');
  }
  if (e.code === 'KeyM') {
    state.muted = !state.muted;
    if (audio.master) audio.master.gain.value = state.muted ? 0 : 0.5;
    toast(state.muted ? 'SOUND OFF' : 'SOUND ON');
  }
});
window.addEventListener('keyup', function (e) { keys[e.code] = false; });
window.addEventListener('pointerdown', function () {
  if (!state.started) {
    state.started = true;
    initAudio();
    document.getElementById('start-hint').classList.add('hidden');
  }
});

// touch buttons drive the same `keys` map + one-shot actions as the keyboard
function bindTouchControls() {
  var btns = document.querySelectorAll('#touch .tbtn');
  btns.forEach(function (btn) {
    var code = btn.getAttribute('data-key');
    var press = function (e) {
      if (e) e.preventDefault();
      if (!state.started) {
        state.started = true;
        initAudio();
        document.getElementById('start-hint').classList.add('hidden');
      }
      keys[code] = true;
      btn.classList.add('active');
      if (code === 'Space' || code === 'KeyO' || code === 'KeyC' || code === 'KeyM' || code === 'KeyH') {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: code }));
      }
    };
    var release = function (e) {
      if (e) e.preventDefault();
      keys[code] = false;
      btn.classList.remove('active');
    };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  });
}
bindTouchControls();

// ---------------------------------------------------------------- HUD
var el = {};
function grabEls() {
  ['mission', 'score', 'best', 'deliv', 'time', 'r-slew', 'r-boom', 'r-tele', 'r-cable', 'r-load', 'r-out', 'toast', 'banner']
    .forEach(function (id) { el[id] = document.getElementById(id); });
}
var toastTimer = null, bannerTimer = null;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 2400);
}
function banner(msg) {
  el.banner.textContent = msg;
  el.banner.classList.add('show');
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(function () { el.banner.classList.remove('show'); }, 1800);
}

function updateHUD() {
  var m = state.mission;
  if (m && (state.phase === 'pickup' || state.phase === 'carry')) {
    el.mission.innerHTML = 'MISSION ' + state.missionNum + ' — ' +
      (state.phase === 'pickup'
        ? 'Pick up <b style="color:#ffc400">' + m.type.name + ' (' + m.type.mass + 't)</b> at pad <b style="color:#ffc400">' + m.pad.name + '</b>, deliver to the <b style="color:#' + m.zone.color.toString(16).padStart(6, '0') + '">' + m.zone.name + '</b> zone'
        : 'Carrying <b style="color:#ffc400">' + m.type.name + '</b> → <b style="color:#' + m.zone.color.toString(16).padStart(6, '0') + '">' + m.zone.name + ' zone</b> (SPACE to drop)');
  } else if (state.phase === 'done') {
    el.mission.textContent = 'Delivery complete! Next load incoming…';
  } else {
    el.mission.textContent = 'Press SPACE near a load to grab it';
  }
  el.score.textContent = state.score;
  el.best.textContent = state.best;
  el.deliv.textContent = state.deliveries;
  el.time.textContent = (state.phase === 'pickup' || state.phase === 'carry' ? state.missionTime : 0).toFixed(1) + 's';
  el['r-slew'].textContent = ((state.slew / DEG) % 360).toFixed(0) + '°';
  el['r-boom'].textContent = (state.boomAngle / DEG).toFixed(0) + '°';
  el['r-tele'].textContent = Math.round(state.tele * 100) + '%';
  el['r-cable'].textContent = state.rope.toFixed(1) + ' m';
  var loadTxt = state.carrying ? state.carrying.userData.type.mass + 't / cap ' + state.capacity.toFixed(0) + 't' : '—';
  el['r-load'].textContent = loadTxt;
  el['r-load'].style.color = (state.carrying && state.carrying.userData.type.mass > state.capacity) ? '#ff3b30' : '#fff';
  el['r-out'].textContent = state.outriggers > 0.5 ? 'DOWN' : 'UP';
}

// ---------------------------------------------------------------- camera
function updateCamera(dt) {
  var cranePos = crane.root.position;
  if (state.camMode === 0) {
    var t = new THREE.Vector3(cranePos.x, 7, cranePos.z);
    controls.target.lerp(t, 1 - Math.exp(-3 * dt));
    controls.update();
  } else if (state.camMode === 1) {
    var cabWorld = new THREE.Vector3();
    crane.cab.getWorldPosition(cabWorld);
    cabWorld.y += 1.6;
    camera.position.lerp(cabWorld, 1 - Math.exp(-8 * dt));
    var look = crane.tipWorld.clone();
    look.y = Math.max(look.y, 2);
    camera.lookAt(look);
  } else {
    var dir = new THREE.Vector3(Math.sin(state.slew), 0, Math.cos(state.slew));
    var desired = crane.hookPos.clone().addScaledVector(dir, -11);
    desired.y = Math.max(desired.y + 4.5, 2.5);
    camera.position.lerp(desired, 1 - Math.exp(-6 * dt));
    camera.lookAt(crane.hookPos);
  }
}

// ---------------------------------------------------------------- main update
function update(dt) {
  state.elapsed += dt;
  var fast = keys.ShiftLeft || keys.ShiftRight ? 2.4 : 1;

  var moving = 0;
  if (keys.KeyQ) { state.slew += 0.45 * fast * dt; moving = 1; }
  if (keys.KeyE) { state.slew -= 0.45 * fast * dt; moving = 1; }
  if (keys.KeyW) { state.boomAngle = Math.min(82 * DEG, state.boomAngle + 0.11 * fast * dt); moving = 1; }
  if (keys.KeyS) { state.boomAngle = Math.max(4 * DEG, state.boomAngle - 0.11 * fast * dt); moving = 1; }
  if (keys.KeyR) { state.tele = Math.min(1, state.tele + 0.09 * fast * dt); moving = 1; }
  if (keys.KeyF) { state.tele = Math.max(0, state.tele - 0.09 * fast * dt); moving = 1; }
  if (keys.KeyZ) { state.rope -= 4.5 * fast * dt; moving = 1; }
  if (keys.KeyX) { state.rope += 4.5 * fast * dt; moving = 1; }
  state.outriggers += ((state.outriggers > 0.5 ? 1 : 0) - state.outriggers) * Math.min(1, 4 * dt);

  if (audio.ready && !state.muted) {
    audio.hydGain.gain.value += ((moving ? 0.05 : 0) - audio.hydGain.gain.value) * Math.min(1, 8 * dt);
    audio.hydOsc.frequency.value = 240 + (keys.ShiftLeft || keys.ShiftRight ? 160 : 0) + Math.random() * 30;
  }

  if (state.phase === 'pickup' || state.phase === 'carry') state.missionTime += dt;
  if (state.phase === 'done' && state.nextMissionAt && state.elapsed >= state.nextMissionAt) {
    state.nextMissionAt = 0;
    spawnMission();
  }

  updateCraneKinematics();
  updateHook(dt);
  updateZones(dt);
  updateCamera(dt);
  updateHUD();
  if (crane.clouds) {
    crane.clouds.forEach(function (cg, i) {
      cg.position.x += dt * (0.6 + i * 0.13);
      if (cg.position.x > 240) cg.position.x = -240;
    });
  }
}

// ---------------------------------------------------------------- loop
var last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  var dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state.started || true) update(dt);
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------- boot
initThree();
grabEls();
buildEnvironment();
buildCrane();
updateCraneKinematics();
spawnMission();
requestAnimationFrame(loop);

window.__game = { state: state, crane: crane };

})();
