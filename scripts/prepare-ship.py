"""Resize embedded ship textures for the web, preserving mesh data and alpha."""
import io
import json
import struct
from pathlib import Path
from PIL import Image

source = Path(r"C:\Users\Kareem\Downloads\dutch_ship_medium.glb")
target = Path(__file__).resolve().parents[1] / "public/models/dutch-ship.glb"
data = source.read_bytes()
size = struct.unpack_from("<I", data, 12)[0]
gltf = json.loads(data[20:20 + size])
binary = data[28 + size:]
images = {image["bufferView"]: image for image in gltf["images"]}
output = bytearray()
for index, view in enumerate(gltf["bufferViews"]):
    start = view.get("byteOffset", 0)
    payload = binary[start:start + view["byteLength"]]
    if index in images:
        image = Image.open(io.BytesIO(payload))
        before = image.size
        image.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
        encoded = io.BytesIO()
        if images[index]["mimeType"] == "image/jpeg":
            image.convert("RGB").save(encoded, "JPEG", quality=92, optimize=True)
        else:
            image.save(encoded, "PNG", optimize=True)
        payload = encoded.getvalue()
        print(f"texture {index}: {before} -> {image.size}, {len(payload):,} bytes")
    output.extend(b"\0" * ((-len(output)) % 4))
    view["byteOffset"] = len(output)
    view["byteLength"] = len(payload)
    output.extend(payload)
output.extend(b"\0" * ((-len(output)) % 4))
gltf["buffers"][0]["byteLength"] = len(output)
encoded_json = json.dumps(gltf, separators=(",", ":")).encode()
encoded_json += b" " * ((-len(encoded_json)) % 4)
total = 12 + 8 + len(encoded_json) + 8 + len(output)
target.write_bytes(struct.pack("<III", 0x46546C67, 2, total)
    + struct.pack("<II", len(encoded_json), 0x4E4F534A) + encoded_json
    + struct.pack("<II", len(output), 0x004E4942) + output)
print(f"GLB: {len(data):,} -> {total:,} bytes; geometry and metadata retained")
