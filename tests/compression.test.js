const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
const status = { textContent: '', className: '' };
const context = {
  document: { getElementById: () => status },
  chrome: { tabs: { query: async () => [] } },
  console: { error: () => {} },
  setTimeout,
  clearTimeout
};
vm.runInNewContext(`${source}\nglobalThis.testApi = { quantizeChannel, compressColors, makeClipboardImage, MAX_CLIPBOARD_BYTES };`, context);

const { quantizeChannel, compressColors, makeClipboardImage, MAX_CLIPBOARD_BYTES } = context.testApi;
for (let value = 0; value < 256; value++) {
  const result = quantizeChannel(value);
  assert.ok(result >= 0 && result <= 255);
  assert.ok(Math.abs(result - value) <= 4, `Excessive change for ${value}`);
  if (value > 0) assert.ok(result >= quantizeChannel(value - 1));
}
assert.equal(quantizeChannel(255), 255);
assert.equal(quantizeChannel(254), 255);
assert.equal(quantizeChannel(253), 255);
assert.equal(quantizeChannel(252), 255);

const input = new Uint8ClampedArray([
  255, 254, 253, 255,
  252, 251, 250, 127
]);
let output;
const fakeContext = {
  getImageData: () => ({ data: input.slice() }),
  putImageData: (pixels) => { output = pixels.data; }
};
const canvas = { width: 2, height: 1, getContext: () => fakeContext };

function fakeImageCanvas(sizeForWidth, width = 20, height = 20) {
  return {
    width,
    height,
    getContext: () => ({
      getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {},
      drawImage: () => {}
    }),
    toBlob(callback) { callback({ size: sizeForWidth(this.width) }); }
  };
}

async function test() {
  await compressColors(canvas);
  assert.deepEqual([...output], [255, 255, 255, 255, 255, 248, 248, 127]);

  const sizeForWidth = (width) => Math.round(10_000_000 * (width / 20) ** 2);
  context.document.createElement = () => fakeImageCanvas(sizeForWidth);
  const result = await makeClipboardImage(fakeImageCanvas(sizeForWidth));
  assert.ok(result.blob.size <= MAX_CLIPBOARD_BYTES);
  assert.ok(result.scale < 1);

  context.document.createElement = () => fakeImageCanvas(() => 9_000_000);
  await assert.rejects(
    makeClipboardImage(fakeImageCanvas(() => 9_000_000)),
    /unter 8 MB zu groß/
  );
  console.log('Compression boundary and size-limit checks passed.');
}

test().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
