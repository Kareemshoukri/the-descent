Drop q930.glb here (and explode.json next to it).

Deep-water replacement slots:
- FISH_STAGE_SLOT in src/scene/AnimatedManta.jsx uses manta-ray.glb and its original 24-second skeletal animation. Loads from 70 m; encounter at 103-117 m.
- WRECK_STAGE_SLOT in src/scene/SunkenShip.jsx uses dutch-ship.glb. Loads from 95 m and settles on the seabed at 126 m.
Keep the root group names and let the component own visibility/fade timing.

manta-ray.glb: Model 84A - Manta Ray Feeding by DigitalLife3D.
Source: https://sketchfab.com/3d-models/model-84a-manta-ray-feeding-7dfe925693d24f7395ea8166c3de042c
Embedded license: CC-BY-NC-4.0 (https://creativecommons.org/licenses/by-nc/4.0/).
Original geometry, textures and animation retained; scene placement changed.

Dutch Ship Medium by Console Art Cybernetic.
Source: https://sketchfab.com/3d-models/dutch-ship-medium-e9636c857e9e4f8690574ac3a74f8cba
Embedded license: SKETCHFAB Standard (https://sketchfab.com/licenses).
Web copy: embedded textures resized from 4096 to 2048; geometry and alpha retained.
Original remains in Downloads/dutch_ship_medium.glb. Rebuild with scripts/prepare-ship.py.