# three (vendored)

Pinned **0.185.1** browser ESM files from the `three` package:

- `three.module.min.js` — core Three.js runtime
- `three.core.min.js` — core module required by the browser module build
- `OrbitControls.js` — orbit, zoom, and pan controls

Pages using `OrbitControls.js` must define an import map before their module
scripts:

```html
<script type="importmap">
  {
    "imports": {
      "three": "./app/vendor/three/three.module.min.js"
    }
  }
</script>
```

## Refresh

```bash
npm pack three@0.185.1
# extract package/build/three.module.min.js → app/vendor/three/
# extract package/build/three.core.min.js → app/vendor/three/
# extract package/examples/jsm/controls/OrbitControls.js → app/vendor/three/
# omit *.map and other package files
```

Three.js is distributed under the MIT license. See `DISCLAIMER.md`.
