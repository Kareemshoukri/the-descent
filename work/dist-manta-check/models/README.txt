Drop q930.glb here (and explode.json next to it).

Deep-water replacement slots:
- FISH_STAGE_SLOT in src/scene/AnimatedManta.jsx uses manta-ray.glb and its original 24-second skeletal animation. Loads from 70 m; encounter at 103-117 m.
- WRECK_STAGE_SLOT in src/scene/DeepSeaBeats.jsx: replace WreckPlaceholder with the supplied wreck GLB.
Keep the root group names and let the component own visibility/fade timing.

manta-ray.glb: Model 84A - Manta Ray Feeding by DigitalLife3D.
Source: https://sketchfab.com/3d-models/model-84a-manta-ray-feeding-7dfe925693d24f7395ea8166c3de042c
Embedded license: CC-BY-NC-4.0 (https://creativecommons.org/licenses/by-nc/4.0/).
Original geometry, textures and animation retained; scene placement changed.
