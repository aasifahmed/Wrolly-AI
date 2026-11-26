const $ = s => document.querySelector(s);
const log = $("#log"), input = $("#input"), sendBtn = $("#send"), hero = $("#hero");
const KEY = "wrolly-ai-history";
const COOLDOWN = 15; // seconds between messages (the free servers are rate limited)
let history = [], busy = false, cooling = false;

const SYSTEM = "You are Wrolly-AI, a helpful, knowledgeable general-purpose AI assistant. Answer questions on any topic clearly, accurately and directly. Treat the user as a capable adult, avoid unnecessary lecturing, and say so when you’re unsure. Use short paragraphs, and lists or code blocks when they help.";

const esc = s => s.replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
// Turns the model's markdown into clean HTML (no stray # * ` characters).
function inline(t){
  const codes = [];
  t = t.replace(/`([^`\n]+)`/g, (_, c) => "\u0000" + (codes.push(c) - 1) + "\u0000");
  t = t.replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g, (_, a, b) => "<b>" + (a || b) + "</b>")
       .replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s).,!?:;]|$)/g, "$1<i>$2</i>")
       .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => "<code>" + codes[i] + "</code>");
}
function md(src){
  const lines = esc(src).replace(/\r/g, "").split("\n");
  let out = "", list = null, para = [], code = null, m;
  const flushP = () => { if (para.length){ out += "<p>" + inline(para.join("<br>")) + "</p>"; para = []; } };
  const closeList = () => { if (list){ out += "</" + list + ">"; list = null; } };
  const cells = r => r.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
  for (let i = 0; i < lines.length; i++){
    const ln = lines[i];
    if (code !== null){
      if (/^\s*```/.test(ln)){ out += "<pre><code>" + code.join("\n") + "</code></pre>"; code = null; } else code.push(ln);
      continue;
    }
    if (/^\s*```/.test(ln)){ flushP(); closeList(); code = []; continue; }
    if (!ln.trim()){ flushP(); closeList(); continue; }
    if ((m = ln.match(/^(#{1,6})\s+(.*)$/))){ flushP(); closeList(); const h = m[1].length <= 2 ? 3 : 4; out += "<h" + h + ">" + inline(m[2]) + "</h" + h + ">"; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(ln)){ flushP(); closeList(); out += "<hr>"; continue; }
    if ((m = ln.match(/^&gt;\s?(.*)$/))){ flushP(); closeList(); out += "<blockquote>" + inline(m[1]) + "</blockquote>"; continue; }
    if (/^\s*\|/.test(ln) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || "")){
      flushP(); closeList();
      const rows = []; while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]); i--;
      out += '<div class="tw"><table><thead><tr>' + cells(rows[0]).map(h => "<th>" + inline(h) + "</th>").join("") + "</tr></thead><tbody>" +
        rows.slice(2).map(r => "<tr>" + cells(r).map(c => "<td>" + inline(c) + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>";
      continue;
    }
    const kind = (m = ln.match(/^\s*[-*+]\s+(.*)$/)) ? "ul" : (m = ln.match(/^\s*\d+[.)]\s+(.*)$/)) ? "ol" : null;
    if (kind){
      if (list !== kind){ flushP(); closeList(); out += "<" + kind + ">"; list = kind; }
      out += "<li>" + inline(m[1]) + "</li>"; continue;
    }
    closeList(); para.push(ln.trim());
  }
  if (code !== null) out += "<pre><code>" + code.join("\n") + "</code></pre>";
  flushP(); closeList();
  return out;
}
// Plain text version (used for Copy and WhatsApp): same words, no markdown symbols.
const plain = s => s.replace(/```\w*\n?/g, "").replace(/^#{1,6}\s+/gm, "").replace(/\*\*([^*\n]+)\*\*/g, "$1")
  .replace(/__([^_\n]+)__/g, "$1").replace(/(^|[\s(])\*([^*\n]+?)\*/g, "$1$2").replace(/`([^`\n]+)`/g, "$1")
  .replace(/\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g, "$1 ($2)").replace(/^\s*[-*+]\s+/gm, "• ").replace(/^>\s?/gm, "").trim();
const errText = e => e?.message || "Something went wrong. Try again in a moment.";

const toBottom = () => window.scrollTo(0, document.documentElement.scrollHeight);
function add(cls, html, scroll = true){
  hero.remove();
  const d = document.createElement("div");
  d.className = "msg " + cls; d.innerHTML = html;
  log.appendChild(d); if (scroll) toBottom(); return d;
}
// Copy / PDF / WhatsApp buttons shown under every AI reply.
const ICONS = {
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>',
  pdf:  '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M12 11v6M9.5 14.5L12 17l2.5-2.5"/>',
  wa:   '<path d="M20 11.5a8 8 0 01-11.9 7L4 20l1.5-4.1A8 8 0 1120 11.5z"/><path d="M9.5 9.5c0 3 2 5 5 5l1-1.5-1.8-1-.9.7a3.5 3.5 0 01-1.5-1.5l.7-.9-1-1.8z"/>'
};
function mk(label, icon, fn){
  const b = document.createElement("button"); b.type = "button"; b.className = "act";
  b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[icon] + "</svg><span>" + label + "</span>";
  b.onclick = () => fn(b); return b;
}
async function copyText(t, btn){
  try { await navigator.clipboard.writeText(t); }
  catch(_) {
    const ta = document.createElement("textarea"); ta.value = t; ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch(_) {} ta.remove();
  }
  const l = btn.querySelector("span"), old = l.textContent; l.textContent = "Copied"; setTimeout(() => l.textContent = old, 1500);
}
function exportPDF(el, question){
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(f);
  const d = f.contentDocument; d.open();
  d.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Wrolly-AI answer</title><style>' +
    'body{font:14px/1.65 Arial,Helvetica,sans-serif;color:#111;margin:28px}h2{margin:0;font-size:20px}small{color:#666}' +
    '.q{background:#f1f0fa;padding:10px 14px;border-radius:8px;margin:16px 0;white-space:pre-wrap}h3,h4{margin:1em 0 .4em}p{margin:0 0 .7em}' +
    'pre{background:#f4f4f6;padding:10px;border-radius:6px;white-space:pre-wrap}code{font-family:Consolas,monospace;background:#f1f1f4;padding:1px 4px;border-radius:4px}' +
    'pre code{background:none;padding:0}table{border-collapse:collapse;margin:.5em 0}th,td{border:1px solid #bbb;padding:6px 10px;text-align:left}' +
    'blockquote{border-left:3px solid #999;margin:.6em 0;padding-left:12px;color:#444}a{color:#3a2fb5}</style></head><body><h2>Wrolly-AI</h2><small>' +
    new Date().toLocaleDateString() + "</small>" + (question ? '<div class="q">' + esc(question) + "</div>" : "") + "<div>" + el.innerHTML + "</div></body></html>");
  d.close();
  f.contentWindow.onafterprint = () => f.remove();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); }, 300);
  setTimeout(() => f.remove(), 120000);
}
function addAI(text, question = "", scroll = true){
  const m = add("ai", md(text), scroll), bar = document.createElement("div");
  bar.className = "acts";
  bar.append(
    mk("Copy", "copy", b => copyText(plain(text), b)),
    mk("PDF", "pdf", () => exportPDF(m, question)),
    mk("WhatsApp", "wa", () => { const t = plain(text); window.open("https://wa.me/?text=" + encodeURIComponent(t.length > 3000 ? t.slice(0, 3000) + "…" : t), "_blank", "noopener"); })
  );
  log.appendChild(bar);
  return m;
}

function setBusy(v){ busy = v; document.body.classList.toggle("busy", v); sendBtn.disabled = v || cooling || !input.value.trim(); }

// History is saved only in this visitor's own browser.
function save(){ try { localStorage.setItem(KEY, JSON.stringify(history.slice(-40))); } catch(_) {} }
function restore(){
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(saved)) history = saved.filter(m => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"));
  } catch(_) {}
  history.forEach((m, i) => m.role === "user" ? add("user", esc(m.content)) : addAI(m.content, history[i - 1]?.content));
  toBottom();
}
function clearHistory(){
  if (!log.querySelector(".msg") || !confirm("Delete this whole conversation?")) return;
  history = [];
  try { localStorage.removeItem(KEY); } catch(_) {}
  log.replaceChildren(hero);
}

// Free, no-login models. If one fails, the next one is tried immediately.
const POLL = "https://text.pollinations.ai/openai", LLM7 = "https://api.llm7.io/v1";
async function ask(url, body, headers = {}){
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
  try{
    const r = await fetch(url, {method:"POST", headers:{"Content-Type":"application/json", ...headers}, body:JSON.stringify(body), signal:ctl.signal});
    if (!r.ok) throw new Error("HTTP " + r.status);
    const out = (await r.json())?.choices?.[0]?.message?.content;
    if (!out) throw new Error("Empty reply");
    return out;
  } finally { clearTimeout(timer); }
}
let llm7Ids;
async function llm7Models(){
  if (!llm7Ids){
    const ids = ((await (await fetch(LLM7 + "/models")).json()).data || []).map(x => x.id);
    const pref = ["default", "fast", "pro"].filter(id => ids.includes(id));
    llm7Ids = (pref.length ? pref : ids).slice(0, 2);
  }
  return llm7Ids;
}
const llm7 = i => async m => {
  const id = (await llm7Models())[i];
  if (!id) throw new Error("no model available");
  return ask(LLM7 + "/chat/completions", {model:id, messages:m}, {Authorization:"Bearer unused"});
};
const POOL = [
  ["Pollinations · openai",  m => ask(POLL, {model:"openai",  messages:m})],
  ["Pollinations · mistral", m => ask(POLL, {model:"mistral", messages:m})],
  ["LLM7 · model 1", llm7(0)],
  ["LLM7 · model 2", llm7(1)],
];
let best = 0; // start with whichever model worked last
async function chat(messages){
  const msgs = [{role:"system", content:SYSTEM}, ...messages], why = [];
  for (let k = 0; k < POOL.length; k++){
    const i = (best + k) % POOL.length, [name, run] = POOL[i];
    try { const out = await run(msgs); best = i; console.info("Wrolly-AI answered via", name); return out; }
    catch(e){ why.push(name + ": " + e.message); }
  }
  console.warn("Wrolly-AI errors:", why);
  throw new Error("Wrolly-AI server is busy right now. Wait a moment and try again.");
}

// Shows a small countdown under the reply; it disappears after 15 seconds and sending unlocks.
function cooldown(left = COOLDOWN){
  cooling = true; sendBtn.disabled = true;
  if (left === COOLDOWN) try { localStorage.setItem("wrolly-ai-last", Date.now()); } catch(_) {}
  const t = document.createElement("div"); t.className = "cool";
  t.innerHTML = '<span></span><div class="bar"><i></i></div>';
  const label = t.firstChild, bar = t.querySelector("i");
  bar.style.animationDuration = COOLDOWN + "s";
  bar.style.animationDelay = -(COOLDOWN - left) + "s";
  const draw = () => label.textContent = "You can send another message in " + left + "s";
  draw(); log.appendChild(t);
  const iv = setInterval(() => {
    if (--left > 0) return draw();
    clearInterval(iv); t.remove(); cooling = false;
    sendBtn.disabled = busy || !input.value.trim();
  }, 1000);
}

async function send(text){
  text = text.trim(); if (!text || busy || cooling) return;
  add("user", esc(text)); input.value = ""; input.style.height = "auto"; setBusy(true);
  const wait = add("ai dots", "<i></i><i></i><i></i>");
  try{
    history.push({role:"user", content:text});
    const out = await chat(history.slice(-12));
    history.push({role:"assistant", content:out}); save();
    wait.remove(); addAI(out, text, false).scrollIntoView({block:"start"}); // stay at the start of the reply
  } catch(e){ history.pop(); wait.remove(); add("err", esc(errText(e))); }
  cooldown(); setBusy(false);
}

document.querySelectorAll(".chip").forEach(c => c.onclick = () => send(c.textContent));
$("#clear").onclick = clearHistory;
$("#form").onsubmit = e => { e.preventDefault(); send(input.value); };
input.addEventListener("input", () => {
  input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 160) + "px";
  sendBtn.disabled = busy || cooling || !input.value.trim();
});
input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey){ e.preventDefault(); $("#form").requestSubmit(); } });
restore();
try { // keep the wait going if the page is refreshed during the 15 seconds
  const left = COOLDOWN - Math.floor((Date.now() - (+localStorage.getItem("wrolly-ai-last") || 0)) / 1000);
  if (left > 0 && left <= COOLDOWN) cooldown(left);
} catch(_) {}

// Installable app (PWA): register the service worker and show an Install button when the browser allows it.
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
const installBtn = $("#install"), standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
let installEvent;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvent = e; if (!standalone) installBtn.hidden = false; });
addEventListener("appinstalled", () => { installBtn.hidden = true; installEvent = null; });
if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone) installBtn.hidden = false; // iOS has no install prompt
installBtn.onclick = async () => {
  if (installEvent){ installEvent.prompt(); await installEvent.userChoice.catch(() => {}); installEvent = null; installBtn.hidden = true; }
  else alert("To install Wrolly-AI: tap the Share button in Safari, then choose “Add to Home Screen”.");
};
