# Loading the models

Every model in this repository is a self-contained binary glTF 2.0 file (`.glb`)
stored under a brand directory:

```
<brand>/<model_name>.glb
```

The files are served as static assets. There is no build step, no bundler plugin
and no Git LFS indirection, so a path on disk maps directly to a URL:

```
bmw/bmw_m4_f82.glb  ->  https://<your-host>/bmw/bmw_m4_f82.glb
```

## Manifest

`manifest.json` at the repository root describes every model: path, byte size,
SHA-256, glTF version, generator, and object counts. Use it to build a model
picker instead of hardcoding a list, and to prefetch intelligently.

```js
const manifest = await fetch("/assets/manifest.json").then((r) => r.json());

const porsche = manifest.models.filter((model) => model.brand === "porsche");
// porsche[0].path     -> "porsche/2014_porsche_cayman_s_981.glb"
// porsche[0].bytes    -> 12345678
```

Regenerate it after adding, removing or renaming a model:

```bash
node scripts/build-manifest.mjs
```

## Three.js

```js
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const loader = new GLTFLoader();

export async function loadCar(url, scene) {
  const gltf = await loader.loadAsync(url);
  scene.add(gltf.scene);
  return gltf;
}

const gltf = await loadCar("/assets/bmw/bmw_m4_f82.glb", scene);
```

## React Three Fiber

```jsx
import { useGLTF } from "@react-three/drei";

export function Car({ model = "/assets/bmw/bmw_m4_f82.glb" }) {
  const { scene } = useGLTF(model);
  return <primitive object={scene} />;
}

// Optional: warm the cache for a model picker
useGLTF.preload("/assets/ferrari/2016_ferrari_488_gtb.glb");
```

## Things worth knowing

- **Payload size.** These are high-poly models, several of them 30-60 MB. Load
  one at a time, show a progress indicator, and avoid mounting a full grid of
  models at once.
- **Compression.** The files are uncompressed. Draco or meshopt compression
  would cut them dramatically, but requires a decoder in the client and
  re-exporting the assets, so it is tracked separately rather than done here.
- **Disposal.** In long-lived scenes, call `scene.traverse` and dispose of
  geometries, materials and textures when a model is unloaded. Swapping between
  several 60 MB cars without disposal will grow memory until the tab is
  reloaded.
- **Caching.** Serve the files with a long `Cache-Control` and rely on the
  filename changing when the model changes; hashes in `manifest.json` let you
  verify what the client actually received.
- **Materials.** Most models arrive with textured PBR materials baked in. Do not
  assume a shared material set - each model owns its own textures.
