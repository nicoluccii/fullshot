const statusElement = document.getElementById('status');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      rgba[i] = (rgba[i] + 4) & 0xf8;
      rgba[i + 1] = (rgba[i + 1] + 4) & 0xf8;
      rgba[i + 2] = (rgba[i + 2] + 4) & 0xf8;
    }
    context.putImageData(pixels, 0, y);
    await pause(0);
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
    await compressColors(canvas);
    const blob = await canvasToBlob(canvas);
    setStatus('Bild wird in die Zwischenablage kopiert …');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    const megabytes = (blob.size / 1_000_000).toFixed(1).replace('.', ',');
    setStatus(`Kopiert! PNG: ${megabytes} MB. Strg + V zum Einfügen.`, 'success');
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
