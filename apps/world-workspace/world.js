import * as THREE from 'https://unpkg.com/three@0.164.1/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.164.1/examples/jsm/controls/OrbitControls.js';

const layerState = { Cities: true, 'Naval Assets': true, 'Air Assets': true, Infrastructure: true, Routes: true, Labels: true };
const assets = [
  { id: 'city-nyc', name: 'New York Cluster', type: 'City Cluster', lat: 40.7, lon: -74, region: 'North America', layer: 'Cities', representationMode: 'Illustrative', confidence: 'demo', freshness: 'static demo', sourceLabel: 'Local sample', color: 0x7acbff },
  { id: 'city-tokyo', name: 'Tokyo Cluster', type: 'City Cluster', lat: 35.6, lon: 139.7, region: 'East Asia', layer: 'Cities', representationMode: 'Illustrative', confidence: 'demo', freshness: 'static demo', sourceLabel: 'Local sample', color: 0x7acbff },
  { id: 'carrier-1', name: 'Carrier Group Atlas', type: 'Carrier', lat: 16, lon: 146, region: 'Pacific', layer: 'Naval Assets', representationMode: 'Simulated', confidence: 'low', freshness: 'static demo', sourceLabel: 'Local sample', color: 0x9bf1ff },
  { id: 'carrier-2', name: 'Carrier Group Meridian', type: 'Carrier', lat: 24, lon: 57, region: 'Indian Ocean', layer: 'Naval Assets', representationMode: 'Simulated', confidence: 'low', freshness: 'static demo', sourceLabel: 'Local sample', color: 0x9bf1ff },
  { id: 'air-1', name: 'Flight Echo', type: 'Aircraft', lat: 50, lon: -20, altitude: 0.12, region: 'North Atlantic', layer: 'Air Assets', representationMode: 'Simulated', confidence: 'demo', freshness: 'static demo', sourceLabel: 'Local sample', color: 0xffdd8c },
  { id: 'port-1', name: 'Port of Singapore', type: 'Port', lat: 1.3, lon: 103.8, region: 'SE Asia', layer: 'Infrastructure', representationMode: 'Public infrastructure', confidence: 'medium', freshness: 'dated', sourceLabel: 'Publicly known', color: 0x7dffb3 },
  { id: 'airbase-1', name: 'Illustrative Airbase Delta', type: 'Airbase', lat: 25.2, lon: 55.3, region: 'Middle East', layer: 'Infrastructure', representationMode: 'Illustrative', confidence: 'demo', freshness: 'unknown', sourceLabel: 'Local sample', color: 0x7dffb3 }
];
const routes = [{ from: 'carrier-1', to: 'port-1' }, { from: 'air-1', to: 'city-nyc' }];

const canvas = document.getElementById('worldCanvas');
const fallback = document.getElementById('fallback');
if (!window.WebGLRenderingContext) { fallback.classList.remove('hidden'); throw new Error('WebGL unavailable'); }
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 0, 4.2);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.minDistance = 1.5; controls.maxDistance = 7;
scene.add(new THREE.AmbientLight(0x95b6ff, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(4, 2, 3); scene.add(sun);
const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 64), new THREE.MeshStandardMaterial({ color: 0x295688, roughness: 0.9, metalness: 0.02 }));
scene.add(globe);
const glow = new THREE.Mesh(new THREE.SphereGeometry(1.04, 48, 48), new THREE.MeshBasicMaterial({ color: 0x60a5ff, transparent: true, opacity: 0.18 }));
scene.add(glow);

function llToVec(lat, lon, radius = 1.02) {
  const p = (90 - lat) * (Math.PI / 180); const t = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(-(radius * Math.sin(p) * Math.cos(t)), radius * Math.cos(p), radius * Math.sin(p) * Math.sin(t));
}

const markers = assets.map((asset) => {
  const geom = new THREE.ConeGeometry(0.015, asset.type === 'Aircraft' ? 0.08 : 0.06, 6);
  const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: asset.color }));
  mesh.position.copy(llToVec(asset.lat, asset.lon, 1.02 + (asset.altitude || 0)));
  mesh.lookAt(mesh.position.clone().multiplyScalar(2));
  mesh.userData.asset = asset;
  scene.add(mesh);
  return mesh;
});
const routeLines = routes.map((route) => {
  const from = assets.find((a) => a.id === route.from); const to = assets.find((a) => a.id === route.to);
  const points = [llToVec(from.lat, from.lon, 1.03), llToVec((from.lat + to.lat) / 2, (from.lon + to.lon) / 2, 1.2), llToVec(to.lat, to.lon, 1.03)];
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x69b6ff }));
  line.userData.layer = 'Routes'; scene.add(line); return line;
});

const controlsRoot = document.getElementById('layerControls');
Object.keys(layerState).forEach((key) => { const el = document.createElement('label'); el.innerHTML = `<input type="checkbox" checked> ${key}`; el.querySelector('input').onchange = (e) => { layerState[key] = e.target.checked; syncLayers(); }; controlsRoot.appendChild(el); });

function syncLayers() {
  markers.forEach((m) => { m.visible = layerState[m.userData.asset.layer] !== false; });
  routeLines.forEach((line) => { line.visible = layerState.Routes; });
}

const statusGrid = document.getElementById('statusGrid');
['World Workspace: prototype-ready', 'Mode: illustrative / simulation-ready', 'Globe: available', `Layers: ${Object.keys(layerState).length} enabled`, 'Assets: demo'].forEach((txt) => { const s = document.createElement('span'); s.textContent = txt; statusGrid.appendChild(s); });

const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2();
canvas.addEventListener('click', (event) => {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(markers)[0];
  if (!hit?.object?.userData?.asset) return;
  const a = hit.object.userData.asset;
  document.getElementById('detailCard').innerHTML = `<strong>${a.name}</strong><br/>Type: ${a.type}<br/>Region: ${a.region}<br/>Status: demo asset<br/>Source type: ${a.sourceLabel}<br/>Representation: ${a.representationMode}<br/>Confidence: ${a.confidence}<br/>Freshness: ${a.freshness}`;
});

function resize() { const { clientWidth, clientHeight } = canvas.parentElement; renderer.setSize(clientWidth, clientHeight, false); camera.aspect = clientWidth / clientHeight; camera.updateProjectionMatrix(); }
window.addEventListener('resize', resize); resize(); syncLayers();

let tick = 0;
(function animate() {
  requestAnimationFrame(animate); tick += 0.01;
  globe.rotation.y += 0.0008;
  markers.forEach((m, i) => { const a = m.userData.asset; if (a.type === 'Carrier' || a.type === 'Aircraft') { m.position.copy(llToVec(a.lat + Math.sin(tick + i) * 0.6, a.lon + Math.cos(tick + i) * 0.6, 1.02 + (a.altitude || 0))); } if (a.layer === 'Cities') m.scale.setScalar(1 + Math.sin(tick * 2 + i) * 0.05); });
  controls.update(); renderer.render(scene, camera);
})();
