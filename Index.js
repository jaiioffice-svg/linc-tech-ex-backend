export default function handler(req, res){
  res.setHeader("Access-Control-Allow-Origin", "*");
  const hasToken = !!process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const time = new Date().toISOString();
  if((req.headers.accept||"").includes("text/html")){
    return res.status(200).setHeader("Content-Type","text/html; charset=utf-8").send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>linc tceh ex - READY</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto; background:#0a0a0a; color:#fff; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0}
.card{background:#111; border:1px solid #222; border-radius:24px; padding:40px; max-width:480px; width:90%; box-shadow:0 20px 60px rgba(0,0,0,.6)}
h1{margin:0 0 8px; font-size:28px; letter-spacing:-1px}
.badge{display:inline-block; background:#00ff88; color:#000; padding:4px 10px; border-radius:20px; font-size:12px; font-weight:700; margin-bottom:20px}
.row{display:flex; justify-content:space-between; padding:12px 0; border-bottom:1px solid #1a1a1a; font-size:14px}
.row span:last-child{color:#888}
.ok{color:#00ff88}
</style></head><body>
<div class="card">
<div class="badge">● READY</div>
<h1>linc tceh ex v1.0.0</h1>
<div class="row"><span>Service</span><span>linc-tceh-ex</span></div>
<div class="row"><span>Webhook</span><span class="ok">/api/line/webhook</span></div>
<div class="row"><span>Token</span><span class="${hasToken ? 'ok' : ''}">${hasToken ? 'Connected' : 'Not set'}</span></div>
<div class="row"><span>Time</span><span>${time}</span></div>
</div></body></html>`);
  }
  return res.status(200).json({ ok:true, service:"linc tceh ex v1.0.0", name:"linc-tceh-ex", time, webhook:"/api/line/webhook", hasToken });
}
