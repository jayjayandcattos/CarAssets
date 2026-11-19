import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

/**
 * Model index for the AutoVision asset repository.
 *
 * Performance contract:
 *  - one model is resident at a time, everything else is disposed
 *  - nothing is fetched until the user asks for it
 *  - the render loop pauses when the tab is hidden or nothing is loaded
 *  - device pixel ratio is capped so 4K displays do not quadruple fill cost
 *  - if you fuck with winnin put yo lighters in the sky
 *  - how can i make make cents when i got millions on my mind?
 *  - comin with that bullshit i just put it to the side
 *  - ballin since a baby they can see it in my eyes
 */

const HEAVY_BYTES = 40 * 1024 * 1024;
const DRACO_DECODER_PATH =
  "https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/libs/draco/gltf/";

const numberFormat = new Intl.NumberFormat("en");

const dom = {
  summary: document.getElementById("summary"),
  search: document.getElementById("search"),
  list: document.getElementById("list"),
  host: document.getElementById("canvas-host"),
  empty: document.getElementById("empty"),
  overlay: document.getElementById("overlay"),
  overlayLabel: document.getElementById("overlay-label"),
  overlayDetail: document.getElementById("overlay-detail"),
  progressBar: document.getElementById("progress-bar"),
  info: document.getElementById("info"),
  infoBrand: document.getElementById("info-brand"),
  infoName: document.getElementById("info-name"),
  infoSize: document.getElementById("info-size"),
  infoTris: document.getElementById("info-tris"),
  infoMeshes: document.getElementById("info-meshes"),
  infoMaterials: document.getElementById("info-materials"),
  infoTextures: document.getElementById("info-textures"),
  infoGltf: document.getElementById("info-gltf"),
  infoSource: document.getElementById("info-source"),
  resetView: document.getElementById("reset-view"),
  animToggle: document.getElementById("anim-toggle"),
  stats: document.getElementById("stats"),
};

const state = {
  models: [],
  filter: "",
  activePath: null,
  object: null,
  mixer: null,
  generation: 0,
  animationPaused: false,
};

/* -------------------------------------------------------------- formatting */

function formatBytes(bytes) {
  if (bytes == null) return "—";
  const mb = bytes / 1024 / 1024;
  if (mb >= 1000) return `${(mb / 1024).toFixed(2)} GB`;
  if (mb >= 100) return `${mb.toFixed(0)} MB`;
  return `${mb.toFixed(1)} MB`;
}

function formatCount(value) {
  return value == null ? "—" : numberFormat.format(value);
}

/* ------------------------------------------------------------ three set-up */

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
dom.host.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
camera.position.set(3, 1.8, 4);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.maxPolarAngle = Math.PI * 0.495;
controls.enablePan = false;

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(6, 10, 6);
scene.add(keyLight);

const grid = new THREE.GridHelper(10, 20, 0x2b3441, 0x1a2029);
grid.material.transparent = true;
grid.material.opacity = 0.45;
grid.visible = false;
scene.add(grid);

const clock = new THREE.Clock();

const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
loader.setDRACOLoader(dracoLoader);
loader.setMeshoptDecoder(MeshoptDecoder);

/* --------------------------------------------------------------- disposal */

function disposeObject(root) {
  root.traverse((node) => {
    if (!node.isMesh && !node.isPoints && !node.isLine) return;

    node.geometry?.dispose();

    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value && value.isTexture) value.dispose();
      }
      material.dispose();
    }
  });
}

function releaseCurrentModel() {
  if (state.mixer) {
    state.mixer.stopAllAction();
    state.mixer = null;
  }
  if (state.object) {
    scene.remove(state.object);
    disposeObject(state.object);
    state.object = null;
  }
  grid.visible = false;
}

/* ------------------------------------------------------------ camera frame */

function frameObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const distance = (maxDim / 2 / Math.tan(Math.min(vFov, hFov) / 2)) * 1.7;

  camera.near = maxDim / 500;
  camera.far = maxDim * 60;
  camera.updateProjectionMatrix();

  const direction = new THREE.Vector3(1, 0.48, 1).normalize();
  camera.position.copy(center).addScaledVector(direction, distance);

  controls.target.copy(center);
  controls.minDistance = maxDim * 0.35;
  controls.maxDistance = maxDim * 7;
  controls.update();

  grid.scale.setScalar(maxDim / 5);
  grid.position.set(center.x, box.min.y, center.z);
  grid.visible = true;
}

/* --------------------------------------------------------------- animation */

function countTriangles(root) {
  let triangles = 0;
  root.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    const geometry = node.geometry;
    const total = geometry.index ? geometry.index.count : geometry.attributes.position?.count ?? 0;
    triangles += total / 3;
  });
  return Math.round(triangles);
}

function countTextures(root) {
  const textures = new Set();
  root.traverse((node) => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value && value.isTexture) textures.add(value.uuid);
      }
    }
  });
  return textures.size;
}

/* -------------------------------------------------------------------- ui */

function showMessage(title, copy) {
  dom.empty.hidden = false;
  dom.empty.querySelector(".empty-title").textContent = title;
  dom.empty.querySelector(".empty-copy").textContent = copy;
}

function hideMessage() {
  dom.empty.hidden = true;
}

function setOverlay(visible, label = "Loading model…", detail = "") {
  dom.overlay.hidden = !visible;
  if (!visible) return;
  dom.overlayLabel.textContent = label;
  dom.overlayDetail.textContent = detail;
  dom.progressBar.style.width = "0%";
}

function setProgress(loaded, total) {
  if (total > 0) {
    const percent = Math.min(100, (loaded / total) * 100);
    dom.progressBar.style.width = `${percent}%`;
    dom.overlayDetail.textContent = `${formatBytes(loaded)} of ${formatBytes(total)}`;
  } else {
    dom.progressBar.style.width = "100%";
    dom.overlayDetail.textContent = `${formatBytes(loaded)} received`;
  }
}

function renderList() {
  const query = state.filter.trim().toLowerCase();
  const matches = query
    ? state.models.filter((model) => model.path.toLowerCase().includes(query))
    : state.models;

  dom.list.replaceChildren();

  if (matches.length === 0) {
    const message = document.createElement("p");
    message.className = "empty-filter";
    message.textContent = query ? "No models match that filter." : "No models found.";
    dom.list.append(message);
    return;
  }

  const groups = new Map();
  for (const model of matches) {
    if (!groups.has(model.brand)) groups.set(model.brand, []);
    groups.get(model.brand).push(model);
  }

  const fragment = document.createDocumentFragment();

  for (const [brand, models] of groups) {
    const section = document.createElement("section");
    section.className = "group";

    const heading = document.createElement("h2");
    heading.className = "group-title";
    const name = document.createElement("span");
    name.textContent = brand;
    const size = document.createElement("span");
    size.className = "group-size";
    const totalBytes = models.reduce((sum, model) => sum + (model.bytes ?? 0), 0);
    size.textContent = `${models.length} · ${formatBytes(totalBytes)}`;
    heading.append(name, size);

    section.append(heading);

    for (const model of models) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "model";
      button.dataset.path = model.path;
      if (model.bytes && model.bytes >= HEAVY_BYTES) {
        button.dataset.heavy = "true";
        button.title = "Large model — expect a longer first load";
      }
      if (model.path === state.activePath) button.setAttribute("aria-current", "true");

      const label = document.createElement("span");
      label.className = "model-name";
      label.textContent = model.model;

      const meta = document.createElement("span");
      meta.className = "model-meta";
      meta.textContent = formatBytes(model.bytes);

      button.append(label, meta);
      section.append(button);
    }

    fragment.append(section);
  }

  dom.list.append(fragment);
}

function setActive(path) {
  state.activePath = path;
  for (const button of dom.list.querySelectorAll(".model")) {
    if (button.dataset.path === path) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  }
}

function updateInfo(model, root, animations) {
  let meshes = 0;
  root.traverse((node) => {
    if (node.isMesh) meshes += 1;
  });

  dom.infoBrand.textContent = model.brand;
  dom.infoName.textContent = model.model;
  dom.infoSize.textContent = formatBytes(model.bytes);
  dom.infoTris.textContent = formatCount(countTriangles(root));
  dom.infoMeshes.textContent = formatCount(meshes);
  dom.infoMaterials.textContent = formatCount(model.glb?.counts?.materials);
  dom.infoTextures.textContent = formatCount(countTextures(root));
  dom.infoGltf.textContent = model.glb
    ? `v${model.glb.version} · ${model.glb.asset?.version ?? "?"}`
    : "—";

  if (model.source) {
    dom.infoSource.hidden = false;
    dom.infoSource.textContent = `Source: ${model.source}`;
  } else {
    dom.infoSource.hidden = true;
  }

  dom.info.hidden = false;
  dom.resetView.hidden = false;
  dom.animToggle.hidden = animations.length === 0;
  dom.animToggle.textContent = "Pause animation";
  state.animationPaused = false;
}

/* ----------------------------------------------------------------- loading */

function loadModel(model) {
  if (!model || (model.path === state.activePath && state.object)) return;

  const generation = ++state.generation;
  setActive(model.path);

  dom.overlayLabel.textContent = `Loading ${model.model}`;
  dom.overlayDetail.textContent = "";
  dom.progressBar.style.width = "0%";

  // Only surface the overlay if the load is slow enough to notice.
  dom.overlay.hidden = true;
  const revealTimer = window.setTimeout(() => {
    if (generation === state.generation) dom.overlay.hidden = false;
  }, 140);

  loader.load(
    model.path,
    (gltf) => {
      window.clearTimeout(revealTimer);

      if (generation !== state.generation) {
        disposeObject(gltf.scene);
        return;
      }

      releaseCurrentModel();

      const root = gltf.scene;
      root.traverse((node) => {
        if (!node.isMesh) return;
        node.frustumCulled = true;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) {
          if (material) material.envMapIntensity = 1.0;
        }
      });

      scene.add(root);
      state.object = root;

      if (gltf.animations?.length) {
        state.mixer = new THREE.AnimationMixer(root);
        for (const clip of gltf.animations) state.mixer.clipAction(clip).play();
      }

      frameObject(root);
      updateInfo(model, root, gltf.animations ?? []);

      setOverlay(false);
      hideMessage();

      history.replaceState(null, "", `#${encodeURIComponent(model.path)}`);
    },
    (event) => {
      if (generation !== state.generation) return;
      if (event.total) setProgress(event.loaded, event.total);
      else setProgress(event.loaded, 0);
    },
    (error) => {
      window.clearTimeout(revealTimer);
      if (generation !== state.generation) return;

      console.error(`Failed to load ${model.path}`, error);
      setOverlay(false);
      setActive(null);
      showMessage(
        "That model could not be loaded",
        `${model.path} failed to load. Check the file is a valid GLB, or run scripts/validate.mjs.`,
      );
    },
  );
}

/* ------------------------------------------------------------------- wire */

dom.list.addEventListener("click", (event) => {
  const button = event.target.closest(".model");
  if (!button) return;
  const model = state.models.find((entry) => entry.path === button.dataset.path);
  if (model) loadModel(model);
});

dom.search.addEventListener("input", () => {
  state.filter = dom.search.value;
  renderList();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement !== dom.search) {
    event.preventDefault();
    dom.search.focus();
  }
  if (event.key === "Escape" && document.activeElement === dom.search) {
    dom.search.value = "";
    state.filter = "";
    renderList();
    dom.search.blur();
  }
});

dom.resetView.addEventListener("click", () => {
  if (state.object) frameObject(state.object);
});

dom.animToggle.addEventListener("click", () => {
  if (!state.mixer) return;
  state.animationPaused = !state.animationPaused;
  state.mixer.timeScale = state.animationPaused ? 0 : 1;
  dom.animToggle.textContent = state.animationPaused ? "Resume animation" : "Pause animation";
});

/* ------------------------------------------------------------------ render */

function resize() {
  const { clientWidth, clientHeight } = dom.host;
  if (clientWidth === 0 || clientHeight === 0) return;
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(clientWidth, clientHeight, false);
}

new ResizeObserver(resize).observe(dom.host);

let statsTimer = 0;

function renderFrame() {
  const delta = clock.getDelta();

  if (state.mixer && !state.animationPaused) state.mixer.update(delta);

  controls.update();
  renderer.render(scene, camera);

  statsTimer += delta;
  if (statsTimer > 0.5) {
    statsTimer = 0;
    const { calls, triangles } = renderer.info.render;
    dom.stats.textContent = `${calls} draw calls · ${formatCount(triangles)} tris`;
  }
}

renderer.setAnimationLoop(renderFrame);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    renderer.setAnimationLoop(null);
    return;
  }
  // Discard the time spent hidden so animations do not jump on return.
  clock.getDelta();
  renderer.setAnimationLoop(renderFrame);
});

renderer.domElement.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  renderer.setAnimationLoop(null);
  showMessage("WebGL context lost", "Reload the page to continue browsing models.");
});

/* -------------------------------------------------------------------- boot */

async function boot() {
  try {
    const response = await fetch("manifest.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`manifest.json responded with ${response.status}`);
    const manifest = await response.json();

    state.models = (manifest.models ?? []).slice().sort((a, b) => {
      if (a.brand !== b.brand) return a.brand.localeCompare(b.brand, "en");
      return a.model.localeCompare(b.model, "en");
    });

    if (state.models.length === 0) {
      showMessage("No models in the manifest", "Run node scripts/build-manifest.mjs and reload.");
      dom.summary.textContent = "0 models";
      return;
    }

    const totalBytes = state.models.reduce((sum, model) => sum + (model.bytes ?? 0), 0);
    dom.summary.textContent = `${state.models.length} models · ${formatBytes(totalBytes)} · ${
      new Set(state.models.map((model) => model.brand)).size
    } brands`;

    renderList();
    resize();

    const requested = decodeURIComponent(location.hash.replace(/^#/, ""));
    const initial = state.models.find((model) => model.path === requested);
    if (initial) {
      loadModel(initial);
    } else {
      showMessage(
        "Select a model",
        "Models load on demand — one at a time — so the page stays responsive even though the collection is hundreds of megabytes.",
      );
    }
  } catch (error) {
    console.error(error);
    dom.summary.textContent = "Index unavailable";
    showMessage(
      "manifest.json is missing",
      "This page reads manifest.json, which is generated from the model files. Run node scripts/build-manifest.mjs and reload.",
    );
  }
}

boot();
