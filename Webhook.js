import fs from "fs";
import path from "path";

const TMP_FILE = path.join("/tmp", "linc_store.json");

function getStore(){
  if(globalThis.__LINC_STORE) return globalThis.__LINC_STORE;
  try{
    if(fs.existsSync(TMP_FILE)){
      globalThis.__LINC_STORE = JSON.parse(fs.readFileSync(TMP_FILE, "utf8"));
      return globalThis.__LINC_STORE;
    }
  }catch(e){}
  const init = { pairingCodes:{}, lineLinks:{}, users:{}, stats:{totalPairs:0} };
  globalThis.__LINC_STORE = init;
  return init;
}

function saveStore(){
  try{
    if(globalThis.__LINC_STORE) fs.writeFileSync(TMP_FILE, JSON.stringify(globalThis.__LINC_STORE));
  }catch(e){}
}

async function replyLine(replyToken, text){
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if(!token || !replyToken) return false;
  try{
    const res = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] })
    });
    return res.ok;
  }catch(e){
    console.error(e);
    return false;
  }
}

export default async function handler(req, res){
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-line-signature");
  if(req.method === "OPTIONS") return res.status(200).end();
  
  if(req.method === "GET"){
    return res.status(200).json({ 
      ok: true, 
      msg: "linc tceh ex v1.0.0 - READY",
      hasToken: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
      codes: Object.keys(getStore().pairingCodes||{}).length
    });
  }
  
  if(req.method === "POST"){
    res.status(200).json({ ok: true });
    try{
      const events = req.body?.events || [];
      for(const ev of events){
        if(ev.type !== "message" || ev.message?.type !== "text") continue;
        const text = (ev.message.text||"").trim();
        const replyToken = ev.replyToken;
        const lineId = ev.source?.userId;
        if(!text || !replyToken || !lineId) continue;
        const store = getStore();
        if(/^\d{6}$/.test(text)){
          const entry = store.pairingCodes[text];
          if(!entry){
            await replyLine(replyToken, `❌ ไม่พบรหัส ${text}\nอาจหมดอายุ (10 นาที)`);
            continue;
          }
          if(Date.now() > entry.expiresAt){
            delete store.pairingCodes[text];
            saveStore();
            await replyLine(replyToken, `⏰ รหัส ${text} หมดอายุแล้ว`);
            continue;
          }
          delete store.pairingCodes[text];
          store.lineLinks[lineId] = entry.userId;
          store.stats.totalPairs = (store.stats.totalPairs||0)+1;
          saveStore();
          await replyLine(replyToken, `✅ จับคู่สำเร็จ!\nDevice: ${entry.deviceName}\nUserID: ${entry.userId}`);
          continue;
        }
        await replyLine(replyToken, `สวัสดีครับ! 👋 linc tceh ex ✅\nได้รับ: ${text}\n\nพิมพ์รหัส 6 หลักจากแอปได้เลย`);
      }
    }catch(e){ console.error(e); }
    return;
  }
  return res.status(200).json({ ok: true });
}
