FROM python:3.10-slim

# PaddleOCR/OpenCV が必要とする共有ライブラリ
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .

# 大きな依存を一括で入れると、コンパイル済み拡張(.so)が壊れて import 時に
# "zlib.error: inconsistent stream state" になる事象があるため、段階的に別レイヤで導入する。
RUN pip install --no-cache-dir "numpy==1.26.4"
RUN pip install --no-cache-dir "paddlepaddle==2.6.2"
RUN pip install --no-cache-dir -r requirements.txt
# 一括導入で壊れやすいコンパイル済み拡張はクリーンに入れ直す
#   Cython: paddle が import 時に setuptools 経由で読み込む
#   pyclipper: paddleocr の後処理が import する
RUN pip install --no-cache-dir --force-reinstall --no-deps \
        "Cython==3.0.11" "pyclipper==1.3.0.post5"

# モデルを paddle 非importのクリーンなプロセスで取得・展開して同梱する。
# （paddle import 状態での tar 展開は zlib シンボル衝突で segfault するため）
COPY fetch_models.py .
RUN python fetch_models.py

# 事前展開済みモデルで初期化を検証（DL/展開は走らない＝衝突経路を通らない）。
# lang=japan は日本語＋英数字。実行時はネットワーク不要。
RUN python -c "import paddle; print('paddle', paddle.__version__); \
from paddleocr import PaddleOCR; PaddleOCR(use_angle_cls=True, lang='japan', show_log=False)"

COPY ocr.py .

# 画像は実行時に /data へマウントして渡す
ENTRYPOINT ["python", "ocr.py"]
CMD ["--help"]
