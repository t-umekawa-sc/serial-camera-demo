#!/usr/bin/env python3
"""ラベル画像から印字テキスト（製造番号 S/N など）を読み取るOCRデモCLI。

PaddleOCR（lang=japan：日本語＋英数字）で画像内の全テキスト行を検出・認識し、
信頼度つきで一覧表示する。あわせて S/N らしき値を簡易ヒューリスティックで抽出する。

バーコードが読めないラベルでも、印字文字なら読める場合があるため、
`sn-reader/`（バーコード）の補完として用意した検証用ツール。

使い方:
    python ocr.py <画像ファイル> [<画像ファイル> ...]
    python ocr.py --json samples/*.jpg
"""

from __future__ import annotations

import argparse
import glob
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Line:
    text: str
    confidence: float


@dataclass
class FileResult:
    path: str
    ok: bool = False
    lines: list[Line] = field(default_factory=list)
    sn_candidates: list[str] = field(default_factory=list)
    error: str = ""


# --- S/N 抽出ヒューリスティック --------------------------------------------
# ラベル上の "S/N: 10606540522247" のような値を拾う。
# 1) "S/N" ラベルの直後に続く英数字列、2) 10桁以上の連続数字、を候補にする。

_SN_LABEL = re.compile(r"S\s*/?\s*N[:：]?\s*([A-Za-z0-9\-]{6,})", re.IGNORECASE)
_LONG_DIGITS = re.compile(r"\d{10,}")


def extract_sn_candidates(lines: list[Line]) -> list[str]:
    candidates: list[str] = []

    def add(v: str) -> None:
        v = v.strip()
        if v and v not in candidates:
            candidates.append(v)

    # まず全行を上から連結し、S/Nラベル＋値が別行に割れても拾えるようにする
    joined = " ".join(l.text for l in lines)
    for m in _SN_LABEL.finditer(joined):
        add(m.group(1))

    # ラベル無しでも長い数字列（S/Nは14桁）は候補に
    for l in lines:
        for m in _LONG_DIGITS.finditer(l.text.replace(" ", "")):
            add(m.group(0))

    return candidates


# --- OCR エンジン -----------------------------------------------------------

def _load_ocr():
    """PaddleOCR を1度だけ生成して使い回す。"""
    from paddleocr import PaddleOCR

    return PaddleOCR(use_angle_cls=True, lang="japan", show_log=False)


def analyze_file(ocr, path: str) -> FileResult:
    result = FileResult(path=path)

    if not Path(path).exists():
        result.error = "ファイルが見つかりません"
        return result

    try:
        raw = ocr.ocr(path, cls=True)
    except Exception as exc:  # 認識失敗時のガード
        result.error = f"OCR実行エラー: {exc}"
        return result

    # PaddleOCR 2.7系: raw は画像ごとのリスト。単一画像なら raw[0]。
    # テキスト無しのとき raw[0] が None になることがある。
    entries = raw[0] if raw and raw[0] else []
    for box, (text, conf) in entries:
        result.lines.append(Line(text=text, confidence=float(conf)))

    result.sn_candidates = extract_sn_candidates(result.lines)
    result.ok = len(result.lines) > 0
    return result


# --- 出力 -------------------------------------------------------------------

def print_human(result: FileResult) -> None:
    name = Path(result.path).name
    print(f"=== {name} ===")

    if result.error:
        print(f"  ✗ エラー: {result.error}\n")
        return

    if not result.lines:
        print("  ✗ テキスト検出なし\n")
        return

    print("  [検出テキスト]")
    for l in result.lines:
        print(f"    {l.confidence:5.2f}  {l.text}")

    print("  [S/N候補]")
    if result.sn_candidates:
        for v in result.sn_candidates:
            print(f"    → {v}")
    else:
        print("    （該当なし）")
    print()


def to_json(results: list[FileResult]) -> str:
    payload = []
    for r in results:
        payload.append(
            {
                "path": r.path,
                "ok": r.ok,
                "error": r.error,
                "sn_candidates": r.sn_candidates,
                "lines": [
                    {"text": l.text, "confidence": round(l.confidence, 4)}
                    for l in r.lines
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
        description="ラベル画像から印字テキスト(S/N等)をOCRで読み取る（PaddleOCR）",
    )
    parser.add_argument("paths", nargs="+", help="画像ファイルのパス（glob可）")
    parser.add_argument("--json", action="store_true", help="結果をJSONで出力")
    args = parser.parse_args(argv)

    ocr = _load_ocr()

    results = [analyze_file(ocr, p) for p in expand_paths(args.paths)]

    if args.json:
        print(to_json(results))
    else:
        for r in results:
            print_human(r)
        ok = sum(1 for r in results if r.ok)
        print(f"テキスト検出: {ok}/{len(results)} 件")

    return 0 if all(r.ok for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
