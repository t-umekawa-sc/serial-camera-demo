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
const barcodeReader = new ZXing.MultiFormatReader();

(function configureBarcodeReader() {
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.QR_CODE,
    ZXing.BarcodeFormat.DATA_MATRIX,
    ZXing.BarcodeFormat.AZTEC,
    ZXing.BarcodeFormat.PDF_417,
    ZXing.BarcodeFormat.CODE_128,
    ZXing.BarcodeFormat.CODE_39,
    ZXing.BarcodeFormat.CODE_93,
    ZXing.BarcodeFormat.CODABAR,
    ZXing.BarcodeFormat.ITF,
    ZXing.BarcodeFormat.EAN_13,
    ZXing.BarcodeFormat.EAN_8,
    ZXing.BarcodeFormat.UPC_A,
    ZXing.BarcodeFormat.UPC_E,
  ]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  barcodeReader.setHints(hints);
})();

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
  statusText.textContent = "バーコード読み取り中…枠内にかざし続けてください";
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
    showBarcodeError(
      "枠内のバーコードを読み取れませんでした。位置・ピント・明るさを調整し、ボタンを押したまま少しかざしてください。",
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

  // まず素の画像で読み、ダメなときだけ影補正をかけて再試行する。
  let result = tryDecode(scanCanvas);
  if (!result) {
    const corrected = buildShadowCorrectedCanvas();
    if (corrected) {
      result = tryDecode(corrected);
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
    return barcodeReader.decode(bitmap);
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

function handleBarcode(result) {
  barcodeResult.classList.remove("is-error");
  barcodeLabel.textContent = "バーコード読取";
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
