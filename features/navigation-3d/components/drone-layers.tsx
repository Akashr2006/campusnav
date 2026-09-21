"use client";

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { TilesRenderer, WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { GLTFExtensionsPlugin } from "3d-tiles-renderer/plugins";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MAP_ORIGIN } from "@/lib/geo/projection";
import { gpsToMetres } from "../lib/campus-3d";
import { FLAT_TERRAIN, decodeTerrain, type Terrain } from "../lib/terrain";

/**
 * Layers built from the DJI Terra drone survey (see public/drone/README.md).
 *
 * The photogrammetry mesh is published as 3D Tiles in Earth-centred (ECEF)
 * coordinates. This scene works in metres east/south of MAP_ORIGIN with Y up,
 * so the tiles are wrapped in one fixed matrix: ECEF -> local ENU at the origin
 * -> this scene's axes, then the survey alignment in public/drone/mesh-alignment.json.
 * The April 2022 flight had no RTK fix (10.4 m RMSE), but measured against the
 * building footprints it already agrees within a few metres, so the offset is 0.
 */

export type DroneAlignment = {
  /** Metres east (+x) and south (+z) to shift the mesh onto the campus graph. */
  dx: number;
  dz: number;
  /** Metres to lower the mesh so ground level lands on y = 0. */
  groundHeight: number;
  /** Clockwise rotation in degrees about the vertical, applied after the shift. */
  rotationDeg: number;
};

const TILESET_URL = process.env.NEXT_PUBLIC_DRONE_TILESET_URL ?? "/drone/mesh/tileset.json";

function useDroneJson<T>(url: string): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let live = true;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setData(d))
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [url]);
  return data;
}

/**
 * Real ground from the survey (public/drone/terrain.*). Flat until it loads, or
 * for good if the files are missing, so the scene never waits on it.
 */
export function useTerrain(): Terrain {
  const [terrain, setTerrain] = useState<Terrain>(FLAT_TERRAIN);
  useEffect(() => {
    let live = true;
    Promise.all([
      fetch("/drone/terrain.json").then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      fetch("/drone/terrain.bin").then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status))),
    ])
      .then(([meta, bytes]) => live && setTerrain(decodeTerrain(meta, bytes)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return terrain;
}

/** ECEF -> this scene's frame (X east, Y up, Z south), with the survey correction. */
function ecefToScene(a: DroneAlignment): THREE.Matrix4 {
  const enu = new THREE.Matrix4();
  WGS84_ELLIPSOID.getEastNorthUpFrame(
    THREE.MathUtils.degToRad(MAP_ORIGIN.lat),
    THREE.MathUtils.degToRad(MAP_ORIGIN.lng),
    0,
    enu
  );
  const toEnu = enu.invert();
  // ENU (x east, y north, z up) -> scene (x east, y up, z south).
  const axes = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  const shift = new THREE.Matrix4().makeTranslation(a.dx, -a.groundHeight, a.dz);
  const spin = new THREE.Matrix4().makeRotationY(-THREE.MathUtils.degToRad(a.rotationDeg));
  return spin.multiply(shift).multiply(axes).multiply(toEnu);
}

type ThermalMeta = {
  bounds: { west: number; south: number; east: number; north: number };
};

/** Where the thermal orthomosaic sits in scene metres, and its texture. */
type Thermal = { texture: THREE.Texture; minX: number; minZ: number; width: number; depth: number };

function useThermal(): Thermal | null {
  const meta = useDroneJson<ThermalMeta>("/drone/thermal-as-ib.json");
  const alignment = useDroneJson<DroneAlignment>("/drone/mesh-alignment.json");
  const texture = useMemo(() => {
    const t = new THREE.TextureLoader().load("/drone/thermal-as-ib.webp");
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return useMemo(() => {
    if (!meta || !alignment) return null;
    const nw = gpsToMetres(meta.bounds.north, meta.bounds.west);
    const se = gpsToMetres(meta.bounds.south, meta.bounds.east);
    // The thermal flight shares the RGB survey's positioning, so it takes the
    // same horizontal correction as the mesh.
    return {
      texture,
      minX: nw.x + alignment.dx,
      minZ: nw.z + alignment.dz,
      width: se.x - nw.x,
      depth: se.z - nw.z,
    };
  }, [meta, alignment, texture]);
}

/**
 * Projects the thermal orthomosaic straight down onto the mesh, so heat lands
 * on the real roofs and ground instead of on a flat sheet (the site falls
 * ~60 m north to south; a sheet would float or sink). One uniform set is shared
 * by every tile, so toggling is a uniform change, not a shader recompile.
 */
function thermalUniforms() {
  return {
    uThermalMap: { value: null as THREE.Texture | null },
    uThermalMin: { value: new THREE.Vector2() },
    uThermalSize: { value: new THREE.Vector2(1, 1) },
    uThermalMix: { value: 0 },
  };
}

function addThermalProjection(material: THREE.Material, uniforms: ReturnType<typeof thermalUniforms>) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vThermalWorld;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvThermalWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;"
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vThermalWorld;
uniform sampler2D uThermalMap;
uniform vec2 uThermalMin;
uniform vec2 uThermalSize;
uniform float uThermalMix;`
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
if (uThermalMix > 0.0) {
  vec2 tuv = (vThermalWorld.xz - uThermalMin) / uThermalSize;
  if (all(greaterThanEqual(tuv, vec2(0.0))) && all(lessThanEqual(tuv, vec2(1.0)))) {
    // Image row 0 is north (smallest z); textures are flipped on upload.
    vec4 th = texture2D(uThermalMap, vec2(tuv.x, 1.0 - tuv.y));
    diffuseColor.rgb = mix(diffuseColor.rgb, th.rgb, uThermalMix * th.a);
  }
}`
      );
  };
  material.customProgramCacheKey = () => "drone-thermal";
  material.needsUpdate = true;
}

export function DroneMesh({ visible, thermal = false }: { visible: boolean; thermal?: boolean }) {
  const { camera, gl } = useThree();
  const alignment = useDroneJson<DroneAlignment>("/drone/mesh-alignment.json");
  const thermalData = useThermal();
  const uniforms = useMemo(thermalUniforms, []);

  const [tiles, setTiles] = useState<TilesRenderer | null>(null);

  // Created in an effect, not a memo: the renderer owns workers and GPU memory,
  // and StrictMode's mount/unmount/mount would otherwise leave a disposed
  // instance behind. Nothing streams until the layer is first switched on.
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    if (visible) setWanted(true);
  }, [visible]);

  useEffect(() => {
    if (!wanted || !alignment) return;
    const t = new TilesRenderer(TILESET_URL);
    // DJI Terra writes every tile Draco-compressed; the decoder is served from
    // public/draco (copied from three/examples) so it works offline.
    const draco = new DRACOLoader().setDecoderPath("/draco/");
    t.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
    // Screen-space error in pixels: the largest geometric error a tile may show
    // before its finer children load. At 12 the viewer settled on level ~17
    // tiles even up close, which is what made roofs and trees look melted.
    t.errorTarget = 4;
    t.lruCache.maxSize = 3000;
    t.lruCache.maxBytesSize = 1.2e9;
    t.group.matrixAutoUpdate = false;
    t.group.matrix.copy(ecefToScene(alignment));
    t.group.matrixWorldNeedsUpdate = true;
    const anisotropy = gl.capabilities.getMaxAnisotropy();
    const onLoad = ({ scene }: { scene: THREE.Object3D }) => {
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => {
          // Seen at a low angle, photo textures smear without anisotropic filtering.
          const map = (m as THREE.MeshBasicMaterial).map;
          if (map) {
            map.anisotropy = anisotropy;
            map.needsUpdate = true;
          }
          addThermalProjection(m, uniforms);
        });
      });
    };
    t.addEventListener("load-model", onLoad);
    setTiles(t);
    return () => {
      t.removeEventListener("load-model", onLoad);
      t.dispose();
      draco.dispose();
      setTiles(null);
    };
  }, [wanted, alignment, uniforms, gl]);

  useEffect(() => {
    if (!thermalData) return;
    uniforms.uThermalMap.value = thermalData.texture;
    uniforms.uThermalMin.value.set(thermalData.minX, thermalData.minZ);
    uniforms.uThermalSize.value.set(thermalData.width, thermalData.depth);
  }, [thermalData, uniforms]);

  useEffect(() => {
    uniforms.uThermalMix.value = thermal && thermalData ? 0.9 : 0;
  }, [thermal, thermalData, uniforms]);

  useEffect(() => {
    tiles?.setCamera(camera);
  }, [tiles, camera]);

  useFrame(() => {
    if (!tiles || !visible) return;
    tiles.setResolutionFromRenderer(camera, gl);
    camera.updateMatrixWorld();
    tiles.update();
  });

  if (!tiles) return null;
  return <primitive object={tiles.group} visible={visible} />;
}

/**
 * Without the mesh, the thermal orthomosaic lies flat just above the diagram's
 * ground plane. It is a false-colour render (bright = warmer), not
 * radiometric: it shows relative heat, never °C.
 */
export function ThermalOverlay({
  visible,
  terrain,
  opacity = 0.85,
}: {
  visible: boolean;
  terrain: Terrain;
  opacity?: number;
}) {
  const th = useThermal();
  // Draped over the terrain on a ~5 m mesh, matching the terrain grid.
  const geometry = useMemo(() => {
    if (!th) return null;
    const geo = new THREE.PlaneGeometry(th.width, th.depth, Math.ceil(th.width / 5), Math.ceil(th.depth / 5));
    geo.rotateX(-Math.PI / 2);
    geo.translate(th.minX + th.width / 2, 0, th.minZ + th.depth / 2);
    const pos = geo.getAttribute("position");
    for (let i = 0; i < pos.count; i++) pos.setY(i, terrain.heightAt(pos.getX(i), pos.getZ(i)) + 0.35);
    geo.computeVertexNormals();
    return geo;
  }, [th, terrain]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!th || !geometry || !visible) return null;
  return (
    <mesh geometry={geometry} renderOrder={2}>
      <meshBasicMaterial map={th.texture} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
