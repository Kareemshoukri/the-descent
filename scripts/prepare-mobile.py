"""Create mobile texture variants; preserve geometry, bones and animation bytes."""
import io
import json
import struct
from pathlib import Path
from PIL import Image

models = Path(__file__).resolve().parents[1] / "public" / "models"
for name in ("q930", "manta-ray", "dutch-ship"):
    data = (models / f"{name}.glb").read_bytes()
    size = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + size])
    binary = data[28 + size:]
    images = {item["bufferView"]: item for item in gltf.get("images", [])}
    output = bytearray()
    for index, view in enumerate(gltf["bufferViews"]):
        start = view.get("byteOffset", 0)
        payload = binary[start:start + view["byteLength"]]
        if index in images:
            image = Image.open(io.BytesIO(payload))
            image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
            encoded = io.BytesIO()
            if images[index]["mimeType"] == "image/jpeg":
                image.convert("RGB").save(encoded, "JPEG", quality=85, optimize=True)
            else:
                image.save(encoded, "PNG", optimize=True)
            payload = encoded.getvalue()
        output.extend(b"\0" * (-len(output) % 4))
        view["byteOffset"] = len(output)
        view["byteLength"] = len(payload)
        output.extend(payload)
        if index not in images:
            assert output[view["byteOffset"]:view["byteOffset"] + view["byteLength"]] == binary[start:start + view["byteLength"]]
    output.extend(b"\0" * (-len(output) % 4))
    gltf["buffers"][0]["byteLength"] = len(output)
    metadata = json.dumps(gltf, separators=(",", ":")).encode()
    metadata += b" " * (-len(metadata) % 4)
    total = 28 + len(metadata) + len(output)
    (models / f"{name}-mobile.glb").write_bytes(
        struct.pack("<III", 0x46546C67, 2, total)
        + struct.pack("<II", len(metadata), 0x4E4F534A) + metadata
        + struct.pack("<II", len(output), 0x004E4942) + output)
    print(f"{name}: {len(data)/1e6:.2f} MB -> {total/1e6:.2f} MB; geometry and animation preserved")
