# 製造番号カメラデモ 通常Web版

スマホのブラウザでカメラを起動し、赤いガイド枠に合わせた部分だけを切り出してプレビューするデモです。

## ファイル構成

```text
serial-camera-web-demo/
├── index.html
├── style.css
├── app.js
└── README.md
```

## GitHub Pagesで確認する方法

1. GitHubで新しいリポジトリを作成します。
2. `index.html`, `style.css`, `app.js`, `README.md` をアップロードします。
3. GitHubのリポジトリ画面で `Settings` → `Pages` を開きます。
4. `Build and deployment` の `Source` を `Deploy from a branch` にします。
5. `Branch` を `main`、フォルダを `/root` にして保存します。
6. 表示された `https://...github.io/...` のURLをスマホで開きます。
7. 「カメラ起動」を押して、カメラ使用を許可します。

## PC内で確認する方法

PCでこのフォルダを開き、以下を実行します。

```bash
python -m http.server 8000
```

PCのブラウザでは以下で確認できます。

```text
http://localhost:8000/
```

スマホからPCへアクセスする場合は、同じWi-Fiに接続した上で以下のように開きます。

```text
http://PCのIPアドレス:8000/
```

ただし、スマホブラウザではHTTPSでないとカメラが動作しない場合があります。その場合はGitHub Pagesで確認してください。

## 動作内容

- ブラウザのカメラAPIで背面カメラを優先して起動します。
- カメラ映像の上に赤いガイド枠を表示します。
- 撮影ボタンを押すと、ガイド枠と同じ比率の範囲を切り出します。
- 切り出した画像を画面下部にプレビュー表示します。

## 次のステップ

次の段階では、切り出した画像をサーバへ送信し、Python + OpenCV + PaddleOCRで製造番号を読み取ります。
