import * as THREE from "three";

const $ = (selector) => document.querySelector(selector);
const screens = {
  menu: $("#mainMenu"),
  lobby: $("#lobbyScreen"),
  teams: $("#teamScreen"),
  match: $("#matchHud"),
  result: $("#resultScreen")
};
const hostApp = $("#hostApp");
const controllerApp = $("#controllerApp");
const params = new URLSearchParams(location.search);
const roomFromUrl = params.get("room");
const IS_CONTROLLER = Boolean(roomFromUrl);

const game = {
  mode: "menu",
  team: "nova",
  homeScore: 0,
  awayScore: 0,
  seconds: 120,
  tp: 100,
  paused: false,
  solo: true,
  soundOn: true,
  cinematicUntil: 0,
  cameraShake: 0,
  lastActionAt: 0,
  aiDecisionAt: 0,
  ballCarrier: null,
  goalPauseUntil: 0,
  kickoffUntil: 0
};
const keyState = new Set();
const controllerInput = { x: 0, y: 0 };
const controllers = new Set();
let peer;
let peerRoomId = "";
let channel;
let activeAction = "";
let toastTimer;
let audioContext;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07111e);
scene.fog = new THREE.Fog(0x07111e, 45, 115);
const camera = new THREE.PerspectiveCamera(43, innerWidth / innerHeight, 0.1, 180);
camera.position.set(0, 27, 38);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
$("#gameRoot").appendChild(renderer.domElement);

const ambient = new THREE.HemisphereLight(0x9bdcff, 0x18202d, 2.1);
scene.add(ambient);
const keyLight = new THREE.DirectionalLight(0xffffff, 3.4);
keyLight.position.set(-15, 28, 12);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -34;
keyLight.shadow.camera.right = 34;
keyLight.shadow.camera.top = 24;
keyLight.shadow.camera.bottom = -24;
scene.add(keyLight);

const teamColors = {
  nova: { primary: 0x27cfff, trim: 0xf2fbff, hair: 0xf8d75d, shadow: 0x116caa },
  ember: { primary: 0xff5476, trim: 0xffe6bc, hair: 0x321d38, shadow: 0x9b284e }
};
const hairPalettes = [0xf8d75d, 0x34284f, 0xf46d3b, 0x56d4c7, 0xf5f0e2, 0x3b2420, 0xa2e14a, 0xf49bc5, 0x4794ec, 0xc84462, 0xf6a447];
const jerseyNumberTextures = new Map();
const toonGradient = new THREE.DataTexture(
  new Uint8Array([
    46, 45, 70, 255,
    102, 106, 137, 255,
    180, 191, 208, 255,
    250, 250, 255, 255
  ]),
  4, 1, THREE.RGBAFormat
);
toonGradient.magFilter = THREE.NearestFilter;
toonGradient.minFilter = THREE.NearestFilter;
toonGradient.generateMipmaps = false;
toonGradient.needsUpdate = true;
const animeOutlineMaterial = new THREE.MeshBasicMaterial({ color: 0x101724, side: THREE.BackSide });
const players = [];
const particles = [];
const crowdInstances = [];
const crowdMatrix = new THREE.Object3D();
const pitch = { width: 52, length: 82, halfW: 26, halfL: 41 };
let ball;
let crowdMesh;
let ballVelocity = new THREE.Vector3();
let ballSpin = 0;
let activePlayer;
let lastFrame = 0;
let hudTicker = 0;
let minimapContext;
let isBuilding = false;
let lastBackgroundSimulation = performance.now();

function material(color, roughness = 0.82, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, flatShading: true, ...extra });
}

function toonMaterial(color, extra = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient, ...extra });
}

function addPlayerPart(group, geometry, partMaterial, position, options = {}) {
  const mesh = new THREE.Mesh(geometry, partMaterial);
  mesh.position.copy(position);
  mesh.castShadow = options.castShadow !== false;
  mesh.receiveShadow = true;
  if (options.rotation) mesh.rotation.set(...options.rotation);
  if (options.scale) mesh.scale.set(...options.scale);
  if (options.outline) {
    const outline = new THREE.Mesh(geometry, animeOutlineMaterial);
    outline.position.copy(mesh.position);
    outline.rotation.copy(mesh.rotation);
    outline.scale.copy(mesh.scale).multiplyScalar(options.outlineScale ?? 1.07);
    outline.castShadow = false;
    group.add(outline);
  }
  group.add(mesh);
  return mesh;
}

function makeStadium() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), material(0x101b2a));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  scene.add(ground);

  const turfCanvas = document.createElement("canvas");
  turfCanvas.width = 512;
  turfCanvas.height = 512;
  const ctx = turfCanvas.getContext("2d");
  ctx.fillStyle = "#197d70";
  ctx.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 8; row++) {
    ctx.fillStyle = row % 2 ? "#16756c" : "#218b78";
    ctx.fillRect(0, row * 64, 512, 64);
  }
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(225,255,220,${Math.random() * 0.075})`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 1, 3);
  }
  const turfMap = new THREE.CanvasTexture(turfCanvas);
  turfMap.colorSpace = THREE.SRGBColorSpace;
  turfMap.wrapS = turfMap.wrapT = THREE.RepeatWrapping;
  turfMap.repeat.set(3, 5);
  const field = new THREE.Mesh(new THREE.PlaneGeometry(pitch.width, pitch.length), new THREE.MeshStandardMaterial({ map: turfMap, roughness: 1 }));
  field.rotation.x = -Math.PI / 2;
  field.position.y = 0;
  field.receiveShadow = true;
  scene.add(field);

  const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xd7fff3, transparent: true, opacity: 0.76 });
  const line = (x, z, width, length) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, length), lineMaterial);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.025, z);
    scene.add(mesh);
  };
  line(0, 0, pitch.width, 0.12);
  line(0, -pitch.halfL, pitch.width, 0.15);
  line(0, pitch.halfL, pitch.width, 0.15);
  line(-pitch.halfW, 0, 0.13, pitch.length);
  line(pitch.halfW, 0, 0.13, pitch.length);
  line(0, 0, 0.12, pitch.length);
  const circle = new THREE.Mesh(new THREE.RingGeometry(8.7, 8.82, 72), lineMaterial);
  circle.rotation.x = -Math.PI / 2;
  circle.position.y = 0.03;
  scene.add(circle);
  const spot = new THREE.Mesh(new THREE.CircleGeometry(0.18, 12), lineMaterial);
  spot.rotation.x = -Math.PI / 2;
  spot.position.y = 0.035;
  scene.add(spot);
  for (const zSign of [-1, 1]) {
    const boxZ = zSign * 32;
    line(0, boxZ, 30, 0.12);
    line(-15, zSign * 36.5, 0.12, 9);
    line(15, zSign * 36.5, 0.12, 9);
    const goalBoxZ = zSign * 37.5;
    line(0, goalBoxZ, 17, 0.12);
    line(-8.5, zSign * 39.25, 0.12, 3.5);
    line(8.5, zSign * 39.25, 0.12, 3.5);
    createGoal(zSign);
  }

  const standMat = material(0x172b43);
  for (const zSign of [-1, 1]) {
    const stand = new THREE.Mesh(new THREE.BoxGeometry(69, 10, 8), standMat);
    stand.position.set(0, 6, zSign * 49);
    stand.castShadow = true;
    scene.add(stand);
  }
  for (const xSign of [-1, 1]) {
    const stand = new THREE.Mesh(new THREE.BoxGeometry(8, 10, 84), standMat);
    stand.position.set(xSign * 33.5, 6, 0);
    scene.add(stand);
  }
  addCrowd();
  addFloodlights();
}

function createGoal(zSign) {
  const white = material(0xe4f6ff, 0.35, { emissive: 0x233d52, emissiveIntensity: 0.3 });
  const post = (x, y, z, w, h, d) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), white);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    scene.add(mesh);
  };
  const z = zSign * 41;
  post(-7, 2.5, z, 0.18, 5, 0.18);
  post(7, 2.5, z, 0.18, 5, 0.18);
  post(0, 5, z, 14, 0.18, 0.18);
  const net = new THREE.Mesh(new THREE.BoxGeometry(14, 4.8, 3), new THREE.MeshBasicMaterial({ color: 0x7ccfff, wireframe: true, transparent: true, opacity: 0.23 }));
  net.position.set(0, 2.4, z + zSign * 1.5);
  scene.add(net);
}

function addCrowd() {
  const colors = [0x33dfff, 0xff6686, 0xffd05c, 0xdfeaff, 0x9f87ff, 0x50e0a1];
  const count = 720;
  const crowdMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, flatShading: true, emissive: 0x162331, emissiveIntensity: 0.6 });
  crowdMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.28, 0), crowdMaterial, count);
  crowdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  crowdMesh.frustumCulled = false;
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * 64;
    const zSide = Math.random() < 0.5 ? -1 : 1;
    const z = zSide * (44 + Math.random() * 8);
    const y = 2.3 + Math.random() * 7;
    const scale = 0.82 + Math.random() * 0.65;
    const rotation = Math.random() * Math.PI;
    const instance = { x, y, z, scale, rotation, phase: Math.random() * 7 };
    crowdInstances.push(instance);
    crowdMatrix.position.set(x, y, z);
    crowdMatrix.rotation.set(0, rotation, 0);
    crowdMatrix.scale.setScalar(scale);
    crowdMatrix.updateMatrix();
    crowdMesh.setMatrixAt(i, crowdMatrix.matrix);
    crowdMesh.setColorAt(i, new THREE.Color(colors[Math.floor(Math.random() * colors.length)]));
  }
  scene.add(crowdMesh);
  crowdMesh.instanceMatrix.needsUpdate = true;
}

function addFloodlights() {
  for (const x of [-35, 35]) for (const z of [-35, 35]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.35, 23, 7), material(0x788b9d));
    pole.position.set(x, 11.5, z);
    scene.add(pole);
    const lamp = new THREE.PointLight(0xa6e9ff, 115, 58, 1.6);
    lamp.position.set(x, 23, z);
    scene.add(lamp);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(3, 0.6, 1), material(0xbdeeff, 0.3, { emissive: 0x8bdfff, emissiveIntensity: 2 }));
    panel.position.set(x, 23, z);
    scene.add(panel);
  }
}

function makePlayer(team, x, z, index, role, isUser = false) {
  const colors = teamColors[team];
  const attackDirection = team === game.team ? -1 : 1;
  const group = new THREE.Group();
  const limbs = [];
  const bodyMat = toonMaterial(colors.primary);
  const trimMat = toonMaterial(colors.trim);
  const shadowMat = toonMaterial(colors.shadow);
  const skinColors = [0xf0bd91, 0xe9a979, 0xf7ceb1, 0xb87552, 0xd89574, 0xe6b77c];
  const skinMat = toonMaterial(skinColors[(index * 3 + (team === "ember" ? 1 : 0)) % skinColors.length]);
  const hairColor = hairPalettes[(index + (team === "ember" ? 4 : 0)) % hairPalettes.length];
  const hairMat = toonMaterial(hairColor);
  const darkMat = toonMaterial(0x172034);
  addPlayerPart(group, new THREE.CapsuleGeometry(0.43, 0.62, 4, 9), bodyMat, new THREE.Vector3(0, 1.13, 0), { outline: true });
  for (const side of [-1, 1]) {
    const armPivot = new THREE.Group();
    armPivot.position.set(side * 0.4, 1.52, 0);
    group.add(armPivot);
    addPlayerPart(armPivot, new THREE.CapsuleGeometry(0.105, 0.44, 3, 6), bodyMat, new THREE.Vector3(side * 0.07, -0.26, 0), { rotation: [0, 0, side * -0.14] });
    addPlayerPart(armPivot, new THREE.SphereGeometry(0.11, 7, 6), skinMat, new THREE.Vector3(side * 0.1, -0.52, 0.035));
    const legPivot = new THREE.Group();
    legPivot.position.set(side * 0.19, 0.72, 0);
    group.add(legPivot);
    addPlayerPart(legPivot, new THREE.CapsuleGeometry(0.115, 0.38, 3, 6), trimMat, new THREE.Vector3(0, -0.25, 0), { outline: true, outlineScale: 1.08 });
    addPlayerPart(legPivot, new THREE.BoxGeometry(0.24, 0.14, 0.39), darkMat, new THREE.Vector3(0, -0.55, 0.12), { rotation: [0, 0, -side * 0.06] });
    limbs.push({ pivot: armPivot, side, type: "arm" });
    limbs.push({ pivot: legPivot, side, type: "leg" });
  }
  const shoulder = addPlayerPart(group, new THREE.BoxGeometry(0.85, 0.12, 0.56), trimMat, new THREE.Vector3(0, 1.49, 0), { outline: true, outlineScale: 1.04 });
  shoulder.rotation.z = -0.04;
  const collar = addPlayerPart(group, new THREE.TorusGeometry(0.19, 0.055, 5, 10), shadowMat, new THREE.Vector3(0, 1.55, 0), { rotation: [Math.PI / 2, 0, 0], outline: false });
  collar.scale.set(1, 0.72, 1);
  const stripe = addPlayerPart(group, new THREE.BoxGeometry(0.13, 0.8, 0.055), trimMat, new THREE.Vector3(-0.2, 1.08, 0.425), { outline: false });
  stripe.rotation.z = 0.08;
  const numberKey = `${team}-${index + 1}`;
  if (!jerseyNumberTextures.has(numberKey)) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const context = canvas.getContext("2d");
    context.font = "900 104px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.strokeStyle = `#${colors.shadow.toString(16).padStart(6, "0")}`;
    context.lineWidth = 12;
    context.strokeText(String(index + 1), 64, 66);
    context.fillStyle = `#${colors.trim.toString(16).padStart(6, "0")}`;
    context.fillText(String(index + 1), 64, 66);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    jerseyNumberTextures.set(numberKey, texture);
  }
  const numberDecal = new THREE.Mesh(
    new THREE.PlaneGeometry(0.28, 0.31),
    new THREE.MeshBasicMaterial({ map: jerseyNumberTextures.get(numberKey), transparent: true, depthWrite: false, side: THREE.DoubleSide })
  );
  numberDecal.position.set(0.12, 1.12, 0.443);
  group.add(numberDecal);
  const reverseNumberDecal = numberDecal.clone();
  reverseNumberDecal.position.z = -0.443;
  reverseNumberDecal.rotation.y = Math.PI;
  group.add(reverseNumberDecal);

  const head = addPlayerPart(group, new THREE.SphereGeometry(0.34, 12, 10), skinMat, new THREE.Vector3(0, 1.96, 0), { scale: [0.93, 1.17, 0.9], outline: true, outlineScale: 1.08 });
  const eyeWhite = toonMaterial(0xfaf8ed);
  const eyeIris = toonMaterial(index % 3 === 0 ? 0x47cbea : index % 3 === 1 ? 0x48ae73 : 0x8155d5);
  const pupil = toonMaterial(0x111829);
  const browMat = toonMaterial(hairColor);
  for (const side of [-1, 1]) {
    const eye = addPlayerPart(group, new THREE.SphereGeometry(0.105, 8, 6), eyeWhite, new THREE.Vector3(side * 0.12, 1.98, 0.282), { scale: [1, 1.2, 0.5], outline: false });
    eye.rotation.z = side * -0.1;
    addPlayerPart(group, new THREE.SphereGeometry(0.061, 8, 6), eyeIris, new THREE.Vector3(side * 0.12, 1.98, 0.328), { scale: [0.85, 1, 0.48], outline: false });
    addPlayerPart(group, new THREE.SphereGeometry(0.032, 6, 5), pupil, new THREE.Vector3(side * 0.12, 1.98, 0.348), { scale: [0.82, 1, 0.5], outline: false });
    addPlayerPart(group, new THREE.BoxGeometry(0.18, 0.045, 0.055), browMat, new THREE.Vector3(side * 0.12, 2.105, 0.278), { rotation: [0, 0, side * 0.16], outline: false });
  }
  const fringeMat = toonMaterial(hairColor);
  const hairStyle = index % 4;
  const hair = addPlayerPart(group, new THREE.SphereGeometry(0.36, 10, 8), hairMat, new THREE.Vector3(0, 2.18, -0.025), { scale: [1.12, 0.78, 1.02], outline: true, outlineScale: 1.08 });
  hair.rotation.z = (hairStyle - 1.5) * 0.11;
  const spikeCount = 5 + hairStyle;
  for (let i = 0; i < spikeCount; i++) {
    const angle = -Math.PI * 0.84 + (Math.PI * 0.76 * i) / Math.max(1, spikeCount - 1);
    const spike = addPlayerPart(group, new THREE.ConeGeometry(0.17 + (i % 2) * 0.025, 0.62 + hairStyle * 0.035, 6), fringeMat, new THREE.Vector3(Math.sin(angle) * 0.27, 2.34 + (i % 3) * 0.035, Math.cos(angle) * 0.16), { rotation: [Math.cos(angle) * -0.62, 0, -Math.sin(angle) * 0.55], outline: i % 2 === 0, outlineScale: 1.07 });
    spike.scale.set(1, 1, 0.86);
  }
  const headband = addPlayerPart(group, new THREE.TorusGeometry(0.31, 0.035, 5, 12), trimMat, new THREE.Vector3(0, 2.08, 0), { rotation: [Math.PI / 2, 0, 0], outline: false });
  headband.scale.set(1, 0.82, 0.82);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.68, 20), new THREE.MeshBasicMaterial({ color: 0x05121c, transparent: true, opacity: 0.35 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.025;
  group.add(shadow);
  if (isUser) {
    const marker = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 4), material(0x67f2ff, 0.35, { emissive: 0x13dfff, emissiveIntensity: 0.7 }));
    marker.position.y = 2.9;
    marker.rotation.y = Math.PI / 4;
    group.add(marker);
  }
  group.position.set(x, 0, z);
  group.rotation.y = attackDirection < 0 ? Math.PI : 0;
  scene.add(group);
  const player = {
    group, team, index, role, isUser, attackDirection,
    speed: isUser ? 8.2 : 4.5 + Math.random() * 0.65,
    kick: (isUser ? 16 : 11) + Math.random() * 8,
    catch: role === "GK" ? 16 + Math.random() * 8 : 8 + Math.random() * 8,
    home: new THREE.Vector3(x, 0, z),
    phase: Math.random() * 6,
    tacklingUntil: 0,
    specialAura: null,
    limbs
  };
  players.push(player);
  return player;
}

function buildTeams() {
  if (isBuilding) return;
  isBuilding = true;
  for (const player of [...players]) {
    if (!player.isCrowd) {
      player.group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry?.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((item) => {
          if (item && item !== animeOutlineMaterial) item.dispose();
        });
      });
      scene.remove(player.group);
    }
  }
  for (let i = players.length - 1; i >= 0; i--) {
    if (!players[i].isCrowd) players.splice(i, 1);
  }
  if (ball) scene.remove(ball);
  ball = null;
  const home = game.team;
  const away = home === "nova" ? "ember" : "nova";
  const formation = [
    { x: 0, z: -12, role: "ST" },
    { x: -11, z: -8, role: "LW" },
    { x: 11, z: -8, role: "RW" },
    { x: -17, z: 3, role: "LM" },
    { x: -7, z: 8, role: "CM" },
    { x: 0, z: 1, role: "CM" },
    { x: 17, z: 3, role: "RM" },
    { x: -13, z: 20, role: "LB" },
    { x: 0, z: 23, role: "CB" },
    { x: 13, z: 20, role: "RB" },
    { x: 0, z: 37, role: "GK" }
  ];
  formation.forEach(({ x, z, role }, i) => makePlayer(home, x, z, i, role, i === 5));
  formation.forEach(({ x, z, role }, i) => makePlayer(away, x, -z, i, role));
  game.aiDecisionAt = 0;
  activePlayer = players.find((player) => player.isUser);
  ball = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 12), material(0xf8fbff, 0.4, { emissive: 0xcdeaff, emissiveIntensity: 0.16 }));
  ball.position.set(0, 0.4, 0);
  ball.castShadow = true;
  scene.add(ball);
  const ballMark = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 4, 8), material(0x102039));
  ballMark.rotation.x = Math.PI / 2;
  ball.add(ballMark);
  game.tp = 100;
  game.ballCarrier = null;
  ballVelocity.set(0, 0, 0);
  isBuilding = false;
}

function playTone(frequency, duration = 0.12, type = "sine", gain = 0.1) {
  if (!game.soundOn) return;
  try {
    audioContext ??= new AudioContext();
    if (audioContext.state === "suspended") audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const volume = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
    volume.gain.setValueAtTime(gain, audioContext.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
    oscillator.connect(volume).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  } catch (error) {
    console.warn("Audio playback is unavailable in this browser.", error);
  }
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 2300);
}

function setScreen(name) {
  Object.entries(screens).forEach(([key, element]) => { element.hidden = key !== name; });
  game.mode = name;
  if (name === "match") {
    $("#gameRoot").style.display = "block";
    $("#matchHud").hidden = false;
    $("#pauseOverlay").hidden = true;
  }
}

function renderQr(url) {
  const target = $("#qrCode");
  target.replaceChildren();
  if (window.QRCode) {
    new QRCode(target, { text: url, width: 104, height: 104, colorDark: "#07101d", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
  } else {
    target.textContent = "QR library unavailable";
    target.style.fontSize = "9px";
  }
  $("#controllerLink").href = url;
  $("#controllerLink").textContent = "Open controller on this device ↗";
}

function setHostStatus(text, online = true) {
  const status = $("#hostConnectionStatus");
  status.innerHTML = `<i></i> ${text}`;
  status.classList.toggle("offline", !online);
}

function setupHostNetworking() {
  if (channel) channel.close();
  channel = null;
  controllers.forEach((connection) => connection.close());
  controllers.clear();
  if (peer && !peer.destroyed) peer.destroy();
  peer = null;
  const localCode = `LOCAL-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  peerRoomId = localCode;
  const localUrl = `${location.origin}${location.pathname}?room=${encodeURIComponent(localCode)}`;
  $("#roomCode").textContent = localCode;
  renderQr(localUrl);
  try {
    channel = new BroadcastChannel(`neon-strikers-${localCode}`);
    channel.onmessage = ({ data }) => handleHostMessage(data);
  } catch (error) {
    console.warn("Same-device controller fallback is unavailable.", error);
  }
  if (!window.Peer) {
    setHostStatus("Local controller only (network library unavailable)", false);
    return;
  }
  try {
    peer = new Peer(undefined, { debug: 1 });
    peer.on("open", (id) => {
      peerRoomId = id;
      const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(id)}`;
      $("#roomCode").textContent = id.slice(0, 13).toUpperCase();
      renderQr(url);
      setHostStatus("Room ready · waiting for players");
    });
    peer.on("connection", (connection) => {
      controllers.add(connection);
      connection.on("open", () => {
        setHostStatus("Controller connected");
        toast("Phone controller connected");
        connection.send({ type: "welcome", team: game.team });
      });
      connection.on("data", handleHostMessage);
      connection.on("close", () => {
        controllers.delete(connection);
        if (controllers.size === 0) setHostStatus("Room ready · waiting for players");
      });
      connection.on("error", (error) => console.warn("Controller connection error.", error));
    });
    peer.on("error", (error) => {
      console.warn("PeerJS networking error.", error);
      if (!peerRoomId.startsWith("LOCAL-")) setHostStatus("Network unavailable · local testing still works", false);
      else setHostStatus("Local controller ready · network unavailable", false);
    });
  } catch (error) {
    console.error("Could not start the multiplayer room.", error);
    setHostStatus("Network room unavailable · local testing still works", false);
  }
}

function closeHostRoom() {
  if (channel) channel.close();
  channel = null;
  controllers.forEach((connection) => connection.close());
  controllers.clear();
  if (peer && !peer.destroyed) peer.destroy();
  peer = null;
}

function handleHostMessage(message) {
  if (!message || typeof message !== "object") return;
  if (message.type === "input" && Number.isFinite(message.x) && Number.isFinite(message.y)) {
    controllerInput.x = THREE.MathUtils.clamp(message.x, -1, 1);
    controllerInput.y = THREE.MathUtils.clamp(message.y, -1, 1);
  } else if (message.type === "action") {
    performAction(message.action);
  }
}

function broadcastHostState() {
  const state = {
    type: "state",
    team: game.team === "nova" ? "NOVA CITY" : "EMBER UNITED",
    clock: game.mode === "match" ? formatTime(game.seconds) : "READY",
    score: `${game.homeScore} — ${game.awayScore}`,
    tp: Math.round(game.tp),
    connected: controllers.size > 0
  };
  channel?.postMessage(state);
  controllers.forEach((connection) => {
    if (connection.open) connection.send(state);
  });
}

function formatTime(seconds) {
  const rounded = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}

function setupController() {
  hostApp.hidden = true;
  controllerApp.hidden = false;
  document.body.classList.add("is-controller");
  const room = roomFromUrl;
  const setStatus = (text, online) => {
    const status = $("#controllerStatus");
    status.innerHTML = `<i></i> ${text}`;
    status.classList.toggle("offline", !online);
  };
  const showError = (text) => {
    $("#controllerError").textContent = text;
    $("#controllerError").hidden = false;
  };
  let connection;
  let localChannel;
  let hasJoined = false;
  const joinLocal = () => {
    if (hasJoined) return;
    try {
      localChannel = new BroadcastChannel(`neon-strikers-${room}`);
      localChannel.onmessage = ({ data }) => {
        if (data?.type === "state") updateControllerState(data);
      };
      setStatus("LOCAL MODE", true);
      hasJoined = true;
      $("#controllerError").hidden = true;
    } catch (error) {
      showError("Could not open a controller connection. Please check that this page is hosted on HTTPS and try again.");
      console.error("Local controller connection failed.", error);
    }
  };
  const send = (payload) => {
    if (connection?.open) connection.send(payload);
    else if (localChannel) localChannel.postMessage(payload);
  };

  if (room.startsWith("LOCAL-")) {
    joinLocal();
  } else if (window.Peer) {
    try {
      const client = new Peer(undefined, { debug: 1 });
      client.on("open", () => {
        connection = client.connect(room, { reliable: true });
        connection.on("open", () => {
          hasJoined = true;
          setStatus("CONNECTED", true);
          $("#controllerError").hidden = true;
          connection.send({ type: "hello" });
        });
        connection.on("data", (data) => {
          if (data?.type === "state") updateControllerState(data);
          if (data?.type === "welcome") $("#controllerTeam").textContent = data.team === "nova" ? "NOVA CITY" : "EMBER UNITED";
        });
        connection.on("close", () => {
          setStatus("DISCONNECTED", false);
          showError("Connection lost. Refresh this page or scan the room QR code again.");
        });
        connection.on("error", (error) => {
          setStatus("OFFLINE", false);
          showError("Could not connect to the match. Check your internet connection and reopen the QR link.");
          console.error("Phone controller connection failed.", error);
        });
      });
      client.on("error", (error) => {
        setStatus("OFFLINE", false);
        showError("Could not reach the match room. Check your internet connection and scan the current QR code.");
        console.error("Phone controller peer setup failed.", error);
      });
    } catch (error) {
      setStatus("OFFLINE", false);
      showError("Could not start the controller connection. Please reload this page.");
      console.error("Phone controller initialization failed.", error);
    }
  } else {
    setStatus("LOCAL ONLY", false);
    showError("The multiplayer library did not load. The controller needs an internet connection to reach its libraries.");
  }

  function updateControllerState(state) {
    if (state.team) $("#controllerTeam").textContent = state.team;
    if (state.clock) $("#controllerClock").textContent = state.clock;
    if (state.score) $("#controllerScore").textContent = state.score;
    const tp = Math.max(0, Math.min(100, Number(state.tp) || 0));
    $(".tp-ring i").style.transform = `rotate(${tp * 3.6 - 20}deg)`;
  }

  const zone = $("#joystickZone");
  const knob = $("#joystickKnob");
  let pointerId = null;
  function updateJoystick(event) {
    const rect = zone.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const maxRadius = rect.width * 0.32;
    let dx = event.clientX - centerX;
    let dy = event.clientY - centerY;
    const distance = Math.hypot(dx, dy);
    if (distance > maxRadius) {
      dx = dx / distance * maxRadius;
      dy = dy / distance * maxRadius;
    }
    controllerInput.x = dx / maxRadius;
    controllerInput.y = dy / maxRadius;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  zone.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    pointerId = event.pointerId;
    zone.setPointerCapture(pointerId);
    updateJoystick(event);
  });
  zone.addEventListener("pointermove", (event) => {
    if (event.pointerId === pointerId) updateJoystick(event);
  });
  const releaseJoystick = (event) => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    controllerInput.x = 0;
    controllerInput.y = 0;
    knob.style.transform = "translate(0, 0)";
  };
  zone.addEventListener("pointerup", releaseJoystick);
  zone.addEventListener("pointercancel", releaseJoystick);
  zone.addEventListener("lostpointercapture", releaseJoystick);
  document.querySelectorAll(".action-button").forEach((button) => {
    const act = (event) => {
      event.preventDefault();
      button.classList.add("pressed");
      if (navigator.vibrate) navigator.vibrate(button.dataset.action === "special" ? [25, 35, 60] : 18);
      send({ type: "action", action: button.dataset.action });
      setTimeout(() => button.classList.remove("pressed"), 120);
    };
    button.addEventListener("pointerdown", act);
  });
  setInterval(() => send({ type: "input", x: controllerInput.x, y: controllerInput.y }), 40);
  screen.orientation?.lock?.("landscape").catch(() => {});
}

function beginMatch(solo = false) {
  game.solo = solo;
  game.homeScore = 0;
  game.awayScore = 0;
  game.seconds = 120;
  game.paused = false;
  game.goalPauseUntil = 0;
  game.kickoffUntil = performance.now() / 1000 + 3;
  game.cinematicUntil = 0;
  $("#homeScore").textContent = "00";
  $("#awayScore").textContent = "00";
  $("#homeTeamShort").textContent = game.team === "nova" ? "NOVA" : "EMBER";
  $("#awayTeamShort").textContent = game.team === "nova" ? "EMBER" : "NOVA";
  buildTeams();
  setScreen("match");
  $("#pauseOverlay").hidden = true;
  $("#matchStatus").innerHTML = "<i></i> MATCH LIVE";
  broadcastHostState();
  playTone(523, 0.18, "triangle", 0.12);
  setTimeout(() => playTone(659, 0.22, "triangle", 0.12), 160);
  toast("Kickoff!");
}

function nearestOpponent(player) {
  let nearest = null;
  let distance = Infinity;
  for (const other of players) {
    if (other.isCrowd || other.team === player.team) continue;
    const next = player.group.position.distanceToSquared(other.group.position);
    if (next < distance) {
      nearest = other;
      distance = next;
    }
  }
  return { player: nearest, distance: Math.sqrt(distance) };
}

function performAction(action) {
  if (game.mode !== "match" || game.paused || !activePlayer || !ball) return;
  const now = performance.now() / 1000;
  if (now - game.lastActionAt < 0.18) return;
  game.lastActionAt = now;
  const player = activePlayer;
  const towardOpponentGoal = new THREE.Vector3(0, 0, -1);
  const playerBallDistance = new THREE.Vector2(player.group.position.x - ball.position.x, player.group.position.z - ball.position.z).length();
  const hasBall = game.ballCarrier === player || (playerBallDistance < 1.65 && ballVelocity.length() < 2.5);
  if (hasBall) game.ballCarrier = player;
  if (action === "pass") {
    const teammate = players.filter((p) => !p.isCrowd && p.team === game.team && p !== player)
      .sort((a, b) => {
        const score = (candidate) => {
          const offset = candidate.group.position.clone().sub(player.group.position);
          const forward = -offset.z;
          return forward * 1.1 + Math.abs(offset.x) * 0.18 - offset.length() * 0.16;
        };
        return score(b) - score(a);
      })[0];
    if (hasBall) {
      const aim = teammate ? teammate.group.position.clone().sub(ball.position).normalize() : towardOpponentGoal;
      ballVelocity.copy(aim.multiplyScalar(13));
      ballVelocity.y = 2.8;
      game.ballCarrier = null;
      showToast("PASS!");
    } else {
      activePlayer = game.ballCarrier?.team === game.team
        ? game.ballCarrier
        : players.filter((p) => !p.isCrowd && p.team === game.team)
          .sort((a, b) => a.group.position.distanceToSquared(ball.position) - b.group.position.distanceToSquared(ball.position))[0];
      showToast("PLAYER SWITCH");
    }
    playTone(390, 0.09, "triangle", 0.07);
  } else if (action === "shoot") {
    if (hasBall) {
      ballVelocity.copy(towardOpponentGoal.multiplyScalar(22 + Math.random() * 5));
      ballVelocity.x += (Math.random() - 0.5) * 3;
      ballVelocity.y = 7.5 + Math.random() * 2;
      ballSpin += 14;
      game.ballCarrier = null;
      playTone(130, 0.23, "sawtooth", 0.1);
      showToast("STRIKE!");
    } else {
      showToast("GET CLOSER TO THE BALL");
      return;
    }
  } else if (action === "tackle") {
    const { player: opponent, distance } = nearestOpponent(player);
    player.tacklingUntil = now + 0.45;
    if (opponent && distance < 5.4 && opponent.group.position.distanceTo(ball.position) < 3.2) {
      ballVelocity.set((Math.random() - 0.5) * 6, 2.3, (Math.random() - 0.5) * 7);
      game.ballCarrier = null;
      showToast("CLEAN TACKLE!");
      playTone(240, 0.1, "square", 0.055);
    } else {
      showToast("SLIDE TACKLE");
      playTone(150, 0.08, "triangle", 0.045);
    }
  } else if (action === "special") {
    if (!hasBall) {
      showToast("GET THE BALL TO USE A SPECIAL");
      return;
    }
    if (game.tp < 35) {
      showToast("NOT ENOUGH TP — NEED 35");
      playTone(160, 0.1, "square", 0.05);
      broadcastHostState();
      return;
    }
    game.tp -= 35;
    game.ballCarrier = null;
    activePlayer = player;
    const nearGoal = Math.abs(ball.position.z) > 22;
    ballVelocity.copy(towardOpponentGoal.multiplyScalar(nearGoal ? 27 : 15));
    ballVelocity.x += (Math.random() - 0.5) * 3.5;
    ballVelocity.y = nearGoal ? 9.5 : 6.5;
    game.cinematicUntil = now + 2.3;
    game.cameraShake = 1.15;
    $("#cinematicTitle").textContent = nearGoal ? "SOLAR CYCLONE!" : "COMET BURST!";
    $("#cinematic").hidden = false;
    setTimeout(() => { if (performance.now() / 1000 >= game.cinematicUntil - 0.15) $("#cinematic").hidden = true; }, 2450);
    burst(ball.position.clone(), nearGoal ? 0xffa53e : 0x42eaff, 80, 14);
    playTone(78, 0.65, "sawtooth", 0.22);
    setTimeout(() => playTone(220, 0.42, "triangle", 0.14), 180);
    if (navigator.vibrate) navigator.vibrate([45, 35, 90]);
  }
  broadcastHostState();
}

function showToast(message) { toast(message); }

function burst(origin, color, count, force) {
  const particleMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 });
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08 + Math.random() * 0.14, 0), particleMat.clone());
    mesh.position.copy(origin);
    scene.add(mesh);
    const velocity = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 1.8, Math.random() * 2 - 1).normalize().multiplyScalar(force * (0.25 + Math.random() * 0.8));
    particles.push({ mesh, velocity, life: 0.65 + Math.random() * 0.85, maxLife: 1.5 });
  }
}

function tickParticles(delta) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const particle = particles[i];
    particle.life -= delta;
    particle.mesh.position.addScaledVector(particle.velocity, delta);
    particle.velocity.y -= delta * 8;
    particle.mesh.scale.multiplyScalar(1 - delta * 0.75);
    particle.mesh.material.opacity = Math.max(0, particle.life / particle.maxLife);
    if (particle.life <= 0) {
      scene.remove(particle.mesh);
      particle.mesh.geometry.dispose();
      particle.mesh.material.dispose();
      particles.splice(i, 1);
    }
  }
}

function updateMovement(delta, now) {
  if (game.mode !== "match" || game.paused || now < game.goalPauseUntil) return;
  const moveX = controllerInput.x + (keyState.has("d") ? 1 : 0) - (keyState.has("a") ? 1 : 0);
  const moveY = -controllerInput.y + (keyState.has("w") ? 1 : 0) - (keyState.has("s") ? 1 : 0);
  const movement = new THREE.Vector3(moveX, 0, -moveY);
  if (movement.lengthSq() > 1) movement.normalize();
  activePlayer.moving = movement.lengthSq() > 0.001;
  if (movement.lengthSq() > 0.001) {
    activePlayer.group.position.addScaledVector(movement, activePlayer.speed * delta);
    activePlayer.group.rotation.y = Math.atan2(movement.x, movement.z);
  }
  activePlayer.group.position.x = THREE.MathUtils.clamp(activePlayer.group.position.x, -pitch.halfW + 1, pitch.halfW - 1);
  activePlayer.group.position.z = THREE.MathUtils.clamp(activePlayer.group.position.z, -pitch.halfL + 1, pitch.halfL - 1);

  const livePlayers = players.filter((player) => !player.isCrowd);
  const ballSpeed = ballVelocity.length();
  const nearestToBall = livePlayers
    .map((player) => ({
      player,
      distance: new THREE.Vector2(player.group.position.x - ball.position.x, player.group.position.z - ball.position.z).length()
    }))
    .sort((a, b) => a.distance - b.distance)[0];
  if ((!game.ballCarrier || !livePlayers.includes(game.ballCarrier)) && nearestToBall?.distance < 1.55 && ballSpeed < 4.2) {
    game.ballCarrier = nearestToBall.player;
    if (game.ballCarrier.team === game.team) activePlayer = game.ballCarrier;
  } else if (game.ballCarrier && new THREE.Vector2(
    game.ballCarrier.group.position.x - ball.position.x,
    game.ballCarrier.group.position.z - ball.position.z
  ).length() > 3.2) {
    game.ballCarrier = null;
  }
  if (game.ballCarrier === activePlayer && activePlayer.group.position.distanceTo(ball.position) > 2.4) {
    game.ballCarrier = null;
  }

  const aiTeam = game.team === "nova" ? "ember" : "nova";
  const aiHasBall = game.ballCarrier?.team === aiTeam;
  const humanHasBall = game.ballCarrier?.team === game.team;
  const aiPlayers = livePlayers.filter((player) => player.team === aiTeam && player.role !== "GK");
  const humanCarrier = game.ballCarrier?.team === game.team ? game.ballCarrier : null;
  const aiCarrier = game.ballCarrier?.team === aiTeam ? game.ballCarrier : null;

  if (!aiCarrier && ballSpeed < 5) {
    const challenger = aiPlayers
      .filter((player) => player.group.position.distanceTo(ball.position) < 1.75)
      .sort((a, b) => a.group.position.distanceToSquared(ball.position) - b.group.position.distanceToSquared(ball.position))[0];
    if (challenger && !humanCarrier) game.ballCarrier = challenger;
  }

  if (aiCarrier && now >= game.aiDecisionAt) {
    const attackProgress = aiCarrier.attackDirection * aiCarrier.group.position.z;
    const pressure = livePlayers
      .filter((player) => player.team === game.team)
      .map((player) => aiCarrier.group.position.distanceTo(player.group.position))
      .sort((a, b) => a - b)[0] ?? 99;
    const passOptions = livePlayers
      .filter((player) => player.team === aiTeam && player !== aiCarrier && player.role !== "GK")
      .map((player) => {
        const offset = player.group.position.clone().sub(aiCarrier.group.position);
        const forwardGain = offset.z * aiCarrier.attackDirection;
        const spacing = offset.length();
        return { player, forwardGain, score: forwardGain * 1.1 + Math.min(spacing, 13) * 0.3 - Math.abs(offset.x) * 0.06 };
      })
      .filter((option) => option.forwardGain > 2.5 && option.player.group.position.distanceTo(ball.position) > 3);
    const bestPass = passOptions.sort((a, b) => b.score - a.score)[0];
    game.aiDecisionAt = now + 0.55 + Math.random() * 0.45;

    if (attackProgress > 27 && Math.abs(aiCarrier.group.position.x) < 12) {
      const targetX = (Math.random() - 0.5) * 5.2;
      const targetZ = aiCarrier.attackDirection * pitch.halfL;
      const shot = new THREE.Vector3(targetX - ball.position.x, 0, targetZ - ball.position.z).normalize();
      const power = aiCarrier.kick * 0.85 + 9;
      ballVelocity.set(shot.x * power, 7.5 + Math.random() * 2.5, shot.z * power);
      game.ballCarrier = null;
      game.aiDecisionAt = now + 1.4;
      showToast("THE ACADEMY STRIKES!");
    } else if (bestPass && (pressure < 4.8 || Math.random() < 0.16)) {
      const direction = bestPass.player.group.position.clone().sub(ball.position).normalize();
      ballVelocity.set(direction.x * 13.5, 2.7, direction.z * 13.5);
      game.ballCarrier = null;
      showToast("QUICK PASS!");
    }
  }

  const pressTarget = humanCarrier?.group.position ?? ball.position;
  const pressers = !aiHasBall && (humanHasBall || !game.ballCarrier)
    ? aiPlayers
      .map((player) => ({ player, distance: player.group.position.distanceTo(pressTarget) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 2)
      .map((entry) => entry.player)
    : [];
  const pressingPlayer = pressers[0] ?? null;
  const coverPlayer = pressers[1] ?? null;
  const homeHasBall = humanHasBall;
  const carrierProgress = humanCarrier ? humanCarrier.attackDirection * humanCarrier.group.position.z : 0;

  for (const player of players) {
    if (player.isCrowd || player === activePlayer || player === game.ballCarrier) continue;
    const position = player.group.position;
    const direction = player.attackDirection;
    const isAI = player.team === aiTeam;
    const ownPossession = isAI ? aiHasBall : homeHasBall;
    let target;

    if (player.role === "GK") {
      const defendingBall = ball.position.z * -direction;
      const keeperDepth = Math.abs(player.home.z);
      target = new THREE.Vector3(
        THREE.MathUtils.clamp(ball.position.x * 0.52, -5.7, 5.7),
        0,
        direction * (keeperDepth - THREE.MathUtils.clamp(defendingBall * 0.035, -1.5, 2.5))
      );
    } else if (isAI && !ownPossession && player === pressingPlayer) {
      target = new THREE.Vector3(ball.position.x * 0.88, 0, ball.position.z * 0.88);
    } else if (isAI && !ownPossession && player === coverPlayer) {
      target = new THREE.Vector3(
        ball.position.x * 0.54 + player.home.x * 0.46,
        0,
        (ball.position.z * 0.45 + player.home.z * 0.55)
      );
    } else {
      const laneOffset = Math.sin(now * 0.42 + player.phase) * 1.25;
      let forwardShift = 0;
      if (ownPossession) {
        const progress = THREE.MathUtils.clamp(direction * ball.position.z / pitch.halfL, -0.5, 0.75);
        if (player.role === "ST" || player.role === "LW" || player.role === "RW") forwardShift = 7 + progress * 9;
        else if (player.role === "CM" || player.role === "LM" || player.role === "RM") forwardShift = 2 + progress * 7;
        else forwardShift = progress * 3;
      } else {
        const progressAgainst = THREE.MathUtils.clamp(-direction * ball.position.z / pitch.halfL, -0.5, 0.8);
        forwardShift = progressAgainst * 4;
      }

      let desiredX = player.home.x + laneOffset;
      if (player.role === "LW") desiredX -= 2;
      if (player.role === "RW") desiredX += 2;
      if (player.role === "CM" || player.role === "LM" || player.role === "RM") {
        desiredX += THREE.MathUtils.clamp(ball.position.x * 0.18, -3.2, 3.2);
      }
      if (player.role === "CB" || player.role === "LB" || player.role === "RB") {
        desiredX += THREE.MathUtils.clamp(ball.position.x * 0.12, -2.2, 2.2);
      }
      let desiredZ = ownPossession
        ? player.home.z + direction * forwardShift
        : player.home.z - direction * forwardShift;

      if (ownPossession && aiCarrier) {
        const progress = direction * ball.position.z;
        if (player.role === "LW" || player.role === "RW") {
          desiredZ = ball.position.z + direction * (4 + (player.role === "LW" ? 2 : 5));
        } else if (player.role === "ST") {
          desiredZ = ball.position.z + direction * 7;
          desiredX += THREE.MathUtils.clamp(-ball.position.x * 0.25, -4, 4);
        } else if (player.role === "CM") {
          desiredZ = ball.position.z + direction * (progress > 15 ? 8 : 3);
        }
      } else if (!ownPossession && humanCarrier && isAI) {
        desiredZ = player.home.z - direction * forwardShift;
      }

      target = new THREE.Vector3(
        THREE.MathUtils.clamp(desiredX, -pitch.halfW + 2, pitch.halfW - 2),
        0,
        THREE.MathUtils.clamp(desiredZ, -pitch.halfL + 3, pitch.halfL - 3)
      );
    }

    const offset = target.sub(position);
    const distance = offset.length();
    if (distance > 0.35) {
      offset.normalize();
      const moveSpeed = player.speed * (ownPossession ? 0.78 : player === pressingPlayer ? 1.18 : 0.82);
      position.addScaledVector(offset, Math.min(distance, moveSpeed * delta));
      player.group.rotation.y = Math.atan2(offset.x, offset.z);
      player.moving = true;
    } else {
      player.moving = false;
    }
    position.x = THREE.MathUtils.clamp(position.x, -pitch.halfW + 1, pitch.halfW - 1);
    position.z = THREE.MathUtils.clamp(position.z, -pitch.halfL + 1, pitch.halfL - 1);
  }

  if (aiCarrier) {
    const attack = new THREE.Vector3(0, 0, aiCarrier.attackDirection);
    const nearestHuman = livePlayers
      .filter((player) => player.team === game.team)
      .sort((a, b) => a.group.position.distanceToSquared(aiCarrier.group.position) - b.group.position.distanceToSquared(aiCarrier.group.position))[0];
    const pressureDistance = nearestHuman ? nearestHuman.group.position.distanceTo(aiCarrier.group.position) : 99;
    let dribbleDirection = attack.clone();
    if (nearestHuman && Math.abs(nearestHuman.group.position.x - aiCarrier.group.position.x) < 3.5 && pressureDistance < 7) {
      dribbleDirection.x = aiCarrier.group.position.x < 0 ? -0.65 : 0.65;
    }
    dribbleDirection.add(new THREE.Vector3(Math.sin(now * 1.8 + aiCarrier.phase) * 0.11, 0, 0)).normalize();
    aiCarrier.group.position.addScaledVector(dribbleDirection, aiCarrier.speed * 0.48 * delta);
    aiCarrier.group.position.x = THREE.MathUtils.clamp(aiCarrier.group.position.x, -pitch.halfW + 2, pitch.halfW - 2);
    aiCarrier.group.position.z = THREE.MathUtils.clamp(aiCarrier.group.position.z, -pitch.halfL + 2, pitch.halfL - 2);
    aiCarrier.group.rotation.y = Math.atan2(dribbleDirection.x, dribbleDirection.z);
    aiCarrier.moving = true;
    if (nearestHuman && pressureDistance < 1.35 && Math.random() < delta * 0.55) {
      game.ballCarrier = null;
      ballVelocity.set((Math.random() - 0.5) * 3, 1.2, 2.5 * aiCarrier.attackDirection);
      aiCarrier.tacklingUntil = now + 0.35;
      showToast("CHALLENGE FOR THE BALL!");
    }
  }
  if (humanCarrier && now > game.kickoffUntil && pressingPlayer && pressingPlayer.group.position.distanceTo(humanCarrier.group.position) < 1.35 && Math.random() < delta * 0.38) {
    game.ballCarrier = null;
    ballVelocity.set((Math.random() - 0.5) * 4, 1.4, humanCarrier.attackDirection * -3);
    pressingPlayer.tacklingUntil = now + 0.4;
    showToast("THE CPU WINS THE CHALLENGE!");
  }
}

function updateBall(delta, now) {
  if (!ball || game.mode !== "match" || game.paused || now < game.goalPauseUntil) return;
  if (game.ballCarrier && game.cinematicUntil < now) {
    const carrier = game.ballCarrier;
    const facing = new THREE.Vector3(Math.sin(carrier.group.rotation.y), 0, Math.cos(carrier.group.rotation.y));
    ball.position.x = carrier.group.position.x + facing.x * 1.05;
    ball.position.z = carrier.group.position.z + facing.z * 1.05;
    ball.position.y = 0.4 + Math.abs(Math.sin(now * 10 + carrier.phase)) * 0.08;
    ballVelocity.set(0, 0, 0);
    return;
  }
  ballVelocity.y -= 9.8 * delta;
  ball.position.addScaledVector(ballVelocity, delta);
  if (ball.position.y < 0.4) {
    ball.position.y = 0.4;
    if (Math.abs(ballVelocity.y) > 1.5) {
      ballVelocity.y *= -0.49;
      ballVelocity.x *= 0.91;
      ballVelocity.z *= 0.91;
      ballSpin += 0.8;
    } else {
      ballVelocity.y = 0;
      ballVelocity.multiplyScalar(Math.max(0, 1 - delta * 1.5));
    }
  }
  if (ball.position.x < -pitch.halfW || ball.position.x > pitch.halfW) {
    ball.position.x = THREE.MathUtils.clamp(ball.position.x, -pitch.halfW, pitch.halfW);
    ballVelocity.x *= -0.7;
  }
  if (Math.abs(ball.position.z) > pitch.halfL + 2) {
    const end = ball.position.z < 0 ? -1 : 1;
    const attackingTeam = end < 0 ? game.team : (game.team === "nova" ? "ember" : "nova");
    const shotPower = ballVelocity.length();
    const keeper = players.find((p) => !p.isCrowd && p.team !== attackingTeam && Math.abs(p.home.z) > 35);
    const kicker = attackingTeam === game.team
      ? activePlayer
      : players.filter((p) => !p.isCrowd && p.team === attackingTeam)
        .sort((a, b) => a.group.position.distanceToSquared(ball.position) - b.group.position.distanceToSquared(ball.position))[0];
    const kickStat = (kicker?.kick ?? 12) + shotPower * 0.35;
    const catchStat = (keeper?.catch ?? 16) + Math.random() * 5;
    const onTarget = Math.abs(ball.position.x) < 7.4;
    if (onTarget && kickStat > catchStat) {
      if (attackingTeam === game.team) game.homeScore++; else game.awayScore++;
      showToast(kickStat - catchStat > 7 ? "GOOOAL!" : "KEEPER DUEL — GOAL!");
      playTone(shotPower > 25 ? 560 : 420, 0.4, "triangle", 0.16);
      if (shotPower > 25) setTimeout(() => playTone(740, 0.45, "triangle", 0.16), 150);
      burst(new THREE.Vector3(ball.position.x, 3, end * 39), attackingTeam === game.team ? 0x55eaff : 0xff6686, 100, 19);
    } else if (onTarget) {
      showToast("KEEPER SAVE!");
      if (keeper) keeper.group.position.x = THREE.MathUtils.clamp(ball.position.x, -5, 5);
      ballVelocity.set(-ballVelocity.x * 0.45, 4.2, -end * 8);
      ball.position.z = end * (pitch.halfL - 1);
      return;
    } else {
      showToast("SHOT WIDE!");
      ballVelocity.set(-ballVelocity.x * 0.35, 2.8, -end * 5);
      ball.position.z = end * (pitch.halfL - 1);
      return;
    }
    $("#homeScore").textContent = String(game.homeScore).padStart(2, "0");
    $("#awayScore").textContent = String(game.awayScore).padStart(2, "0");
    game.goalPauseUntil = now + 1.8;
    setTimeout(() => {
      if (game.mode !== "match") return;
      ball.position.set(0, 0.4, 0);
      ballVelocity.set(0, 0, 0);
      game.ballCarrier = null;
      activePlayer = players.find((player) => !player.isCrowd && player.team === game.team && player.role === "ST") ?? activePlayer;
      players.filter((p) => !p.isCrowd).forEach((p) => p.group.position.copy(p.home));
    }, 850);
    return;
  }
  ball.rotation.x += ballVelocity.z * delta * 0.6;
  ball.rotation.z -= ballVelocity.x * delta * 0.6;
  ball.rotation.y += ballSpin * delta;
  ballSpin *= Math.max(0, 1 - delta * 0.8);
}

function updateKeeper() {
  if (!ball || game.mode !== "match") return;
  const defendingTeam = ball.position.z < 0 ? (game.team === "nova" ? "ember" : "nova") : game.team;
  const keeper = players.find((p) => !p.isCrowd && p.team === defendingTeam && Math.abs(p.home.z) > 35);
  if (keeper) {
    keeper.group.position.x = THREE.MathUtils.damp(keeper.group.position.x, THREE.MathUtils.clamp(ball.position.x, -5.7, 5.7), 2.8, 1 / 60);
    keeper.group.position.z = keeper.home.z;
    keeper.group.rotation.y = ball.position.z > keeper.home.z ? Math.PI : 0;
  }
}

function updateCamera(delta, now) {
  if (game.mode === "match" && activePlayer && ball) {
    const cinematic = game.cinematicUntil > now;
    const focus = cinematic ? activePlayer.group.position.clone().lerp(ball.position, 0.33) : ball.position.clone().lerp(activePlayer.group.position, 0.33);
    const cameraZ = THREE.MathUtils.clamp(focus.z + 30, -pitch.halfL + 4, pitch.halfL - 4);
    const desired = cinematic
      ? new THREE.Vector3(focus.x + Math.cos(now * 1.8) * 15, 10 + Math.sin(now * 1.8) * 2, focus.z + Math.sin(now * 1.8) * 15)
      : new THREE.Vector3(focus.x * 0.22, 29, cameraZ);
    if (game.cameraShake > 0) {
      desired.x += (Math.random() - 0.5) * game.cameraShake;
      desired.y += (Math.random() - 0.5) * game.cameraShake;
      game.cameraShake = Math.max(0, game.cameraShake - delta * 1.7);
    }
    camera.position.lerp(desired, 1 - Math.exp(-delta * (cinematic ? 2.1 : 2.5)));
    camera.lookAt(focus.x, cinematic ? 2 : 0, focus.z);
  } else {
    const target = new THREE.Vector3(0, 26, 42);
    camera.position.lerp(target, 1 - Math.exp(-delta * 1.5));
    camera.lookAt(0, 0, 0);
  }
}

function updateCrowd(now) {
  if (!crowdMesh) return;
  crowdInstances.forEach((instance, index) => {
    crowdMatrix.position.set(instance.x, instance.y + Math.abs(Math.sin(now * 2 + instance.phase)) * 0.18, instance.z);
    crowdMatrix.rotation.set(0, instance.rotation, 0);
    crowdMatrix.scale.setScalar(instance.scale);
    crowdMatrix.updateMatrix();
    crowdMesh.setMatrixAt(index, crowdMatrix.matrix);
  });
  crowdMesh.instanceMatrix.needsUpdate = true;
}

function updateMinimap() {
  if (!minimapContext || game.mode !== "match") return;
  const canvas = $("#miniMap");
  const ctx = minimapContext;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(12,67,61,.95)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(231,255,247,.7)";
  ctx.lineWidth = 1;
  ctx.strokeRect(4, 4, w - 8, h - 8);
  ctx.beginPath(); ctx.moveTo(w / 2, 4); ctx.lineTo(w / 2, h - 4); ctx.stroke();
  ctx.beginPath(); ctx.arc(w / 2, h / 2, 10, 0, Math.PI * 2); ctx.stroke();
  for (const player of players) {
    if (player.isCrowd) continue;
    const x = 4 + ((player.group.position.x + pitch.halfW) / pitch.width) * (w - 8);
    const y = 4 + ((player.group.position.z + pitch.halfL) / pitch.length) * (h - 8);
    ctx.fillStyle = player.team === game.team ? "#42e6ff" : "#ff8099";
    ctx.beginPath(); ctx.arc(x, y, player.isUser ? 3.1 : 2, 0, Math.PI * 2); ctx.fill();
  }
  if (ball) {
    const x = 4 + ((ball.position.x + pitch.halfW) / pitch.width) * (w - 8);
    const y = 4 + ((ball.position.z + pitch.halfL) / pitch.length) * (h - 8);
    ctx.fillStyle = "#fff8d0";
    ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill();
  }
}

function updateHud(delta) {
  if (game.mode !== "match" || game.paused) return;
  if (performance.now() / 1000 >= game.goalPauseUntil && game.seconds > 0) {
    game.seconds = Math.max(0, game.seconds - delta);
  }
  $("#matchClock").textContent = formatTime(game.seconds);
  game.tp = Math.min(100, game.tp + delta * 0.6);
  $("#tpMeter").style.width = `${game.tp}%`;
  $("#tpValue").textContent = String(Math.floor(game.tp));
  if (game.seconds === 0) endMatch();
}

function endMatch() {
  if (game.mode !== "match") return;
  setScreen("result");
  $("#resultHomeName").textContent = game.team === "nova" ? "NOVA CITY" : "EMBER UNITED";
  $("#resultAwayName").textContent = game.team === "nova" ? "EMBER UNITED" : "NOVA CITY";
  $("#resultHomeScore").textContent = String(game.homeScore).padStart(2, "0");
  $("#resultAwayScore").textContent = String(game.awayScore).padStart(2, "0");
  const won = game.homeScore > game.awayScore;
  $("#resultTitle").innerHTML = game.homeScore === game.awayScore ? "A LEVEL<br><em>FINISH.</em>" : won ? "YOU OWN<br><em>THE NIGHT.</em>" : "NEXT TIME,<br><em>CAPTAIN.</em>";
  $("#resultSummary").textContent = game.homeScore === game.awayScore ? "A hard-fought draw. The rematch is yours." : won ? "The crowd is on its feet. Your team made history." : "Every great team gets back up. Ready for another?";
  playTone(won ? 690 : 290, 0.48, "triangle", 0.13);
}

function simulate(delta, now, background = false) {
  updateMovement(delta, now);
  updateBall(delta, now);
  updateKeeper();
  updateCamera(delta, now);
  if (!background) {
    updateCrowd(now);
    tickParticles(delta);
    players.forEach((player) => {
      const running = Boolean(player.moving);
      const stride = running ? 0.55 : 0.035;
      const gait = now * (running ? 11 : 2) + player.phase;
      player.limbs?.forEach(({ pivot, side, type }) => {
        const swing = Math.sin(gait + (side < 0 ? Math.PI : 0)) * stride;
        pivot.rotation.x = type === "leg" ? swing : -swing * 0.8;
      });
      player.group.position.y = running ? Math.abs(Math.sin(gait * 2)) * 0.065 : 0;
      if (player.tacklingUntil > now) player.group.rotation.x = Math.sin(now * 20) * 0.6;
      else player.group.rotation.x = 0;
    });
  }
  updateHud(delta);
  if (now * 1000 - hudTicker > 100) {
    updateMinimap();
    hudTicker = now * 1000;
  }
}

function frame(time) {
  requestAnimationFrame(frame);
  if (document.hidden) {
    lastFrame = time;
    return;
  }
  const delta = Math.min(0.04, Math.max(0, (time - lastFrame) / 1000 || 0));
  lastFrame = time;
  simulate(delta, time / 1000);
  renderer.render(scene, camera);
}

function backgroundSimulationTick() {
  const time = performance.now();
  if (!document.hidden) {
    lastBackgroundSimulation = time;
    return;
  }
  const elapsed = Math.min(1.25, Math.max(0, (time - lastBackgroundSimulation) / 1000));
  lastBackgroundSimulation = time;
  if (elapsed === 0) return;
  const steps = Math.max(1, Math.ceil(elapsed / (1 / 30)));
  const step = elapsed / steps;
  for (let index = 0; index < steps; index++) {
    simulate(step, time / 1000 - elapsed + step * (index + 1), true);
  }
  renderer.render(scene, camera);
}

function wireControls() {
  $("#startLobby").addEventListener("click", () => {
    game.soundOn && playTone(440, 0.1, "triangle", 0.08);
    setScreen("lobby");
    setupHostNetworking();
  });
  $("#soloMatch").addEventListener("click", () => { game.team = "nova"; beginMatch(true); });
  $("#toTeamSelect").addEventListener("click", () => setScreen("teams"));
  $("#lobbyBack").addEventListener("click", () => {
    closeHostRoom();
    setScreen("menu");
  });
  $("#teamBack").addEventListener("click", () => setScreen("lobby"));
  document.querySelectorAll(".team-card").forEach((card) => card.addEventListener("click", () => {
    document.querySelectorAll(".team-card").forEach((item) => {
      item.classList.toggle("selected", item === card);
      item.setAttribute("aria-pressed", String(item === card));
    });
    game.team = card.dataset.team;
    playTone(520, 0.08, "triangle", 0.07);
  }));
  $("#kickoffButton").addEventListener("click", () => beginMatch(false));
  $("#pauseButton").addEventListener("click", () => {
    game.paused = true;
    $("#pauseOverlay").hidden = false;
    $("#matchStatus").innerHTML = "<i></i> PAUSED";
  });
  $("#resumeButton").addEventListener("click", () => {
    game.paused = false;
    $("#pauseOverlay").hidden = true;
    $("#matchStatus").innerHTML = "<i></i> MATCH LIVE";
  });
  $("#quitButton").addEventListener("click", endMatch);
  $("#rematchButton").addEventListener("click", () => beginMatch(game.solo));
  $("#homeButton").addEventListener("click", () => {
    closeHostRoom();
    setScreen("menu");
  });
  $("#soundToggle").addEventListener("click", () => {
    game.soundOn = !game.soundOn;
    $("#soundToggle").innerHTML = `♫ <span>${game.soundOn ? "ON" : "OFF"}</span>`;
    if (game.soundOn) playTone(540, 0.08, "triangle", 0.07);
  });
  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    keyState.add(key);
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) event.preventDefault();
    if (event.repeat) return;
    if (key === "j") performAction("pass");
    if (key === "k" || key === " ") performAction("shoot");
    if (key === "l") performAction("tackle");
    if (key === "e") performAction("special");
    if (key === "escape" && game.mode === "match") {
      if (game.paused) {
        game.paused = false;
        $("#pauseOverlay").hidden = true;
      } else {
        game.paused = true;
        $("#pauseOverlay").hidden = false;
      }
    }
  });
  window.addEventListener("keyup", (event) => keyState.delete(event.key.toLowerCase()));
  window.addEventListener("blur", () => keyState.clear());
  window.addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  });
}

function init() {
  makeStadium();
  minimapContext = $("#miniMap").getContext("2d");
  wireControls();
  setInterval(backgroundSimulationTick, 50);
  setInterval(broadcastHostState, 200);
  if (IS_CONTROLLER) setupController();
  requestAnimationFrame(frame);
}

init();
