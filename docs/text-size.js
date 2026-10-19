const TEXT_SIZE_KEY = 'taskflow-text-size';
const TEXT_SIZE_MIN = 12, TEXT_SIZE_MAX = 26, TEXT_SIZE_DEFAULT = 13;

function setTextSize(value) {
  const size = Number.isFinite(Number(value))
    ? Math.max(TEXT_SIZE_MIN, Math.min(TEXT_SIZE_MAX, Math.round(Number(value))))
    : TEXT_SIZE_DEFAULT;
  document.documentElement.style.setProperty('--task-font-size', size + 'px');
  document.querySelector('#textsize').value = size + ' px';
  document.querySelector('#fontminus').disabled = size === TEXT_SIZE_MIN;
  document.querySelector('#fontplus').disabled = size === TEXT_SIZE_MAX;
  try { localStorage.setItem(TEXT_SIZE_KEY, String(size)); } catch { /* Keep the control usable without storage. */ }
  return size;
}

let storedTextSize;
try { storedTextSize = localStorage.getItem(TEXT_SIZE_KEY); } catch {}
let textSize = setTextSize(storedTextSize === null || storedTextSize === undefined ? TEXT_SIZE_DEFAULT : storedTextSize);
document.querySelector('#fontminus').onclick = () => { textSize = setTextSize(textSize - 1); };
document.querySelector('#fontplus').onclick = () => { textSize = setTextSize(textSize + 1); };
