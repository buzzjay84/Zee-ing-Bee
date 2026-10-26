const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zb", {
  openDownloadedAssets: () => ipcRenderer.invoke("assets:open"),
  listMusicVideos: () => ipcRenderer.invoke("music:list"),
  playMusicVideo: (id) => ipcRenderer.invoke("music:play", id),
  musicForSong: (songPath) => ipcRenderer.invoke("music:forSong", songPath),
  searchKaraoke: (title, artist) => ipcRenderer.invoke("karaoke:search", title, artist),
  importKaraoke: (token, videoId) => ipcRenderer.invoke("karaoke:import", token, videoId),
  mediaUrl: (songPath) => ipcRenderer.invoke("media:url", songPath),
  onKaraokeStatus: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("karaoke:status", listener);
    return () => ipcRenderer.removeListener("karaoke:status", listener);
  },
  resolveVideo: (songPath) => ipcRenderer.invoke("video:resolve", songPath),
  searchOnlineVideo: (songPath) => ipcRenderer.invoke("video:searchOnline", songPath),
  saveVideo: (songPath, videoId) => ipcRenderer.invoke("video:save", songPath, videoId),
  onVideoStatus: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("video:status", listener);
    return () => ipcRenderer.removeListener("video:status", listener);
  },
  openDisplay: () => ipcRenderer.invoke("display:open"),
  sendDisplayFrame: (data) => ipcRenderer.send("display:frame", data),
  hideDisplay: () => ipcRenderer.send("display:hide"),
  onDisplayFrame: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("display:frame", listener);
    return () => ipcRenderer.removeListener("display:frame", listener);
  },
  getLibrary: () => ipcRenderer.invoke("library:get"),
  addFolder: () => ipcRenderer.invoke("library:addFolder"),
  removeFolder: (folderPath) => ipcRenderer.invoke("library:removeFolder", folderPath),
  rescan: () => ipcRenderer.invoke("library:rescan"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  addSoundBank: () => ipcRenderer.invoke("soundbank:add"),
  readFile: (file) => ipcRenderer.invoke("file:read", file),
  makeSongbook: () => ipcRenderer.invoke("songbook:pdf"),
});
