#!/usr/bin/env python3
"""ガイド枠内に切り出し済みの画像から製造番号(S/N)バーコードを読み取るデモCLI。

pyzbar(ZBar) と OpenCV BarcodeDetector の両エンジンで同じ画像を解析し、
どちらがどの前処理で読めたかを並べて表示する（実機サンプルでの比較用）。

使い方:
    python analyze.py <画像ファイル> [<画像ファイル> ...]
    python analyze.py --json samples/*.jpg
"""

from __future__ import annotations

import argparse
import glob
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

try:
    from pyzbar.pyzbar import decode as zbar_decode
    HAS_PYZBAR = True
except Exception as exc:  # pragma: no cover - 環境不備時のガード
    HAS_PYZBAR = False
    _PYZBAR_IMPORT_ERROR = exc


@dataclass
class Detection:
    engine: str          # "pyzbar" / "opencv"
    symbology: str       # 例: CODE128 / CODE_39
    value: str           # 読み取った文字列
    variant: str = ""    # 成功した前処理名（素画像/グレー/反転 など）


@dataclass
class FileResult:
    path: str
    ok: bool = False
    detections: list[Detection] = field(default_factory=list)
    error: str = ""


# --- 前処理バリアント -------------------------------------------------------
# Webアプリと同じ思想: まず素画像、ダメなら明暗補正・反転で追試する。

def build_variants(image_bgr: np.ndarray) -> list[tuple[str, np.ndarray]]:
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)

    # Otsu二値化（コントラストがはっきりしたラベル向け）
    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # 照明ムラ補正（背景の明るさで割ってフラット化）
    blur = cv2.GaussianBlur(gray, (0, 0), sigmaX=25)
    blur = np.where(blur == 0, 1, blur)
    flat = np.clip(gray.astype(np.float32) / blur.astype(np.float32) * 128.0, 0, 255)
    flat = flat.astype(np.uint8)

    return [
        ("素画像(グレー)", gray),
        ("Otsu二値化", otsu),
        ("照明ムラ補正", flat),
        ("反転(ネガ)", cv2.bitwise_not(gray)),
    ]


# --- pyzbar (ZBar) ----------------------------------------------------------

def analyze_pyzbar(image_bgr: np.ndarray) -> list[Detection]:
    if not HAS_PYZBAR:
        return []

    for variant_name, variant_img in build_variants(image_bgr):
        results = zbar_decode(variant_img)
        if results:
            found: list[Detection] = []
            for r in results:
                try:
                    value = r.data.decode("utf-8", errors="replace")
                except Exception:
                    value = str(r.data)
                found.append(
                    Detection(
                        engine="pyzbar",
                        symbology=r.type,
                        value=value,
                        variant=variant_name,
                    )
                )
            return found
    return []


# --- OpenCV BarcodeDetector -------------------------------------------------

def _make_opencv_detector():
    if hasattr(cv2, "barcode") and hasattr(cv2.barcode, "BarcodeDetector"):
        return cv2.barcode.BarcodeDetector()
    if hasattr(cv2, "barcode_BarcodeDetector"):
        return cv2.barcode_BarcodeDetector()
    return None


def analyze_opencv(image_bgr: np.ndarray) -> list[Detection]:
    detector = _make_opencv_detector()
    if detector is None:
        return []

    # detectAndDecode の戻り値はバージョン差があるため長さで吸収する
    for variant_name, variant_img in [("素画像", image_bgr)] + build_variants(image_bgr):
        img = variant_img
        if img.ndim == 2:
            img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)

        try:
            out = detector.detectAndDecode(img)
        except cv2.error:
            continue

        infos, types = _normalize_opencv_output(out)

        found: list[Detection] = []
        for idx, value in enumerate(infos):
            if not value:
                continue
            sym = types[idx] if idx < len(types) and types[idx] else "?"
            found.append(
                Detection(
                    engine="opencv",
                    symbology=str(sym),
                    value=value,
                    variant=variant_name,
                )
            )
        if found:
            return found
    return []


def _to_str_list(obj) -> list[str]:
    """OpenCVの戻り(単一str / tuple / None)を文字列リストへ正規化。"""
    if obj is None:
        return []
    if isinstance(obj, str):
        return [obj] if obj else []
    if isinstance(obj, (list, tuple)):
        return [str(x) for x in obj]
    return [str(obj)]


def _normalize_opencv_output(out) -> tuple[list[str], list[str]]:
    """detectAndDecode の戻りはバージョンで順序・要素数が異なる。
    座標(ndarray)を除いた非配列要素から「値」「種別」を取り出す。
    """
    elements = list(out)
    # 先頭に成功可否の bool が付くバージョンを除去
    if elements and isinstance(elements[0], (bool, np.bool_)):
        elements = elements[1:]
    # 座標(ndarray)は除外し、残りを [値, 種別] とみなす
    non_array = [el for el in elements if not isinstance(el, np.ndarray)]
    infos = _to_str_list(non_array[0]) if len(non_array) >= 1 else []
    types = _to_str_list(non_array[1]) if len(non_array) >= 2 else []
    return infos, types


def analyze_file(path: str) -> FileResult:
    result = FileResult(path=path)

    image = cv2.imread(path, cv2.IMREAD_COLOR)
    if image is None:
        result.error = "画像を読み込めませんでした（パス／形式を確認）"
        return result

    result.detections.extend(analyze_pyzbar(image))
    result.detections.extend(analyze_opencv(image))
    result.ok = len(result.detections) > 0
    return result


# --- 出力 -------------------------------------------------------------------

def print_human(result: FileResult) -> None:
    name = Path(result.path).name
    print(f"=== {name} ===")

    if result.error:
        print(f"  ✗ エラー: {result.error}\n")
        return

    def show(engine_label: str, engine_key: str) -> None:
        rows = [d for d in result.detections if d.engine == engine_key]
        print(f"  [{engine_label}]")
        if not rows:
            print("    ✗ 検出なし")
            return
        for d in rows:
            variant = f"  (前処理: {d.variant})" if d.variant else ""
            print(f"    ✓ {d.symbology:<10} {d.value}{variant}")

    show("pyzbar (ZBar)", "pyzbar")
    show("OpenCV BarcodeDetector", "opencv")
    print()


def to_json(results: list[FileResult]) -> str:
    payload = []
    for r in results:
        payload.append(
            {
                "path": r.path,
                "ok": r.ok,
                "error": r.error,
                "detections": [
                    {
                        "engine": d.engine,
                        "symbology": d.symbology,
                        "value": d.value,
                        "variant": d.variant,
                    }
                    for d in r.detections
                ],
            }
        )
    return json.dumps(payload, ensure_ascii=False, indent=2)


def expand_paths(patterns: list[str]) -> list[str]:
    paths: list[str] = []
    for pattern in patterns:
        matched = glob.glob(pattern)
        if matched:
            paths.extend(sorted(matched))
        else:
            paths.append(pattern)  # そのまま渡して存在エラーを表示させる
    return paths


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="切り出し済み画像からS/Nバーコードを読み取る（pyzbar / OpenCV 比較）",
    )
    parser.add_argument("paths", nargs="+", help="画像ファイルのパス（glob可）")
    parser.add_argument("--json", action="store_true", help="結果をJSONで出力")
    args = parser.parse_args(argv)

    if not HAS_PYZBAR:
        print(
            f"[警告] pyzbar を利用できません: {_PYZBAR_IMPORT_ERROR}",
            file=sys.stderr,
        )

    results = [analyze_file(p) for p in expand_paths(args.paths)]

    if args.json:
        print(to_json(results))
    else:
        for r in results:
            print_human(r)
        ok = sum(1 for r in results if r.ok)
        print(f"読取成功: {ok}/{len(results)} 件")

    # 1件でも読めなければ非ゼロ終了（バッチ確認用）
    return 0 if all(r.ok for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
