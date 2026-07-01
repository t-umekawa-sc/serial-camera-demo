# OCR 読み取り CLI（Docker / PaddleOCR）

ラベル画像から印字テキスト（製造番号 S/N・型番など）を **PaddleOCR**（`lang=japan`：日本語＋英数字）で読み取るデモCLI。
バーコードが読めないラベルでも印字文字なら読める場合があり、`sn-reader/`（バーコード）の補完として用意した。

検出した全テキスト行を信頼度つきで表示し、あわせて **S/N らしき値**を簡易ヒューリスティック
（`S/N` ラベル直後の英数字／10桁以上の連続数字）で抽出する。

## 使い方

### 1. イメージをビルド

```bash
cd ocr-reader
docker build -t ocr-reader .
```

> PaddleOCR とモデルを同梱するためイメージは大きく、初回ビルドに数分かかる。
> 検出/認識/角度分類モデルはビルド時にダウンロードして焼き込むので、**実行時はネットワーク不要**。

### 2. 画像を解析

リポジトリ直下の `samples/`（実S/Nを含むため git 除外）を `/data` にマウントして実行する。

```bash
cd ocr-reader

# samples/ 内の全画像を解析
docker run --rm -v "$(pwd)/../samples:/data" ocr-reader /data/*.jpg

# 単一ファイル
docker run --rm -v "$(pwd)/../samples:/data" ocr-reader "/data/shared image (2).jpg"

# JSON出力（後段の連携用）
docker run --rm -v "$(pwd)/../samples:/data" ocr-reader --json /data/*.jpg
```

> Windows/WSL で `$(pwd)` が効かない場合は絶対パスを指定するか、PowerShell では `${PWD}` を使う。

## 出力例（イメージ）

```
=== shared image (2).jpg ===
  [検出テキスト]
     0.99  Model:HD-LE2U3-BB
     0.98  S/N: 10606540522247
     0.97  Made in Japan
     ...
  [S/N候補]
    → 10606540522247

テキスト検出: 1/1 件
```

## 位置づけ

- `sn-reader/`（バーコード, pyzbar）と対をなす検証用ツール。バーコードが低解像度・ボケで読めない場合の代替経路として OCR を評価する
- 将来的にはサーバ側で「バーコード読取（pyzbar）＋OCR（PaddleOCR）」を併用し、どちらかで製造番号を確定する構成を想定
