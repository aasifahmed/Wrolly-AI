const $ = s => document.querySelector(s);
const log = $("#log"), input = $("#input"), sendBtn = $("#send"), hero = $("#hero");
const KEY = "wrolly-ai-history";
const COOLDOWN = 15; // seconds between messages (the free servers are rate limited)
let history = [], busy = false, cooling = false;

const SYSTEM = "You are Wrolly-AI, a helpful, knowledgeable general-purpose AI assistant. Answer questions on any topic clearly, accurately and directly. Keep answers short and concise, usually within 5 to 6 lines, and skip long introductions and summaries. Only write longer answers when the request clearly needs it, such as essays, stories, code, detailed guides or step-by-step plans. Treat the user as a capable adult, avoid unnecessary lecturing, and say so when you’re unsure. Use lists or code blocks only when they help.";

const esc = s => s.replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const md = s => esc(s)
  .replace(/```(?:\w*\n)?([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
  .replace(/`([^`\n]+)`/g, "<code>$1</code>")
  .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
  .replace(/^#{1,4} +(.+)$/gm, "<b>$1</b>")
  .replace(/^[-*] +/gm, "• ");
const errText = e => e?.message || "Something went wrong. Try again in a moment.";

function add(cls, html, scroll = true){
  hero.remove();
  const d = document.createElement("div");
  d.className = "msg " + cls; d.innerHTML = html;
  log.appendChild(d); if (scroll) log.scrollTop = log.scrollHeight; return d;
}
function setBusy(v){ busy = v; document.body.classList.toggle("busy", v); sendBtn.disabled = v || cooling || !input.value.trim(); }

// History is saved only in this visitor's own browser.
function save(){ try { localStorage.setItem(KEY, JSON.stringify(history.slice(-40))); } catch(_) {} }
function restore(){
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(saved)) history = saved.filter(m => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"));
  } catch(_) {}
  history.forEach(m => add(m.role === "user" ? "user" : "ai", m.role === "user" ? esc(m.content) : md(m.content)));
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
  throw new Error("Wrolly-AI server is busy right now. Wait a moment and try again.\n\nDetails: " + why.join(" | "));
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
    wait.remove(); add("ai", md(out), false).scrollIntoView({block:"start"}); // stay at the start of the reply
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
