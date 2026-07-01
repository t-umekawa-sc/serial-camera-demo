#!/usr/bin/env python3
"""PaddleOCR のモデルを *paddle を import せずに* 取得・展開する（ビルド時専用）。

paddlepaddle は同梱 zlib と Python 標準 zlib のシンボル衝突があり、paddle を
import した状態で tar を展開すると zlib の inflateReset2 で segfault する。
そこで paddle を一切 import しないクリーンなプロセスで、PaddleOCR が期待する
パスへモデルを先に展開しておく。こうすると PaddleOCR() 初期化時に展開処理が
走らず（＝衝突経路を通らず）、以後の推論も zlib を使わないため安全に動く。

lang=japan（use_angle_cls=True）で使う3モデル:
  - 検出   Multilingual_PP-OCRv3_det
  - 認識   japan_PP-OCRv4_rec
  - 角度分類 ch_ppocr_mobile_v2.0_cls
"""

import os
import shutil
import tarfile
import tempfile
import urllib.request

# target_dir(model_storage_directory) -> model tar URL
MODELS = {
    "/root/.paddleocr/whl/det/ml/Multilingual_PP-OCRv3_det_infer":
        "https://paddleocr.bj.bcebos.com/PP-OCRv3/multilingual/Multilingual_PP-OCRv3_det_infer.tar",
    "/root/.paddleocr/whl/rec/japan/japan_PP-OCRv4_rec_infer":
        "https://paddleocr.bj.bcebos.com/PP-OCRv4/multilingual/japan_PP-OCRv4_rec_infer.tar",
    "/root/.paddleocr/whl/cls/ch_ppocr_mobile_v2.0_cls_infer":
        "https://paddleocr.bj.bcebos.com/dygraph_v2.0/ch/ch_ppocr_mobile_v2.0_cls_infer.tar",
}


def fetch(target_dir: str, url: str) -> None:
    os.makedirs(target_dir, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".tar", delete=False) as tmp:
        tar_path = tmp.name
    try:
        urllib.request.urlretrieve(url, tar_path)
        with tarfile.open(tar_path) as tf:
            for member in tf.getmembers():
                if not member.isfile():
                    continue
                # tar 内は単一トップフォルダ配下なので、ファイル名だけ取り出して平坦化
                fname = os.path.basename(member.name)
                src = tf.extractfile(member)
                if src is None:
                    continue
                with src, open(os.path.join(target_dir, fname), "wb") as dst:
                    shutil.copyfileobj(src, dst)
    finally:
        if os.path.exists(tar_path):
            os.remove(tar_path)
    print("ready:", target_dir, sorted(os.listdir(target_dir)))


def main() -> None:
    for target_dir, url in MODELS.items():
        fetch(target_dir, url)


if __name__ == "__main__":
    main()
