// The sound mixer knobs, shared by the desktop and the phone, drawn as "− value +" rows.
// UMD-style so the tests (require) and the windows (script tag) can both use it.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ZBSound = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const percent = (v) => `${Math.round(v * 100)}%`;
  const decibels = (v) => (v ? `${v > 0 ? "+" : ""}${v} dB` : "Flat");

  const PARTS = {
    melody: { label: "Melody", min: 0, max: 2, step: 0.05, value: 1.35, show: percent },
    bass: { label: "Bass", min: 0, max: 2, step: 0.1, value: 1, show: percent },
    drums: { label: "Drums", min: 0, max: 2, step: 0.1, value: 1, show: percent },
    band: { label: "Others", min: 0, max: 2, step: 0.1, value: 1, show: percent },
    low: { label: "Low tone", min: -12, max: 12, step: 2, value: 0, show: decibels },
    high: { label: "Treble", min: -12, max: 12, step: 2, value: 0, show: decibels },
    echo: { label: "Echo", min: 0, max: 1, step: 0.1, value: 0, show: (v) => (v ? percent(v) : "Off") },
    volume: { label: "Volume", min: 0, max: 1.5, step: 0.05, value: 1, show: percent },
  };

  /** Every knob, using the saved value when there is a valid one. */
  function withDefaults(mix) {
    return Object.fromEntries(Object.entries(PARTS).map(([key, part]) => {
      const v = mix?.[key];
      return [key, Number.isFinite(v) ? Math.min(part.max, Math.max(part.min, v)) : part.value];
    }));
  }

  /** One tap of − (dir -1) or + (dir 1), kept in range and free of float drift. */
  function step(key, value, dir) {
    const part = PARTS[key];
    return Math.min(part.max, Math.max(part.min, Math.round((value + dir * part.step) * 100) / 100));
  }

  /** Short words for a settings card, like "Echo Off". */
  function summary(mix) {
    return `Echo ${PARTS.echo.show(mix.echo)} · Volume ${percent(mix.volume)}`;
  }

  /**
   * Draws rows for `keys` into `container`. A tap calls onChange(key, newValue);
   * call the returned refresh() after any change so every copy shows the same numbers.
   */
  function mountRows(container, keys, getMix, onChange) {
    const doc = container.ownerDocument;
    const rows = keys.map((key) => {
      const row = doc.createElement("div");
      row.className = "mix-row";
      const label = doc.createElement("span");
      label.textContent = PARTS[key].label;
      const make = (text, dir) => {
        const b = doc.createElement("button");
        b.type = "button";
        b.className = "mix-step";
        b.textContent = text;
        b.setAttribute("aria-label", `${PARTS[key].label} ${dir < 0 ? "down" : "up"}`);
        b.onclick = () => onChange(key, step(key, getMix()[key], dir));
        return b;
      };
      const minus = make("−", -1);
      const out = doc.createElement("output");
      const plus = make("+", 1);
      row.append(label, minus, out, plus);
      return { key, minus, out, plus };
    });
    container.replaceChildren(...rows.map((r) => r.minus.parentNode));
    const refresh = () => {
      const mix = getMix();
      for (const r of rows) {
        r.out.textContent = PARTS[r.key].show(mix[r.key]);
        r.minus.disabled = mix[r.key] <= PARTS[r.key].min;
        r.plus.disabled = mix[r.key] >= PARTS[r.key].max;
      }
    };
    refresh();
    return refresh;
  }

  /**
   * The settings dialog: cards that open their page, a back button and a search over the
   * cards (their text plus data-words). Returns a function that opens it on the card list.
   */
  function wireSettingsDialog(dialog) {
    const q = (selector) => dialog.querySelector(selector);
    const show = (page) => {
      const section = page ? q(`.settings-page[data-page="${page}"]`) : null;
      for (const s of dialog.querySelectorAll(".settings-page")) s.hidden = s !== section;
      q("#settings-hub").hidden = Boolean(section);
      q("#settings-search").hidden = Boolean(section);
      q("#settings-back").hidden = !section;
      q("#settings-title").textContent = section?.dataset.title ?? "Settings";
    };
    const filter = (text) => {
      const words = text.trim().toLowerCase();
      let shown = 0;
      for (const card of dialog.querySelectorAll(".settings-card")) {
        card.hidden = Boolean(words) && !`${card.textContent} ${card.dataset.words}`.toLowerCase().includes(words);
        if (!card.hidden) shown++;
      }
      q("#settings-none").hidden = shown > 0;
    };
    q("#settings-hub").addEventListener("click", (e) => {
      const page = e.target.closest(".settings-card")?.dataset.page;
      if (page) show(page);
    });
    q("#settings-back").onclick = () => show(null);
    q("#settings-search").oninput = (e) => filter(e.target.value);
    // Enter in the search box would otherwise submit the dialog's form and close it.
    q("#settings-search").onkeydown = (e) => { if (e.key === "Enter") e.preventDefault(); };
    return () => {
      q("#settings-search").value = "";
      filter("");
      show(null);
      dialog.showModal();
    };
  }

  return { PARTS, withDefaults, step, summary, mountRows, wireSettingsDialog };
});
