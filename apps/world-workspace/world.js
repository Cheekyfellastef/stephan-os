import { WORLD_ASSETS, WORLD_LAYERS, WORLD_ROUTES, validateWorldDataset } from './world-data.js';

const detailCard = document.getElementById('detailCard');
const fallback = document.getElementById('fallback');
const statusGrid = document.getElementById('statusGrid');
const canvas = document.getElementById('worldCanvas');
const layerState = Object.fromEntries(WORLD_LAYERS.map((layer) => [layer.id, true]));

function setFallback(message) {
  fallback.textContent = message;
  fallback.classList.remove('hidden');
}

function renderStatus(tags) {
  statusGrid.innerHTML = '';
  tags.forEach((txt) => {
    const s = document.createElement('span');
    s.textContent = txt;
    statusGrid.appendChild(s);
  });
}

async function initWorld() {
  const dataValidation = validateWorldDataset();
  if (!dataValidation.ok) {
    setFallback(`Dataset validation degraded: ${dataValidation.issues.join(' | ')}`);
  }

  if (!window.WebGLRenderingContext) {
    setFallback('WebGL unavailable: 3D globe cannot initialise in this environment.');
    return;
  }

  let THREE;
  let OrbitControls;
  try {
    THREE = await import('https://unpkg.com/three@0.164.1/build/three.module.js');
    ({ OrbitControls } = await import('https://unpkg.com/three@0.164.1/examples/jsm/controls/OrbitControls.js'));
  } catch (error) {
    setFallback(`3D runtime import failed (MVP CDN mode): ${error?.message || 'unknown error'}`);
    return;
  }

  try {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 4.2);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x020611, 1);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 1.5;
    controls.maxDistance = 7;

    scene.add(new THREE.AmbientLight(0x90b8ff, 1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.25);
    sun.position.set(4, 2, 3);
    scene.add(sun);

    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 96),
      new THREE.MeshStandardMaterial({ color: 0x2d6aa2, roughness: 0.88, metalness: 0.04 })
    );
    scene.add(globe);
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.05, 80, 80),
      new THREE.MeshBasicMaterial({ color: 0x6db8ff, transparent: true, opacity: 0.2 })
    );
    scene.add(atmosphere);

    const llToVec = (lat, lon, radius = 1.02) => {
      const p = (90 - lat) * (Math.PI / 180);
      const t = (lon + 180) * (Math.PI / 180);
      return new THREE.Vector3(-(radius * Math.sin(p) * Math.cos(t)), radius * Math.cos(p), radius * Math.sin(p) * Math.sin(t));
    };

    const markers = dataValidation.validAssets.map((asset) => {
      const geometry = new THREE.ConeGeometry(0.015, asset.type === 'Aircraft' ? 0.08 : 0.06, 6);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: asset.color || 0x9cc8ff }));
      mesh.position.copy(llToVec(asset.lat, asset.lon, 1.02 + (asset.altitude || 0)));
      mesh.lookAt(mesh.position.clone().multiplyScalar(2));
      mesh.userData.asset = asset;
      scene.add(mesh);
      return mesh;
    });

    const routeLines = WORLD_ROUTES.map((route) => {
      const points = route.waypoints.map(([lat, lon], index) => llToVec(lat, lon, index === 1 ? 1.18 : 1.05));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x69b6ff }));
      line.userData.layer = route.layer;
      scene.add(line);
      return line;
    });

    const controlsRoot = document.getElementById('layerControls');
    controlsRoot.innerHTML = '';
    WORLD_LAYERS.forEach((layer) => {
      const el = document.createElement('label');
      el.innerHTML = `<input type="checkbox" checked> ${layer.label}`;
      el.querySelector('input').onchange = (e) => {
        layerState[layer.id] = e.target.checked;
        syncLayers();
      };
      controlsRoot.appendChild(el);
    });

    function syncLayers() {
      markers.forEach((marker) => {
        marker.visible = layerState[marker.userData.asset.layer] !== false;
      });
      routeLines.forEach((line) => {
        line.visible = layerState[line.userData.layer] !== false;
      });
    }

    renderStatus([
      'World Workspace: prototype-ready',
      'Mode: illustrative / simulated',
      'Globe: available',
      `Assets: ${dataValidation.validAssets.length} demo`,
      `Layers: ${WORLD_LAYERS.length} controls`
    ]);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    canvas.addEventListener('click', (event) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(markers)[0];
      if (!hit?.object?.userData?.asset) return;
      const a = hit.object.userData.asset;
      detailCard.innerHTML = `<strong>${a.name}</strong><br/>Type: ${a.type}<br/>Region: ${a.region}<br/>Description: ${a.description}<br/>Representation: ${a.representationMode}<br/>Confidence: ${a.confidence}<br/>Freshness: ${a.freshness}<br/>Source label: ${a.sourceLabel}<br/>Status: illustrative / simulated (not live-tracked)`;
    });

    function resize() {
      const { clientWidth, clientHeight } = canvas.parentElement;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);
    resize();
    syncLayers();

    let tick = 0;
    (function animate() {
      requestAnimationFrame(animate);
      tick += 0.01;
      globe.rotation.y += 0.0008;
      markers.forEach((m, i) => {
        const a = m.userData.asset;
        if (a.type === 'Carrier' || a.type === 'Aircraft') {
          m.position.copy(llToVec(a.lat + Math.sin(tick + i) * 0.6, a.lon + Math.cos(tick + i) * 0.6, 1.02 + (a.altitude || 0)));
        }
        if (a.layer === 'Cities') m.scale.setScalar(1 + Math.sin(tick * 2 + i) * 0.08);
      });
      routeLines.forEach((line, i) => {
        line.material.opacity = 0.35 + Math.abs(Math.sin(tick + i)) * 0.65;
        line.material.transparent = true;
      });
      controls.update();
      renderer.render(scene, camera);
    })();
  } catch (error) {
    setFallback(`3D world render failed: ${error?.message || 'unknown error'}`);
  }
}

initWorld();
