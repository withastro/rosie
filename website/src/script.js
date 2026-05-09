import { signal, effect } from "@matthewp/zebra";

// ---- platform detection ----
function detectPlatform() {
  const ua = navigator.userAgent;
  const platform = (navigator.userAgentData?.platform || navigator.platform || "").toLowerCase();
  if (/mac/.test(platform) || /Mac OS X/.test(ua)) return "brew";
  if (/freebsd/i.test(ua) || /freebsd/i.test(platform)) return "pkg";
  if (/Arch|Manjaro|EndeavourOS/i.test(ua)) return "aur";
  if (/Linux/.test(ua) || /linux/.test(platform)) return "apt";
  return "brew";
}

// ---- install tabs: one signal drives both button and panel state ----
const tabs = [...document.querySelectorAll(".tab")];
const panels = [...document.querySelectorAll(".tab-panel")];
const tabNames = new Set(tabs.map((t) => t.dataset.tab));
const detected = detectPlatform();
const activeTab = signal(tabNames.has(detected) ? detected : "brew");

effect(() => {
  const name = activeTab();
  for (const t of tabs) {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  }
  for (const p of panels) {
    p.classList.toggle("active", p.dataset.panel === name);
  }
});

for (const tab of tabs) {
  tab.addEventListener("click", () => activeTab(tab.dataset.tab));
}

// ---- copy buttons: per-button `copied` signal feeds an effect that updates label + class ----
for (const btn of document.querySelectorAll("[data-copy]")) {
  const original = btn.textContent;
  const copied = signal(false);
  const failed = signal(false);

  effect(() => {
    if (failed()) {
      btn.textContent = "[ ctrl-c ]";
      btn.classList.remove("copied");
      return;
    }
    btn.textContent = copied() ? "[ copied ]" : original;
    btn.classList.toggle("copied", copied());
  });

  btn.addEventListener("click", async () => {
    const block = btn.closest(".term-block");
    if (!block) return;
    const clone = block.cloneNode(true);
    clone.querySelectorAll(".copy-btn").forEach((b) => b.remove());
    try {
      await navigator.clipboard.writeText(clone.innerText.trim());
      copied(true);
      setTimeout(() => copied(false), 1400);
    } catch {
      failed(true);
    }
  });
}

// ---- demo: reveal once /demo.svg is known to exist ----
const demoReady = signal(false);
const demoSection = document.querySelector("[data-demo]");

effect(() => {
  if (demoReady() && demoSection) demoSection.removeAttribute("hidden");
});

fetch("/demo.svg", { method: "HEAD" })
  .then((r) => { if (r.ok) demoReady(true); })
  .catch(() => {});
