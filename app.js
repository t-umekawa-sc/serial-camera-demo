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
const barcodeValue = document.getElementById("barcodeValue");
const barcodeFormat = document.getElementById("barcodeFormat");
const barcodeToggle = document.getElementById("barcodeToggle");

let capturedImages = [];
let stream = null;
let lastBarcode = "";
let lastBarcodeAt = 0;

// バーコード読み取りはカメラとは独立して動かす。
// カメラの起動・停止は自前で管理し、スキャンだけをON/OFFできるようにする。
let barcodeEnabled = true;
let scanTimer = null;

const scanCanvas = document.createElement("canvas");
const scanCtx = scanCanvas.getContext("2d", { willReadFrequently: true });
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
    updateStatusForBarcode();

    if (barcodeEnabled) {
      startBarcodeScan();
    }
  } catch (error) {
    console.error(error);
    statusText.textContent = "カメラを起動できませんでした";
    alert(
      "カメラを起動できませんでした。\n\n" +
        "HTTPSで開いているか、カメラの許可が有効か確認してください。",
    );
  }
}

function updateStatusForBarcode() {
  statusText.textContent = barcodeEnabled
    ? "ガイド枠に合わせて撮影／バーコードは自動で読み取ります"
    : "ガイド枠に合わせて撮影してください";
}

function startBarcodeScan() {
  if (scanTimer) {
    return;
  }
  scanTimer = setInterval(scanFrame, 250);
}

function stopBarcodeScan() {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
}

function scanFrame() {
  if (!video.videoWidth || !video.videoHeight) {
    return;
  }

  // 解析負荷を抑えるため、最大幅1280に縮小したフレームで読み取る。
  const maxWidth = 1280;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  scanCanvas.width = Math.round(video.videoWidth * scale);
  scanCanvas.height = Math.round(video.videoHeight * scale);
  scanCtx.drawImage(video, 0, 0, scanCanvas.width, scanCanvas.height);

  try {
    const luminance = new ZXing.HTMLCanvasElementLuminanceSource(scanCanvas);
    const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(luminance));
    const result = barcodeReader.decode(bitmap);
    if (result) {
      handleBarcode(result);
    }
  } catch (error) {
    // このフレームでは未検出（NotFoundException等）。無視する。
  } finally {
    barcodeReader.reset();
  }
}

function setBarcodeEnabled(enabled) {
  barcodeEnabled = enabled;

  if (enabled) {
    barcodeToggle.textContent = "バーコード：ON";
    barcodeToggle.classList.remove("is-off");
    if (video.srcObject) {
      startBarcodeScan();
    }
  } else {
    barcodeToggle.textContent = "バーコード：OFF";
    barcodeToggle.classList.add("is-off");
    stopBarcodeScan();
    barcodeResult.classList.add("hidden");
    lastBarcode = "";
  }

  updateStatusForBarcode();
}

function handleBarcode(result) {
  const text = result.getText();
  const now = Date.now();

  // 連続スキャンでは同じコードが何度も来るため、同一値の連投は抑制する。
  if (text === lastBarcode && now - lastBarcodeAt < 1500) {
    return;
  }

  lastBarcode = text;
  lastBarcodeAt = now;

  barcodeValue.textContent = text;
  barcodeFormat.textContent = ZXing.BarcodeFormat[result.getBarcodeFormat()] || "";
  barcodeResult.classList.remove("hidden");

  if (navigator.vibrate) {
    navigator.vibrate(80);
  }
}

function captureGuideArea() {
  if (!video.videoWidth || !video.videoHeight) {
    alert("カメラ映像の準備ができていません。");
    return;
  }

  const videoRect = video.getBoundingClientRect();
  const guideRect = document
    .querySelector(".guide-box")
    .getBoundingClientRect();

  const scaleX = video.videoWidth / videoRect.width;
  const scaleY = video.videoHeight / videoRect.height;

  const sourceX = (guideRect.left - videoRect.left) * scaleX;
  const sourceY = (guideRect.top - videoRect.top) * scaleY;
  const sourceWidth = guideRect.width * scaleX;
  const sourceHeight = guideRect.height * scaleY;

  workCanvas.width = Math.round(sourceWidth);
  workCanvas.height = Math.round(sourceHeight);

  const ctx = workCanvas.getContext("2d");

  ctx.drawImage(
    video,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
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
barcodeToggle.addEventListener("click", () => setBarcodeEnabled(!barcodeEnabled));

updateCaptureCount();
setBarcodeEnabled(barcodeEnabled);
openTipsPanel();
startCamera();
