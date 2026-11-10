// Запись экрана TradingView Desktop потоком кадров, напрямую по CDP.
//
// ⚠️ Почему не Playwright: на 9223 живёт не Chrome, а TradingView Desktop на Electron.
// `chromium.connectOverCDP` к нему не подключается — отваливается по таймауту (проверено 13.08).
// Поэтому говорим с ним сырым протоколом, как это делает наш MCP-сервер.
//
// ⚠️ Почему не утилитой записи: ffmpeg под запретом ([[feedback-ai-video-workflow]]).
// Кадры складываем на диск, дальше их проигрывает Remotion.
//
// Режимы движения:
//   drag — протяжка мышью. Гладко, но в кадре остаётся курсор и плашка даты на оси.
//   keys — прокрутка стрелками. Курсора нет вообще, шаг — один бар за нажатие.
//   hold — камера стоит, пишем то, что уже на экране (для планов без движения).
//
//   node screencast.mjs <секунд> <каталог> [drag|keys|hold] [баров]
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";

const seconds = Number(process.argv[2] || 12);
const outDir = process.argv[3] || "/tmp/screencast";
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
// нужная вкладка — та, где открыт график
const target = list.find((t) => t.type === "page" && /tradingview\.com\/chart/i.test(t.url || ""))
  || list.find((t) => t.type === "page" && /Live stock/i.test(t.title || ""));
if (!target) { console.log("СТОП: вкладка с графиком не найдена"); process.exit(1); }
console.log("вкладка:", (target.title || "").slice(0, 60));

const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
let id = 0;
const waiting = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id;
  waiting.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method, params }));
});

const frames = [];
let n = 0;
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id && waiting.has(msg.id)) {
    const { res, rej } = waiting.get(msg.id); waiting.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    return;
  }
  if (msg.method === "Page.screencastFrame") {
    const file = `f${String(n).padStart(5, "0")}.jpg`;
    fs.writeFileSync(path.join(outDir, file), Buffer.from(msg.params.data, "base64"));
    frames.push({ file, t: msg.params.metadata.timestamp });
    n += 1;
    ws.send(JSON.stringify({ id: ++id, method: "Page.screencastFrameAck", params: { sessionId: msg.params.sessionId } }));
  }
});

await new Promise((r) => ws.on("open", r));
await send("Page.enable");

const box = (await send("Runtime.evaluate", {
  expression: `(() => { const c = document.querySelector("canvas");
    const r = c ? c.getBoundingClientRect() : {x:300,y:200,width:1200,height:600};
    return JSON.stringify({x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}); })()`,
  returnByValue: true,
})).result.value;
const b = JSON.parse(box);
console.log("область графика:", box);

await send("Page.startScreencast", { format: "jpeg", quality: 82, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
console.log("запись пошла");

const mode = process.argv[4] || "drag";
const bars = Number(process.argv[5] || 60);

if (mode === "replay") {
  // ⚠️ Реплей — единственное движение, которое само по себе содержательно: свечи печатаются
  // одна за другой. Владелец 13.08: «можешь как вариант, чтобы была динамика, делать реплей
  // силами ТВ — подход к уровню и слом или захват ликвидности и возврат в диапазон».
  // Жмём кнопку «шаг вперёд» на панели реплея; координата снята с окна 1920×1080.
  const STEP = { x: 995, y: 937 };
  const mouse = (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  const pause = Math.max(60, Math.round((seconds * 1000) / bars));
  for (let i = 0; i < bars; i += 1) {
    await mouse("mousePressed", STEP.x, STEP.y);
    await mouse("mouseReleased", STEP.x, STEP.y);
    await new Promise((r) => setTimeout(r, pause));
  }
  // курсор с кнопки убираем, чтобы не подсвечивалась
  await mouse("mouseMoved", 4, 4);
  await new Promise((r) => setTimeout(r, 600));
} else if (mode === "hold") {
  await new Promise((r) => setTimeout(r, seconds * 1000));
} else if (mode === "keys") {
  // ⚠️ Стрелками — чтобы в кадре не было ни курсора, ни плашки даты на оси, которые остаются
  // от протяжки мышью. Шаг равен одному бару, поэтому движение мельче и ровнее.
  await send("Runtime.evaluate", { expression: "document.body.focus()" });
  const pause = Math.max(16, Math.round((seconds * 1000) / bars));
  for (let i = 0; i < bars; i += 1) {
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", windowsVirtualKeyCode: 39, code: "ArrowRight", key: "ArrowRight" });
    await send("Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: 39, code: "ArrowRight", key: "ArrowRight" });
    await new Promise((r) => setTimeout(r, pause));
  }
} else {

// Плавная протяжка мышью: TradingView отрисовывает перетаскивание гладко, а прыжки
// visible_range дают рывки.
const cx = b.x + Math.round(b.w * 0.72);
const cy = b.y + Math.round(b.h * 0.5);
const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
await mouse("mousePressed", cx, cy);
const steps = Math.round(seconds * 24);
const dist = Math.round(b.w * 0.55);
for (let i = 1; i <= steps; i += 1) {
  const k = i / steps;
  const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  await mouse("mouseMoved", cx - Math.round(dist * ease), cy);
  await new Promise((r) => setTimeout(r, Math.round((seconds * 1000) / steps)));
}
await mouse("mouseReleased", cx - dist, cy);
// ⚠️ Курсор уводим из области графика: иначе в кадре остаётся перекрестие и плашка даты.
await mouse("mouseMoved", 4, 4);
await new Promise((r) => setTimeout(r, 700));
}

await send("Page.stopScreencast");
const t0 = frames.length ? frames[0].t : 0;
fs.writeFileSync(path.join(outDir, "frames.json"), JSON.stringify({
  seconds, count: frames.length, fps: +(frames.length / seconds).toFixed(2),
  frames: frames.map((f) => ({ ...f, t: +(f.t - t0).toFixed(3) })),
}, null, 1));
console.log(`кадров: ${frames.length} за ${seconds} с → ${(frames.length / seconds).toFixed(1)} к/с`);
ws.close();
process.exit(0);
