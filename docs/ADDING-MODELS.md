# Adding a model

## 1. Put the file in the right place

```
<brand>/<model_name>.glb
```

- `brand` is the existing folder for the manufacturer - `bmw`, `porsche`,
  `mercedes`, and so on. Add a new folder only for a manufacturer that is not
  represented yet.
- The file must be a binary glTF 2.0 (`.glb`) with its textures embedded.
  Loose `.gltf` + texture folders are not supported: the frontend loads a single
  binary and there is no LFS or asset resolver in the pipeline.

## 2. Name it consistently

```
<year>_<brand>_<model>[_<trim>].glb
```

| Good | Bad |
| --- | --- |
| `2017_mclaren_720s.glb` | `Mclaren Senna.glb` |
| `2021_bmw_m4_competition.glb` | `bmw m4 comp FINAL.glb` |
| `2020_lamborghini_aventador_svj_63_roadster.glb` | `lambo urus.glb` |

- Lowercase, `snake_case`, ASCII only.
- No spaces, no parentheses, no version suffixes such as `final` or `v2`.
- Keep the year when it identifies a generation; drop it when the model name is
  already unique.
- If a vendor requires attribution in the filename (`__www.example.com`), keep
  it - `scripts/build-manifest.mjs` lifts it into the `source` field.

## 3. Regenerate the manifest

```bash
node scripts/build-manifest.mjs
```

Commit the resulting `manifest.json` change with the model. The manifest is what
the frontend reads to discover models, so a model that is not in the manifest is
invisible.

## 4. Validate

```bash
node scripts/validate.mjs
```

This checks the GLB header, the declared length against the real file size, and
that the JSON chunk parses. CI runs the same script, so a corrupt export fails
the pull request instead of failing in the browser.

## 5. Open a pull request

- One model (or one coherent batch) per pull request.
- State the source and licence of the model in the description.
- Mention triangle count if the file is unusually heavy, so it can be compared
  against the rest of the repository.

## Checklist

- [ ] File is under the correct brand directory
- [ ] Filename is lowercase `snake_case`
- [ ] `manifest.json` regenerated and committed
- [ ] `node scripts/validate.mjs` passes
- [ ] Source and licence noted in the pull request
