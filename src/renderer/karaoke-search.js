export function wireKaraokeSearch({ applyLibrary, singNow, reserve }) {
  const $ = (id) => document.getElementById(id);
  let searching = false;
  let downloading = false;
  $("btn-online-karaoke").onclick = () => { $("online-karaoke").showModal(); $("karaoke-title").focus(); };
  $("karaoke-close").onclick = () => $("online-karaoke").close();
  $("karaoke-search-form").onsubmit = async (event) => {
    event.preventDefault();
    if (searching || downloading) return;
    searching = true;
    $("karaoke-search-button").disabled = true;
    $("karaoke-results").replaceChildren();
    $("karaoke-status").textContent = "Checking your library and searching online…";
    try {
      const result = await window.zb.searchKaraoke($("karaoke-title").value, $("karaoke-artist").value);
      if (result.existing) {
        $("karaoke-status").textContent = `Already in your library: ${result.existing.number} · ${result.existing.title}`;
        const button = document.createElement("button");
        button.textContent = "Reserve existing song";
        button.onclick = () => { reserve(result.existing); $("online-karaoke").close(); };
        $("karaoke-results").append(button);
        return;
      }
      $("karaoke-status").textContent = result.items.length ? "Choose a version to download. Each video includes its own backing audio and lyrics." : "No matching karaoke versions found. Try another title or artist spelling.";
      for (const item of result.items) {
        const row = document.createElement("li");
        const details = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = item.title;
        const source = document.createElement("div");
        source.className = "muted small";
        source.textContent = `${item.channel}${item.duration ? ` · ${Math.floor(item.duration / 60)}:${String(item.duration % 60).padStart(2, "0")}` : ""}`;
        details.append(title, source);
        const button = document.createElement("button");
        button.textContent = "Download & add";
        button.onclick = async () => {
          if (downloading) return;
          downloading = true;
          $("karaoke-search-button").disabled = true;
          const buttons = [...$("karaoke-results").querySelectorAll("button")];
          buttons.forEach((b) => b.disabled = true);
          button.textContent = "Downloading…";
          $("karaoke-status").textContent = "Downloading video and backing audio. Keep the app open until saving completes.";
          try {
            const imported = await window.zb.importKaraoke(result.token, item.id);
            applyLibrary(imported.library);
            $("karaoke-status").textContent = `Saved offline as ${imported.song.number} · ${imported.song.title}`;
            button.textContent = "Play saved song";
            button.onclick = () => { $("online-karaoke").close(); singNow(imported.song); };
          } catch (error) {
            $("karaoke-status").textContent = `Download failed: ${error.message}. Try another version.`;
            button.textContent = "Retry download";
          } finally {
            downloading = false;
            buttons.forEach((b) => b.disabled = false);
            $("karaoke-search-button").disabled = false;
          }
        };
        row.append(details, button);
        $("karaoke-results").append(row);
      }
    } catch (error) { $("karaoke-status").textContent = `Search failed: ${error.message}`; }
    finally { searching = false; $("karaoke-search-button").disabled = downloading; }
  };
}
