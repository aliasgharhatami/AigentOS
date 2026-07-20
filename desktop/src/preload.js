const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("aigentos", {
  coreUrl: process.env.AIGENTOS_CORE_URL || "http://127.0.0.1:4590",
});
