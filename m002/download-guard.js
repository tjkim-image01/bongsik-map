// 큰 영상 받기 전에 묻기(2026-11-02 사용자: "용량 큰거 다운 받을때 얼랏해줘 400메가면 받을때 부담 스러울테니까..").
// 영상 주소의 크기를 HEAD로 먼저 보고 BIG 이상이면 "몇 MB예요, 받을까요?" 창을 띄운다. 받기로 한 영상은 이 탭에서 다시 묻지 않는다.
// 크기를 모르면(HEAD 실패) 묻지 않고 받는다. 여러 개를 동시에 물으면 하나씩 차례로 띄운다.
const BIG = 50 * 1024 * 1024;
const KEY = 'm002-download-ok';

const style = document.createElement('style');
style.textContent = `.dl-ask{position:fixed;inset:0;z-index:10001;display:grid;place-items:center;padding:16px;background:rgba(6,10,14,.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.dl-ask div{max-width:340px;width:100%;padding:22px 20px 18px;border-radius:16px;background:rgba(24,32,38,.96);border:1px solid rgba(255,255,255,.14);color:#fffaf1;box-shadow:0 20px 60px #0008;font:14px/1.55 system-ui,sans-serif}
.dl-ask b{display:block;font-size:17px;margin-bottom:6px}.dl-ask p{margin:0 0 16px;color:#fffaf1c0}.dl-ask strong{color:var(--accent,#e4c99b)}
.dl-ask nav{display:flex;gap:8px}.dl-ask button{flex:1;padding:11px 0;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:transparent;color:inherit;font:inherit;cursor:pointer}
.dl-ask button.yes{background:var(--accent,#e4c99b);border-color:transparent;color:#1d2328;font-weight:600}`;
document.head.append(style);

const sizes = new Map();
let queue = Promise.resolve();
const allowed = () => { try { return new Set(JSON.parse(sessionStorage.getItem(KEY)) || []); } catch { return new Set(); } };
function allow(src) { const s = allowed(); s.add(src); try { sessionStorage.setItem(KEY, JSON.stringify([...s])); } catch {} }

async function sizeOf(src) {
  if (!sizes.has(src)) sizes.set(src, fetch(src, { method: 'HEAD' }).then(r => r.ok ? +r.headers.get('content-length') || 0 : 0).catch(() => 0));
  return sizes.get(src);
}
const mb = (n) => n >= 1e9 ? `${(n / 1e9).toFixed(1)}GB` : `${Math.round(n / 1e6)}MB`;

function dialog(title, bytes) {
  return new Promise(resolve => {
    const box = document.createElement('section');
    box.className = 'dl-ask'; box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-label', `${title} 받기`);
    box.innerHTML = `<div><b></b><p>이 영상은 <strong>${mb(bytes)}</strong>예요. 휴대폰 데이터라면 부담될 수 있어요. 지금 받을까요?</p><nav><button type="button" class="no">나중에</button><button type="button" class="yes">받기</button></nav></div>`;
    box.querySelector('b').textContent = title;
    const done = (ok) => { box.remove(); removeEventListener('keydown', key, true); resolve(ok); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    box.querySelector('.yes').addEventListener('click', () => done(true));
    box.querySelector('.no').addEventListener('click', () => done(false));
    addEventListener('keydown', key, true);
    document.body.append(box); box.querySelector('.yes').focus();
  });
}

// 받아도 되면 true. title은 창 제목(영상 이름)
export function askBigDownload(src, title) {
  if (!src) return Promise.resolve(true);
  const turn = queue.then(async () => {
    if (allowed().has(src)) return true;
    const bytes = await sizeOf(src);
    if (bytes < BIG) return true;
    const ok = await dialog(title, bytes);
    if (ok) allow(src);
    return ok;
  });
  queue = turn.catch(() => {});
  return turn;
}
