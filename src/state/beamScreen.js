/**
 * Where the beam is pointing, in screen percent.
 *
 * Deliberately a plain mutable object rather than store state: it is
 * written every frame by the torch and read every frame by the text
 * reveal, and putting that through React (or through zustand's
 * subscribers) would re-render the tree 60 times a second for a value
 * nothing needs to react to.
 *
 * Why it exists at all: the copy in frame 03 is supposed to be revealed
 * BY THE LIGHT. Masking to the raw cursor position looks the same only
 * while the beam is perfectly caught up with the pointer — the beam is
 * damped, so during a fast sweep the mask and the light visibly
 * disagree. This is the light's actual position.
 */
export const beamScreen = { x: 50, y: 50, live: false };
