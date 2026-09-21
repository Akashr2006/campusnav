"use client";

import { EffectComposer, SMAA, SSAO, Bloom, Vignette, ToneMapping } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";

/**
 * Post-processing for the campus scene.
 *
 * What each pass buys:
 *  - SMAA: edge anti-aliasing. Extruded blocks are all hard edges, and the
 *    composer replaces the canvas's own MSAA, so this is not optional.
 *  - SSAO: contact shadows in corners and under eaves. This is most of the
 *    difference between "coloured boxes" and "buildings" — it grounds every
 *    block to the earth and every column to its slab.
 *  - Bloom: only the route ribbon and walker are bright enough to trip it, so
 *    it reads as a glow on the navigation layer and nothing else.
 *  - ACES tone mapping: filmic roll-off instead of clipped highlights.
 *  - Vignette: a quiet frame that draws the eye to the centre.
 *
 * SSAO is the expensive one and is only run in realistic mode; the diagram
 * mode is a line drawing and does not want soft contact shadows anyway.
 *
 * `photo` is set while the drone mesh is on. Its textures are finished
 * photographs: ACES re-grades them (washed out, flat) and SSAO paints dark
 * smudges into every crease of the reconstruction, so both are skipped and
 * the photo is passed through untouched.
 */
export function SceneEffects({ realistic, photo = false }: { realistic: boolean; photo?: boolean }) {
  const ssao = realistic && !photo;
  return (
    <EffectComposer multisampling={0} enableNormalPass={ssao}>
      {ssao ? (
        <SSAO
          blendFunction={BlendFunction.MULTIPLY}
          samples={16}
          rings={4}
          radius={18}
          intensity={22}
          luminanceInfluence={0.55}
          distanceThreshold={0.98}
          distanceFalloff={0.02}
          bias={0.02}
        />
      ) : (
        <></>
      )}
      <Bloom
        mipmapBlur
        luminanceThreshold={1.05}
        luminanceSmoothing={0.15}
        intensity={0.55}
      />
      <ToneMapping mode={photo ? ToneMappingMode.LINEAR : ToneMappingMode.ACES_FILMIC} />
      <Vignette eskil={false} offset={0.25} darkness={photo ? 0.3 : 0.55} />
      <SMAA />
    </EffectComposer>
  );
}
