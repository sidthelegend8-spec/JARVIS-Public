const { contextBridge, ipcRenderer } = require('electron');

// The only bridge across the isolation boundary: the app's own files in the
// user's profile folder (settings and keys, chats, memories and so on).
contextBridge.exposeInMainWorld('jarvis', {
  isElectron: true,
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  loadChats: () => ipcRenderer.invoke('chats:load'),
  saveChats: (sessions) => ipcRenderer.invoke('chats:save', sessions),
  loadMcpServers: () => ipcRenderer.invoke('mcp:load'),
  saveMcpServers: (servers) => ipcRenderer.invoke('mcp:save', servers),
  loadApiTools: () => ipcRenderer.invoke('apis:load'),
  saveApiTools: (tools) => ipcRenderer.invoke('apis:save', tools),
  loadMemories: () => ipcRenderer.invoke('memories:load'),
  saveMemories: (memories) => ipcRenderer.invoke('memories:save', memories),
  loadShortcuts: () => ipcRenderer.invoke('shortcuts:load'),
  saveShortcuts: (shortcuts) => ipcRenderer.invoke('shortcuts:save', shortcuts),
  loadSkills: () => ipcRenderer.invoke('skills:load'),
  saveSkills: (skills) => ipcRenderer.invoke('skills:save', skills),
  // Returns base64 in memory; nothing is written to disk.
  captureScreen: (options) => ipcRenderer.invoke('screen:capture', options)
});
