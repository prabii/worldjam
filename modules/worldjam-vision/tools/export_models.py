"""
Exports the WorldJam everyday-objects detector: YOLOE-26s with a fixed vocabulary.

YOLOE-26s rather than 26n: on COCO128 household classes 26s with LVIS-style
prompts matched YOLO26n-COCO recall (0.38) while 26n reached 0.33.

YOLOE is open-vocabulary: the class list below is embedded into the weights at
export time, so the shipped model only knows these objects. People, hands,
faces, animals and vehicles are deliberately absent -- the model cannot detect
what is not in its vocabulary, so a hand striking a cup is never announced.

Usage (from an environment with `pip install ultralytics onnx onnxslim`):

    python export_models.py --out ../android/src/main/assets/models

Produces:
    yoloe26s_worldjam.onnx            fp32, ONNX Runtime CPU fallback (NCHW)
    yoloe26s_worldjam_v81_qnn.onnx    W8A16 QNN context binary for Hexagon HTP v81
    worldjam_vocab.txt                one label per line, index = class id

Then update model_manifest.json with the printed SHA-256 values.
"""

import argparse
import hashlib
import shutil
from pathlib import Path

# Index order is the class id. Each entry is (prompt, label): the prompt is the
# text YOLOE embeds -- LVIS/COCO-style wording ("cell phone", "wristwatch")
# measurably beats plain words ("phone", "watch") -- and the label is what the
# app shows and speaks. Keep objects distinct: near-synonyms split confidence.
VOCAB = [
    # stationery
    ("pen", "pen"), ("pencil", "pencil"), ("marker", "marker"), ("notebook", "notebook"),
    ("book", "book"), ("scissors", "scissors"), ("stapler", "stapler"), ("calculator", "calculator"),
    ("tape", "tape"),
    # wearables / personal
    ("wristwatch", "watch"), ("eyeglasses", "glasses"), ("sunglasses", "sunglasses"),
    ("headphones", "headphones"), ("earbuds", "earbuds"), ("wallet", "wallet"), ("key", "keys"),
    ("ring", "ring"),
    # devices
    ("cell phone", "phone"), ("laptop", "laptop"), ("tablet computer", "tablet"),
    ("computer keyboard", "keyboard"), ("computer mouse", "mouse"), ("computer monitor", "monitor"),
    ("remote control", "remote"), ("charger", "charger"), ("loudspeaker", "speaker"), ("camera", "camera"),
    # kitchen
    ("cup", "cup"), ("mug", "mug"), ("wine glass", "glass"), ("bottle", "bottle"),
    ("water bottle", "water bottle"), ("can", "can"), ("bowl", "bowl"), ("plate", "plate"),
    ("spoon", "spoon"), ("fork", "fork"), ("knife", "knife"),
    # furniture / home
    ("dining table", "table"), ("desk", "desk"), ("chair", "chair"), ("lamp", "lamp"), ("clock", "clock"),
    ("potted plant", "plant"), ("box", "box"), ("handbag", "bag"), ("backpack", "backpack"),
    ("candle", "candle"), ("toy", "toy"), ("ball", "ball"), ("comb", "comb"), ("toothbrush", "toothbrush"),
]
PROMPTS = [p for p, _ in VOCAB]
LABELS = [l for _, l in VOCAB]


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--weights", default="yoloe-26s-seg.pt")
    # W8A16 calibration set; the 4-image default is too small for stable quantisation.
    ap.add_argument("--calib", default="coco128-seg.yaml")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--skip-qnn", action="store_true")
    args = ap.parse_args()

    from ultralytics import YOLOE

    args.out.mkdir(parents=True, exist_ok=True)
    assert len(PROMPTS) == len(set(PROMPTS)) and len(LABELS) == len(set(LABELS)), "duplicate vocabulary entries"

    model = YOLOE(args.weights)
    model.set_classes(PROMPTS)

    onnx_src = Path(model.export(format="onnx", imgsz=args.imgsz, simplify=True))
    onnx_dst = args.out / "yoloe26s_worldjam.onnx"
    shutil.copyfile(onnx_src, onnx_dst)

    outputs = [onnx_dst]
    if not args.skip_qnn:
        model = YOLOE(args.weights)
        model.set_classes(PROMPTS)
        qnn_src = Path(model.export(format="qnn", name="81", imgsz=args.imgsz, data=args.calib))
        qnn_dst = args.out / "yoloe26s_worldjam_v81_qnn.onnx"
        shutil.copyfile(qnn_src, qnn_dst)
        outputs.append(qnn_dst)

    vocab_path = args.out / "worldjam_vocab.txt"
    vocab_path.write_text("\n".join(LABELS) + "\n", encoding="utf-8", newline="\n")

    print(f"classes: {len(LABELS)}")
    for p in outputs + [vocab_path]:
        print(f"{p.name}  {p.stat().st_size}  sha256={sha256(p)}")


if __name__ == "__main__":
    main()
