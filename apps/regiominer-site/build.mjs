// Builds the static regiominer.com site (#33 publishing). Renders the canonical
// legal markdown (docs/legal/*.md) to styled HTML so the Privacy Policy and
// Terms have a public URL for App Store Connect — with NO drift (the markdown
// stays the single source) and NO dependencies (a focused renderer for the
// constrained markdown subset those docs use: headings, paragraphs, bold,
// inline code, links, blockquotes, unordered lists).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const dist = resolve(here, "dist");
mkdirSync(dist, { recursive: true });

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Inline: escape first, then apply bold / code / links on the escaped text.
function inline(text) {
  let t = esc(text);
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, (_, b) => `<strong>${b}</strong>`);
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    let h = href;
    if (h === "STEP_privacy_policy.md") h = "/privacy";
    else if (h === "STEP_terms_of_service.md") h = "/terms";
    return `<a href="${h}">${label}</a>`;
  });
  return t;
}

// Block-level renderer for the subset our legal docs use.
function mdToHtml(md) {
  const lines = md.split("\n");
  const out = [];
  let para = [];
  let list = null; // array of <li> contents
  let quote = null; // array of quoted lines

  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join("")}</ul>`); list = null; } };
  const flushQuote = () => {
    if (quote) { out.push(`<blockquote>${inline(quote.join(" "))}</blockquote>`); quote = null; }
  };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { flushAll(); continue; }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      flushAll();
      const level = m[1].length;
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if (line.startsWith("> ")) {
      flushPara(); flushList();
      (quote ||= []).push(line.slice(2));
    } else if ((m = line.match(/^[-*]\s+(.*)$/))) {
      flushPara(); flushQuote();
      (list ||= []).push(m[1]);
    } else if (list && /^\s/.test(raw)) {
      // Indented continuation of the current list item (wrapped line).
      list[list.length - 1] += " " + line.trim();
    } else {
      flushList(); flushQuote();
      para.push(line.trim());
    }
  }
  flushAll();
  return out.join("\n");
}

const CSS = `
:root{--green:#22AA33;--ink:#15202b;--muted:#5A6573;--bg:#ffffff;--surface:#f5f8f6;--border:#e2e8e4}
@media(prefers-color-scheme:dark){:root{--ink:#e8eef2;--muted:#9AA7B5;--bg:#0E141A;--surface:#141d24;--border:#243038}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
  font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:32px 20px 80px}
header.site{display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--border)}
header.site .logo{width:28px;height:28px;border-radius:7px;background:linear-gradient(135deg,#0C6E33,#39C46B)}
header.site a{color:var(--ink);text-decoration:none;font-weight:700}
nav a{color:var(--muted);text-decoration:none;margin-left:18px;font-size:14px}
nav a:hover{color:var(--green)}
h1{font-size:1.9rem;line-height:1.2;margin:.4em 0}h2{font-size:1.3rem;margin:1.6em 0 .4em;border-top:1px solid var(--border);padding-top:1.2em}
h3{font-size:1.08rem;margin:1.3em 0 .3em}a{color:var(--green)}code{background:var(--surface);padding:.1em .35em;border-radius:4px;font-size:.92em}
blockquote{margin:1.2em 0;padding:.8em 1em;background:var(--surface);border-left:3px solid var(--green);border-radius:6px;color:var(--muted)}
ul{padding-left:1.3em}li{margin:.3em 0}footer{margin-top:60px;padding-top:20px;border-top:1px solid var(--border);color:var(--muted);font-size:13px}
.hero{padding:48px 0 8px}.hero p{color:var(--muted);font-size:1.15rem}
.btn{display:inline-block;margin-top:18px;background:var(--green);color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:600}
`;

function page(title, bodyHtml, { hero = false } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body><header class="site"><span class="logo"></span><a href="/">STEP</a>
<nav><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/support">Support</a></nav></header>
<main class="wrap${hero ? " hero" : ""}">${bodyHtml}</main>
<footer><div class="wrap" style="padding:0">© 2026 Moldovan Csaba Kft · 1125 Budapest, Diós árok 49/a, Hungary ·
Company reg. 01-09-388294 · Tax HU27395842 · <a href="mailto:hello@regiominer.com">hello@regiominer.com</a></div></footer>
</body></html>`;
}

const read = (p) => readFileSync(resolve(repo, p), "utf8");

const privacyHtml = page("Privacy Policy — STEP", mdToHtml(read("docs/legal/STEP_privacy_policy.md")));
const termsHtml = page("Terms of Service — STEP", mdToHtml(read("docs/legal/STEP_terms_of_service.md")));
const support = `<h1>Support</h1>
<p>Need help with STEP? We're glad to assist.</p>
<ul>
<li><strong>Email:</strong> <a href="mailto:hello@regiominer.com">hello@regiominer.com</a></li>
<li><strong>Privacy questions:</strong> <a href="mailto:privacy@regiominer.com">privacy@regiominer.com</a></li>
</ul>
<p>STEP is a testnet / pilot. Trinity has no monetary value and cannot be bought with money.
Your location is processed on your device only — see our <a href="/privacy">Privacy Policy</a>.</p>`;
const supportHtml = page("Support — STEP", support);
const about = `<h1>About STEP</h1>
<p>STEP is a <strong>proof-of-presence protocol</strong> and app: the world is divided into a fixed grid of map triangles, and you earn by being physically present and cryptographically proving it — without your exact location ever leaving your device.</p>
<h2>Who builds STEP</h2>
<p>STEP is developed and operated by <strong>Moldovan Csaba Kft</strong>, a company registered in Hungary, founded and led by <strong>Csaba Moldovan</strong> (developer and owner).</p>
<ul>
<li><strong>Company:</strong> Moldovan Csaba Kft</li>
<li><strong>Registered office:</strong> 1125 Budapest, Diós árok 49/a, Hungary</li>
<li><strong>Company registration No.:</strong> 01-09-388294</li>
<li><strong>EU VAT / Tax No.:</strong> HU27395842</li>
<li><strong>Developer &amp; owner:</strong> Csaba Moldovan</li>
<li><strong>Contact:</strong> <a href="mailto:hello@regiominer.com">hello@regiominer.com</a></li>
</ul>
<h2>How we operate</h2>
<p><strong>Private by design.</strong> Your precise location is processed only on your device to find the current map triangle; only a triangle id and a proof hash are submitted. Your wallet is non-custodial and encrypted on your device.</p>
<p><strong>Honest about stage.</strong> STEP is a testnet / pilot. The in-app unit, Trinity, has <strong>no monetary value</strong> and cannot be bought with money.</p>
<p>Read our <a href="/privacy">Privacy Policy</a> and <a href="/terms">Terms of Service</a>, or get <a href="/support">Support</a>.</p>`;
const aboutHtml = page("About — STEP · Moldovan Csaba Kft", about);
const landing = `<h1>STEP</h1>
<p>Proof of presence, on the map. Stand somewhere real, prove it, and mine it. Powered by the STEP protocol.</p>
<p><strong>Trinity is a testnet token with no monetary value.</strong></p>
<a class="btn" href="/about">About</a> <a class="btn" href="/privacy" style="background:#0C6E33">Privacy</a> <a class="btn" href="/terms" style="background:#0C6E33">Terms</a>`;

writeFileSync(resolve(dist, "privacy.html"), privacyHtml);
writeFileSync(resolve(dist, "terms.html"), termsHtml);
writeFileSync(resolve(dist, "support.html"), supportHtml);
writeFileSync(resolve(dist, "about.html"), aboutHtml);
writeFileSync(resolve(dist, "index.html"), page("STEP — Proof of Presence", landing, { hero: true }));

// Also emit the content pages into the web app's static assets so they're served
// from the product's own domain (step.regiominer.com/privacy etc.). The web app
// has its own index.html, so we do NOT write a landing page there.
const webPublic = resolve(repo, "apps/web-app/public");
mkdirSync(webPublic, { recursive: true });
writeFileSync(resolve(webPublic, "privacy.html"), privacyHtml);
writeFileSync(resolve(webPublic, "terms.html"), termsHtml);
writeFileSync(resolve(webPublic, "support.html"), supportHtml);
writeFileSync(resolve(webPublic, "about.html"), aboutHtml);

console.log("wrote dist/ + web-app/public/ {privacy,terms,support,about}.html");
