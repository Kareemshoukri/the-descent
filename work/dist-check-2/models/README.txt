Drop q930.glb here (and explode.json next to it).

Deep-water replacement slots:
- FISH_STAGE_SLOT in src/scene/DeepSeaBeats.jsx: replace FishPlaceholder with the supplied fish GLB.
- WRECK_STAGE_SLOT in src/scene/DeepSeaBeats.jsx: replace WreckPlaceholder with the supplied wreck GLB.
Keep the root group names and let the component own visibility/fade timing.
