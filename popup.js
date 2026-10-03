const statusElement = document.getElementById('status');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_CLIPBOARD_BYTES = 7_500_000;
const MIN_IMAGE_SCALE = 0.5;

function setStatus(message, kind = '') {
  statusElement.textContent = message;
  statusElement.className = kind;
}

async function runInPage(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args
  });
  return results[0].result;
}

function getPageSize() {
  const root = document.documentElement;
  const body = document.body;
  return {
    width: Math.max(root.scrollWidth, body?.scrollWidth || 0, innerWidth),
    height: Math.max(root.scrollHeight, body?.scrollHeight || 0, innerHeight),
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    scrollX,
    scrollY
  };
}

async function scrollPage(x, y) {
  window.scrollTo({ left: x, top: y, behavior: 'instant' });
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return { x: scrollX, y: scrollY };
}

function positions(size, viewport) {
  const last = Math.max(0, size - viewport);
  const values = [0];
  for (let position = viewport; position < last; position += viewport) {
    values.push(position);
  }
  if (last > 0 && values.at(-1) !== last) values.push(last);
  return values;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Ein Bildausschnitt konnte nicht gelesen werden.'));
    image.src = url;
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob
      ? resolve(blob)
      : reject(new Error('Das PNG konnte nicht erstellt werden.')), 'image/png');
  });
}

function quantizeChannel(value) {
  // Keep the rounded 256 value until it can be clamped to white.
  return Math.min(255, (value + 4) & ~7);
}

async function compressColors(canvas) {
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) throw new Error('Das Bild konnte nicht komprimiert werden.');

  // Preserve dimensions and alpha. Rounding RGB to 32 levels per channel
  // removes low-visibility color noise so PNG compresses much better.
  const rowsPerChunk = 256;
  for (let y = 0; y < canvas.height; y += rowsPerChunk) {
    const height = Math.min(rowsPerChunk, canvas.height - y);
    const pixels = context.getImageData(0, y, canvas.width, height);
    const rgba = pixels.data;
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = quantizeChannel(rgba[i]);
      rgba[i + 1] = quantizeChannel(rgba[i + 1]);
      rgba[i + 2] = quantizeChannel(rgba[i + 2]);
    }
    context.putImageData(pixels, 0, y);
    await pause(0);
  }
}

function nextImageScale(currentScale, byteSize) {
  const safety = byteSize > MAX_CLIPBOARD_BYTES * 1.2 ? 0.88 : 0.95;
  const proposal = currentScale * Math.sqrt(MAX_CLIPBOARD_BYTES / byteSize) * safety;
  return Math.max(MIN_IMAGE_SCALE, Math.min(currentScale - 0.05, proposal));
}

async function makeClipboardImage(sourceCanvas) {
  await compressColors(sourceCanvas);
  let candidate = sourceCanvas;
  let scale = 1;

  while (true) {
    const blob = await canvasToBlob(candidate);
    if (blob.size <= MAX_CLIPBOARD_BYTES) return { blob, scale };
    if (scale <= MIN_IMAGE_SCALE) {
      throw new Error('Die Seite ist für ein Bild unter 8 MB zu groß.');
    }

    const nextScale = nextImageScale(scale, blob.size);
    if (candidate !== sourceCanvas) {
      candidate.width = 0;
      candidate.height = 0;
    }
    candidate = document.createElement('canvas');
    candidate.width = Math.max(1, Math.round(sourceCanvas.width * nextScale));
    candidate.height = Math.max(1, Math.round(sourceCanvas.height * nextScale));
    const context = candidate.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!context) throw new Error('Das Bild konnte nicht verkleinert werden.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(sourceCanvas, 0, 0, candidate.width, candidate.height);
    setStatus('Bild wird auf unter 8 MB angepasst …');
    await compressColors(candidate);
    scale = nextScale;
  }
}

async function capture() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || tab.windowId == null) throw new Error('Kein aktiver Tab gefunden.');

  let page;
  try {
    page = await runInPage(tab.id, getPageSize);
    const xs = positions(page.width, page.viewportWidth);
    const ys = positions(page.height, page.viewportHeight);
    const count = xs.length * ys.length;
    let canvas;
    let context;
    let scaleX;
    let scaleY;
    let captured = 0;

    for (let row = 0; row < ys.length; row++) {
      for (let col = 0; col < xs.length; col++) {
        const actual = await runInPage(tab.id, scrollPage, [xs[col], ys[row]]);
        await pause(250);
        if (captured > 0) await pause(550); // Chrome allows at most two tab captures per second.
        const image = await loadImage(await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }));

        if (!canvas) {
          scaleX = image.width / page.viewportWidth;
          scaleY = image.height / page.viewportHeight;
          const pixelWidth = Math.round(page.width * scaleX);
          const pixelHeight = Math.round(page.height * scaleY);
          if (pixelWidth > 32767 || pixelHeight > 32767 || pixelWidth * pixelHeight > 50_000_000) {
            throw new Error('Die Seite ist für ein einzelnes Zwischenablage-Bild zu groß.');
          }
          canvas = document.createElement('canvas');
          canvas.width = pixelWidth;
          canvas.height = pixelHeight;
          context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
          if (!context) throw new Error('Die Bildfläche konnte nicht erstellt werden.');
          context.fillStyle = '#fff';
          context.fillRect(0, 0, pixelWidth, pixelHeight);
        }

        const left = col === 0 ? 0 : xs[col - 1] + page.viewportWidth;
        const top = row === 0 ? 0 : ys[row - 1] + page.viewportHeight;
        const right = Math.min(page.width, actual.x + page.viewportWidth);
        const bottom = Math.min(page.height, actual.y + page.viewportHeight);
        const width = right - left;
        const height = bottom - top;
        if (width <= 0 || height <= 0) throw new Error('Die Seite ließ sich nicht vollständig scrollen.');

        context.drawImage(
          image,
          (left - actual.x) * scaleX, (top - actual.y) * scaleY,
          width * scaleX, height * scaleY,
          left * scaleX, top * scaleY,
          width * scaleX, height * scaleY
        );
        captured++;
        setStatus(`Aufnahme ${captured} von ${count} …`);

      }
    }

    setStatus('Bild wird komprimiert …');
    const { blob, scale } = await makeClipboardImage(canvas);
    setStatus('Bild wird in die Zwischenablage kopiert …');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    const megabytes = (blob.size / 1_000_000).toFixed(1).replace('.', ',');
    const scaleInfo = scale < 1 ? ` · ${Math.round(scale * 100)} % Bildbreite` : '';
    setStatus(`Kopiert! PNG: ${megabytes} MB${scaleInfo}. Strg + V.`, 'success');
    setTimeout(() => window.close(), 2000);
  } finally {
    if (page) {
      await runInPage(tab.id, scrollPage, [page.scrollX, page.scrollY]).catch(() => {});
    }
  }
}

capture().catch((error) => {
  console.error('Fullshot:', error);
  setStatus(`Fehler: ${error.message}`, 'error');
});
