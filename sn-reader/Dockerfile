FROM python:3.12-slim

# pyzbar は libzbar0、OpenCV(headless) は libglib2.0-0 を必要とする
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libzbar0 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY analyze.py .

# 画像は実行時に /data へマウントして渡す
ENTRYPOINT ["python", "analyze.py"]
CMD ["--help"]
