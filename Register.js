import fs from "fs";
import path from "path";
import crypto from "crypto";

const TMP_FILE = path.join("/tmp", "linc_store.json");
function getStore(){
  if(globalThis.__LINC_STORE) return globalThis.__LINC_STORE;
  try{ if(fs.existsSync(TMP_FILE)) { globalThis.__LINC_STORE = JSON.parse(fs.readFileSync(TMP_FILE, "utf8")); return globalThis.__LINC_STORE; } }catch(e){}
  const init = { pairingCodes:{}, lineLinks:{}, users:{}, stats:{totalPairs:0} };
  globalThis.__LINC_STORE = init;
  return init;
}
function saveStore(){ try{ if(globalThis.__LINC_STORE) fs.writeFileSync(TMP_FILE, JSON.stringify(globalThis.__LINC_STORE)); }catch(e){} }
function genCode(){ return Math.floor(100000 + Math.random()*900000).toString(); }

export default function handler(req, res){
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if(req.method === "OPTIONS") return res.status(200).end();
  if(req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try{
    const store = getStore();
    const { deviceName, userId: reqId } = req.body || {};
    const userId = reqId || "user_" + crypto.randomBytes(4).toString("hex");
    let code = genCode();
    while(store.pairingCodes[code]) code = genCode();
    store.pairingCodes[code] = { userId, deviceName: deviceName || "L!nc", expiresAt: Date.now() + 600000, createdAt: new Date().toISOString() };
    saveStore();
    return res.status(200).json({ userId, pairingCode: code, expiresIn: 600 });
  }catch(e){ return res.status(500).json({ error: "Internal" }); }
}
