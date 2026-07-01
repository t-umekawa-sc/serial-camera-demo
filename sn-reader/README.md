# S/N 読み取り CLI（Docker）

ガイド枠内に切り出し済みの画像ファイルから、製造番号(S/N)バーコードを読み取るデモCLI。
**pyzbar(ZBar)** と **OpenCV BarcodeDetector** の両エンジンで同じ画像を解析し、
どちらがどの前処理で読めたかを並べて表示する（実機サンプルでの読取率比較用）。

まだWebアプリ化はしていない。Webアプリ側の「保存/共有」で取得した枠内切り出し
済みJPEGを `samples/` に置いて解析する想定。

## 使い方

### 1. イメージをビルド

```bash
cd sn-reader
docker build -t sn-reader .
```

### 2. 画像を解析

解析したい画像を `sn-reader/samples/` に置き、`samples/` を `/data` にマウントして実行する。

```bash
# samples/ 内の全画像を解析
docker run --rm -v "$(pwd)/samples:/data" sn-reader /data/*.jpg

# 単一ファイル
docker run --rm -v "$(pwd)/samples:/data" sn-reader /data/20260701_120000_001.jpg

# JSON出力（後段の連携用）
docker run --rm -v "$(pwd)/samples:/data" sn-reader --json /data/*.jpg
```

> Windows/WSL で `$(pwd)` が効かない場合は絶対パスを指定するか、PowerShell では `${PWD}` を使う。

### 出力例

```
=== test_code128.png ===
  [pyzbar (ZBar)]
    ✓ CODE128    BUF-SN-0123456  (前処理: 素画像(グレー))
  [OpenCV BarcodeDetector]
    ✗ 検出なし

=== test_code39.png ===
  [pyzbar (ZBar)]
    ✓ CODE39     MGT-2026-001    (前処理: 素画像(グレー))
  [OpenCV BarcodeDetector]
    ✓ ?          65631560        (前処理: 照明ムラ補正)  ← 誤読

読取成功: 2/2 件
```

## 現時点の知見（エンジン比較）

- **pyzbar(ZBar) が本命**。CODE 128・CODE 39 とも安定して読める。
- **OpenCV BarcodeDetector は不向き**。バーコードモジュールは実質 **EAN/UPC（商品コード）専用**で、
  CODE 128 は検出できず、CODE 39 を数字列に**誤読**することがある（上例）。
  対象が CODE 39（管理番号）/ CODE 128（Buffalo S/N）である本用途では採用しない見込み。
- 比較のため両エンジンは残してあるが、実運用は pyzbar を軸にする想定。

## 解析の流れ

Webアプリと同じ「まず素画像、ダメなら明暗補正・反転で追試」の思想。

1. 素画像（グレースケール）
2. Otsu二値化
3. 照明ムラ補正（背景の明るさで割ってフラット化）
4. 反転（ネガ）

各エンジンで上から順に試し、読めた時点でその画像の結果とする。

## Docker を使わない場合（参考）

```bash
pip install -r requirements.txt   # 別途 libzbar が必要（apt install libzbar0 等）
python analyze.py samples/*.jpg
```

## 今後

- 実機サンプルで pyzbar / OpenCV の読取率を比較し、採用エンジンを決定
- S/N のフォーマット検証（CODE 39=管理番号 / CODE 128=Buffalo S/N）
- 将来的にサーバ側OCR（PaddleOCR）と統合し、Webアプリからの実アップロードと連携
