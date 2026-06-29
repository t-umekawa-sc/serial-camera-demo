const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const preview = document.getElementById("preview");
const message = document.getElementById("message");
const startButton = document.getElementById("startButton");
const captureButton = document.getElementById("captureButton");
const stopButton = document.getElementById("stopButton");

let currentStream = null;

function setMessage(text) {
  message.textContent = text;
}

function setCameraButtons(isRunning) {
  startButton.disabled = isRunning;
  captureButton.disabled = !isRunning;
  stopButton.disabled = !isRunning;
}

async function startCamera() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMessage("このブラウザはカメラAPIに対応していません。");
      return;
    }

    stopCamera();

    currentStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    video.srcObject = currentStream;
    await video.play();

    setCameraButtons(true);
    setMessage("赤枠に製造番号を合わせて、撮影してください。");
  } catch (error) {
    console.error(error);
    setCameraButtons(false);

    if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      setMessage("カメラを使うにはHTTPS環境が必要な場合があります。GitHub Pagesなどで開いてください。");
      return;
    }

    if (error.name === "NotAllowedError") {
      setMessage("カメラの使用が許可されませんでした。ブラウザの権限設定を確認してください。");
    } else if (error.name === "NotFoundError") {
      setMessage("利用できるカメラが見つかりませんでした。");
    } else {
      setMessage(`カメラ起動に失敗しました: ${error.message}`);
    }
  }
}

function stopCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
    currentStream = null;
  }

  video.srcObject = null;
  setCameraButtons(false);
}

function captureGuideArea() {
  if (!video.videoWidth || !video.videoHeight) {
    setMessage("カメラ映像の準備ができていません。");
    return;
  }

  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;

  // CSSのガイド枠と同じ比率
  const guide = {
    x: 0.08,
    y: 0.43,
    width: 0.84,
    height: 0.14
  };

  const sx = Math.round(sourceWidth * guide.x);
  const sy = Math.round(sourceHeight * guide.y);
  const sw = Math.round(sourceWidth * guide.width);
  const sh = Math.round(sourceHeight * guide.height);

  canvas.width = sw;
  canvas.height = sh;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);

  const imageUrl = canvas.toDataURL("image/jpeg", 0.92);
  preview.src = imageUrl;
  preview.style.display = "block";

  setMessage("赤枠内を切り出しました。次の段階で、この画像をOCRに渡します。");
}

startButton.addEventListener("click", startCamera);
captureButton.addEventListener("click", captureGuideArea);
stopButton.addEventListener("click", () => {
  stopCamera();
  setMessage("カメラを停止しました。");
});

window.addEventListener("pagehide", stopCamera);
