const video = document.getElementById("video");
const workCanvas = document.getElementById("workCanvas");
const captureButton = document.getElementById("captureButton");
const showListButton = document.getElementById("showListButton");
const uploadButton = document.getElementById("uploadButton");
const closeListButton = document.getElementById("closeListButton");
const tipsButton = document.getElementById("tipsButton");
const closeTipsButton = document.getElementById("closeTipsButton");
const tipsOkButton = document.getElementById("tipsOkButton");
const tipsPanel = document.getElementById("tipsPanel");
const listPanel = document.getElementById("listPanel");
const thumbnailList = document.getElementById("thumbnailList");
const statusText = document.getElementById("statusText");
const captureCount = document.getElementById("captureCount");
const barcodeResult = document.getElementById("barcodeResult");
const barcodeLabel = document.getElementById("barcodeLabel");
const barcodeValue = document.getElementById("barcodeValue");
const barcodeFormat = document.getElementById("barcodeFormat");
const readBarcodeButton = document.getElementById("readBarcodeButton");
const scanModeButton = document.getElementById("scanModeButton");
const formatButton = document.getElementById("formatButton");
const formatPanel = document.getElementById("formatPanel");
const closeFormatButton = document.getElementById("closeFormatButton");
const formatOptions = document.getElementById("formatOptions");

let capturedImages = [];
let stream = null;
let scanTimer = null;
let scanGotResult = false;

const scanCanvas = document.createElement("canvas");
const scanCtx = scanCanvas.getContext("2d", { willReadFrequently: true });
// 影補正の出力用と、背景（照明ムラ）推定用の作業キャンバス。
const procCanvas = document.createElement("canvas");
const procCtx = procCanvas.getContext("2d", { willReadFrequently: true });
const bgCanvas = document.createElement("canvas");
const bgCtx = bgCanvas.getContext("2d", { willReadFrequently: true });
// 反転（ネガ）画像の出力用。
const invCanvas = document.createElement("canvas");
const invCtx = invCanvas.getContext("2d", { willReadFrequently: true });
const barcodeReader = new ZXing.MultiFormatReader();

// バーコード（1次元）モードで選べる対象フォーマットの候補。
// 利用者が必要な種類だけを選べるようにし、CODABAR・ITF のような誤読
// （フォールスポジティブ）しやすい形式を外せるようにする。
const BARCODE_FORMAT_OPTIONS = [
  { key: "CODE_128", label: "CODE 128", desc: "英数字・記号／可変長（工業・物流で最多）", format: ZXing.BarcodeFormat.CODE_128 },
  { key: "CODE_39", label: "CODE 39", desc: "英大文字＋数字／前後を * で囲む", format: ZXing.BarcodeFormat.CODE_39 },
  { key: "CODE_93", label: "CODE 93", desc: "CODE 39 の高密度版", format: ZXing.BarcodeFormat.CODE_93 },
  { key: "CODABAR", label: "CODABAR", desc: "数字＋記号（誤読が起きやすい）", format: ZXing.BarcodeFormat.CODABAR },
  { key: "ITF", label: "ITF（Interleaved 2 of 5）", desc: "数字のみ・偶数桁（誤読が起きやすい）", format: ZXing.BarcodeFormat.ITF },
  { key: "EAN_13", label: "EAN-13 / JAN-13", desc: "商品コード 13桁", format: ZXing.BarcodeFormat.EAN_13 },
  { key: "EAN_8", label: "EAN-8 / JAN-8", desc: "商品コード 8桁", format: ZXing.BarcodeFormat.EAN_8 },
  { key: "UPC_A", label: "UPC-A", desc: "商品コード 12桁", format: ZXing.BarcodeFormat.UPC_A },
  { key: "UPC_E", label: "UPC-E", desc: "UPC の短縮形", format: ZXing.BarcodeFormat.UPC_E },
];

// QR（2次元）モードで読む対象。こちらは固定。
const QR_FORMATS = [
  ZXing.BarcodeFormat.QR_CODE,
  ZXing.BarcodeFormat.DATA_MATRIX,
  ZXing.BarcodeFormat.AZTEC,
  ZXing.BarcodeFormat.PDF_417,
];

// バーコードモードで有効なフォーマット（キーの集合）。localStorageに保持。
const BARCODE_FORMAT_STORAGE_KEY = "scanBarcodeFormats";
const ALL_BARCODE_KEYS = BARCODE_FORMAT_OPTIONS.map((o) => o.key);

function loadEnabledBarcodeKeys() {
  try {
    const raw = localStorage.getItem(BARCODE_FORMAT_STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw).filter((k) => ALL_BARCODE_KEYS.includes(k));
      if (saved.length) {
        return new Set(saved);
      }
    }
  } catch (error) {
    // 破損時は既定（全選択）にフォールバック。
  }
  return new Set(ALL_BARCODE_KEYS);
}

let enabledBarcodeKeys = loadEnabledBarcodeKeys();

function saveEnabledBarcodeKeys() {
  try {
    localStorage.setItem(
      BARCODE_FORMAT_STORAGE_KEY,
      JSON.stringify([...enabledBarcodeKeys]),
    );
  } catch (error) {
    // 保存に失敗してもアプリ動作は継続。
  }
}

// 現在の読み取りモード（"barcode" | "qr"）。既定はバーコード。
let scanMode = "barcode";

// 現在の読み取りヒント。decode() 呼び出し時に毎回渡す必要がある。
// （ZXingの MultiFormatReader.decode(image) を引数なしで呼ぶと内部で
//  setHints(undefined) が走り、全フォーマットに戻ってしまうため）
let scanHints = new Map();

// 現在のモードと選択に合わせてZXingの対象フォーマットを設定する。
function applyScanFormats() {
  let formats;
  if (scanMode === "qr") {
    formats = QR_FORMATS;
  } else {
    formats = BARCODE_FORMAT_OPTIONS.filter((o) =>
      enabledBarcodeKeys.has(o.key),
    ).map((o) => o.format);
    // 1つも選ばれていなければ全候補で読む（無効化を防ぐ）。
    if (formats.length === 0) {
      formats = BARCODE_FORMAT_OPTIONS.map((o) => o.format);
    }
  }

  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  scanHints = hints;
  barcodeReader.setHints(hints);
}

applyScanFormats();

// モードに応じてボタン表示を更新する。
function updateScanModeUI() {
  const isQr = scanMode === "qr";
  readBarcodeButton.textContent = isQr ? "QR読取（長押し）" : "バーコード読取（長押し）";
  if (scanModeButton) {
    scanModeButton.textContent = isQr ? "読取種別：QR" : "読取種別：バーコード";
    scanModeButton.setAttribute("aria-pressed", String(isQr));
  }
  if (formatButton) {
    // 読取対象の選択はバーコードモードにのみ効くため、QR時は無効化。
    formatButton.disabled = isQr;
  }
}

// 読取対象バーコードのチェックリストを生成する。
function buildFormatOptions() {
  if (!formatOptions) {
    return;
  }
  formatOptions.textContent = "";
  for (const opt of BARCODE_FORMAT_OPTIONS) {
    const row = document.createElement("label");
    row.className = "format-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = enabledBarcodeKeys.has(opt.key);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        enabledBarcodeKeys.add(opt.key);
      } else {
        enabledBarcodeKeys.delete(opt.key);
      }
      saveEnabledBarcodeKeys();
      applyScanFormats();
    });

    const text = document.createElement("span");
    text.className = "format-text";
    const name = document.createElement("span");
    name.className = "fmt-name";
    name.textContent = opt.label;
    const desc = document.createElement("span");
    desc.className = "fmt-desc";
    desc.textContent = opt.desc;
    text.append(name, desc);

    row.append(checkbox, text);
    formatOptions.append(row);
  }
}

function openFormatPanel() {
  buildFormatOptions();
  formatPanel.classList.remove("hidden");
}

function closeFormatPanel() {
  formatPanel.classList.add("hidden");
}

// バーコード ⇄ QR を切り替える。読み取り中は切り替えない。
function toggleScanMode() {
  if (scanTimer) {
    return;
  }
  scanMode = scanMode === "barcode" ? "qr" : "barcode";
  applyScanFormats();
  updateScanModeUI();
  barcodeResult.classList.add("hidden");
}

updateScanModeUI();

async function startCamera() {
  try {
    captureButton.disabled = true;
    readBarcodeButton.disabled = true;
    statusText.textContent = "カメラ起動中...";

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });

    video.srcObject = stream;

    await new Promise((resolve) => {
      video.onloadedmetadata = () => resolve();
    });

    await video.play();

    captureButton.disabled = false;
    readBarcodeButton.disabled = false;
    statusText.textContent =
      "ガイド枠に合わせて撮影／「バーコード読み取り」で枠内を読み取り";
  } catch (error) {
    console.error(error);
    statusText.textContent = "カメラを起動できませんでした";
    alert(
      "カメラを起動できませんでした。\n\n" +
        "HTTPSで開いているか、カメラの許可が有効か確認してください。",
    );
  }
}

// ガイド枠に対応する映像内（ソース）の矩形を求める。
// 撮影とバーコード読み取りで同じ範囲を切り出すために共通化している。
function getGuideSourceRect() {
  const videoRect = video.getBoundingClientRect();
  const guideRect = document.querySelector(".guide-box").getBoundingClientRect();

  const scaleX = video.videoWidth / videoRect.width;
  const scaleY = video.videoHeight / videoRect.height;

  return {
    x: (guideRect.left - videoRect.left) * scaleX,
    y: (guideRect.top - videoRect.top) * scaleY,
    width: guideRect.width * scaleX,
    height: guideRect.height * scaleY,
  };
}

// ボタンを押している間、ガイド枠内を連続で読み取り続ける。
// 影で1フレーム失敗しても、押している間に読めたフレームで成功にできる。
function startHoldScan() {
  if (scanTimer) {
    return;
  }
  if (!video.videoWidth || !video.videoHeight) {
    showBarcodeError("カメラ映像の準備ができていません。");
    return;
  }

  scanGotResult = false;
  barcodeResult.classList.add("hidden");
  const codeName = scanMode === "qr" ? "QR" : "バーコード";
  statusText.textContent = `${codeName}読み取り中…枠内にかざし続けてください`;
  readBarcodeButton.classList.add("is-scanning");

  scanTimer = setInterval(scanGuideArea, 200);
}

function stopHoldScan() {
  if (!scanTimer) {
    return;
  }

  clearInterval(scanTimer);
  scanTimer = null;
  readBarcodeButton.classList.remove("is-scanning");

  if (!scanGotResult) {
    const codeName = scanMode === "qr" ? "QR" : "バーコード";
    showBarcodeError(
      `枠内の${codeName}を読み取れませんでした。位置・ピント・明るさを調整し、ボタンを押したまま少しかざしてください。`,
    );
    statusText.textContent =
      "ガイド枠に合わせて撮影／「バーコード読み取り」で枠内を読み取り";
  }
}

function scanGuideArea() {
  if (scanGotResult || !video.videoWidth || !video.videoHeight) {
    return;
  }

  // ガイド枠内だけを切り出す。
  const rect = getGuideSourceRect();
  scanCanvas.width = Math.round(rect.width);
  scanCanvas.height = Math.round(rect.height);
  scanCtx.drawImage(
    video,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    scanCanvas.width,
    scanCanvas.height,
  );

  // 素 → 影補正 → 反転（ネガ）の順に、読めるまで試す。
  let result = tryDecode(scanCanvas);
  if (!result) {
    const corrected = buildShadowCorrectedCanvas();
    if (corrected) {
      result = tryDecode(corrected);
    }
    if (!result) {
      // 黒地に白バー等の反転印字に備えて、ネガ画像でも試す。
      const inverted = buildInvertedCanvas(corrected || scanCanvas);
      if (inverted) {
        result = tryDecode(inverted);
      }
    }
  }

  if (result) {
    // 読めたら成功として連続試行を止める。
    scanGotResult = true;
    handleBarcode(result);
    statusText.textContent = "読み取りました。";
    stopHoldScan();
  }
}

// 1枚のキャンバスをZXingで解析する。未検出なら null。
function tryDecode(canvas) {
  try {
    const luminance = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
    const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(luminance));
    // ヒントを毎回渡してモードのフォーマット制限を効かせる（QR混入防止）。
    return barcodeReader.decode(bitmap, scanHints);
  } catch (error) {
    return null;
  } finally {
    barcodeReader.reset();
  }
}

// 影補正：背景の明るさ分布で割って照明ムラを平坦化し、軽くコントラストを強調する。
function buildShadowCorrectedCanvas() {
  const w = scanCanvas.width;
  const h = scanCanvas.height;
  if (!w || !h) {
    return null;
  }

  const src = scanCtx.getImageData(0, 0, w, h);
  const data = src.data;

  // 縮小描画で背景（照明ムラ）をぼかして推定する。
  const bw = Math.max(8, Math.min(48, Math.round(w / 12)));
  const bh = Math.max(8, Math.min(48, Math.round(h / 12)));
  bgCanvas.width = bw;
  bgCanvas.height = bh;
  bgCtx.imageSmoothingEnabled = true;
  bgCtx.drawImage(scanCanvas, 0, 0, w, h, 0, 0, bw, bh);
  const bg = bgCtx.getImageData(0, 0, bw, bh).data;

  procCanvas.width = w;
  procCanvas.height = h;
  const out = procCtx.createImageData(w, h);
  const outData = out.data;

  for (let y = 0; y < h; y++) {
    const byRow = Math.min(bh - 1, ((y * bh) / h) | 0) * bw;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;

      const bi = (byRow + Math.min(bw - 1, ((x * bw) / w) | 0)) * 4;
      const bgGray =
        bg[bi] * 0.299 + bg[bi + 1] * 0.587 + bg[bi + 2] * 0.114 || 1;

      // 照明ムラ補正（背景で割って平坦化）＋軽いコントラスト強調。
      let v = (gray * 128) / bgGray;
      v = (v - 128) * 1.4 + 128;
      v = v < 0 ? 0 : v > 255 ? 255 : v;

      outData[i] = outData[i + 1] = outData[i + 2] = v;
      outData[i + 3] = 255;
    }
  }

  procCtx.putImageData(out, 0, 0);
  return procCanvas;
}

// 反転（ネガ）画像を作る。元のキャンバスは変更しない。
function buildInvertedCanvas(sourceCanvas) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  if (!w || !h) {
    return null;
  }

  const img = sourceCanvas.getContext("2d").getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    const v = 255 - gray;
    d[i] = d[i + 1] = d[i + 2] = v;
  }

  invCanvas.width = w;
  invCanvas.height = h;
  invCtx.putImageData(img, 0, 0);
  return invCanvas;
}

function handleBarcode(result) {
  barcodeResult.classList.remove("is-error");
  barcodeLabel.textContent = scanMode === "qr" ? "QR読取" : "バーコード読取";
  barcodeValue.textContent = result.getText();
  barcodeFormat.textContent =
    ZXing.BarcodeFormat[result.getBarcodeFormat()] || "";
  barcodeResult.classList.remove("hidden");

  if (navigator.vibrate) {
    navigator.vibrate(80);
  }
}

function showBarcodeError(message) {
  barcodeResult.classList.add("is-error");
  barcodeLabel.textContent = "読み取り失敗";
  barcodeValue.textContent = message;
  barcodeFormat.textContent = "";
  barcodeResult.classList.remove("hidden");
}

function captureGuideArea() {
  if (!video.videoWidth || !video.videoHeight) {
    alert("カメラ映像の準備ができていません。");
    return;
  }

  const rect = getGuideSourceRect();

  workCanvas.width = Math.round(rect.width);
  workCanvas.height = Math.round(rect.height);

  const ctx = workCanvas.getContext("2d");

  ctx.drawImage(
    video,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    workCanvas.width,
    workCanvas.height,
  );

  workCanvas.toBlob(
    (blob) => {
      if (!blob) {
        alert("画像の作成に失敗しました。");
        return;
      }

      const imageUrl = URL.createObjectURL(blob);
      const now = new Date();

      capturedImages.push({
        id: createImageId(now),
        blob,
        imageUrl,
        capturedAt: now,
      });

      updateCaptureCount();
      statusText.textContent = "撮影しました。続けて撮影できます。";
    },
    "image/jpeg",
    0.9,
  );
}

function createImageId(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const seq = String(capturedImages.length + 1).padStart(3, "0");

  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}_${seq}`;
}

function updateCaptureCount() {
  captureCount.textContent = `撮影済み：${capturedImages.length}枚`;
  uploadButton.disabled = capturedImages.length === 0;
  showListButton.disabled = capturedImages.length === 0;
}

function openListPanel() {
  renderThumbnailList();
  listPanel.classList.remove("hidden");
}

function closeListPanel() {
  listPanel.classList.add("hidden");
}

function openTipsPanel() {
  tipsPanel.classList.remove("hidden");
}

function closeTipsPanel() {
  tipsPanel.classList.add("hidden");
}

function renderThumbnailList() {
  thumbnailList.innerHTML = "";

  if (capturedImages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-message";
    empty.textContent = "撮影済み画像はありません。";
    thumbnailList.appendChild(empty);
    return;
  }

  capturedImages.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "thumbnail-card";

    const img = document.createElement("img");
    img.src = item.imageUrl;
    img.alt = `撮影画像 ${index + 1}`;

    const info = document.createElement("div");
    info.className = "thumbnail-info";

    const title = document.createElement("strong");
    title.textContent = `${index + 1}枚目`;

    const dateText = document.createElement("div");
    dateText.textContent = formatDateTime(item.capturedAt);

    const idText = document.createElement("div");
    idText.textContent = item.id;

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "削除";
    deleteButton.addEventListener("click", () => {
      deleteCapturedImage(item.id);
    });

    info.appendChild(title);
    info.appendChild(dateText);
    info.appendChild(idText);
    info.appendChild(deleteButton);

    card.appendChild(img);
    card.appendChild(info);

    thumbnailList.appendChild(card);
  });
}

function deleteCapturedImage(id) {
  const target = capturedImages.find((item) => item.id === id);

  if (target) {
    URL.revokeObjectURL(target.imageUrl);
  }

  capturedImages = capturedImages.filter((item) => item.id !== id);

  updateCaptureCount();
  renderThumbnailList();
}

function uploadAllImages() {
  if (capturedImages.length === 0) {
    alert("アップロード対象の画像がありません。");
    return;
  }

  const formData = new FormData();

  capturedImages.forEach((item, index) => {
    formData.append("images", item.blob, `${item.id}.jpg`);

    formData.append(
      `metadata_${index}`,
      JSON.stringify({
        id: item.id,
        capturedAt: item.capturedAt.toISOString(),
      }),
    );
  });

  console.log("アップロード用FormData", formData);

  alert(
    "デモのため、実際のアップロードは行っていません。\n\n" +
      `${capturedImages.length}枚の画像を一括アップロードする想定です。`,
  );

  /*
  実運用では、例えば以下のようにFastAPIへ送信します。

  fetch("/api/upload-serial-images", {
    method: "POST",
    body: formData
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error("アップロードに失敗しました");
      }
      return response.json();
    })
    .then((data) => {
      console.log(data);
      alert("アップロードしました");
    })
    .catch((error) => {
      console.error(error);
      alert("アップロードに失敗しました");
    });
  */
}

function formatDateTime(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");

  return `${yyyy}/${mm}/${dd} ${hh}:${mi}:${ss}`;
}

captureButton.addEventListener("click", captureGuideArea);
showListButton.addEventListener("click", openListPanel);
uploadButton.addEventListener("click", uploadAllImages);
closeListButton.addEventListener("click", closeListPanel);
tipsButton.addEventListener("click", openTipsPanel);
closeTipsButton.addEventListener("click", closeTipsPanel);
tipsOkButton.addEventListener("click", closeTipsPanel);
scanModeButton.addEventListener("click", toggleScanMode);
formatButton.addEventListener("click", openFormatPanel);
closeFormatButton.addEventListener("click", closeFormatPanel);

// 押している間だけ連続スキャン。指を離す／外すと停止。
readBarcodeButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  readBarcodeButton.setPointerCapture?.(event.pointerId);
  startHoldScan();
});
readBarcodeButton.addEventListener("pointerup", stopHoldScan);
readBarcodeButton.addEventListener("pointercancel", stopHoldScan);
readBarcodeButton.addEventListener("contextmenu", (event) =>
  event.preventDefault(),
);

updateCaptureCount();
openTipsPanel();
startCamera();
