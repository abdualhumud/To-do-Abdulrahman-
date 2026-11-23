const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = process.argv[2];
const PREFIX = "/To-do-Abdulrahman-";
const PORT = Number(process.argv[3] || 4173);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain", ".woff2": "font/woff2" };

http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split("?")[0]);
  if (!url.startsWith(PREFIX)) { res.writeHead(404); return res.end("not found"); }
  url = url.slice(PREFIX.length) || "/";
  let file = path.join(ROOT, url);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log("serving", ROOT, "on", PORT));
