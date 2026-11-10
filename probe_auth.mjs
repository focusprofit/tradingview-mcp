import CDP from 'chrome-remote-interface';

const targets = await CDP.List({ host: 'localhost', port: 9223 });
for (const t of targets) {
  if (t.type !== 'page') continue;
  let client;
  try {
    client = await CDP({ host: 'localhost', port: 9223, target: t });
    await client.Runtime.enable();
    const expr = `(() => {
      const inputs = Array.from(document.querySelectorAll('input,textarea')).map(e => {
        const r = e.getBoundingClientRect();
        return {type: e.type, ph: e.placeholder || null, name: e.name || null, vis: r.width>0 && r.height>0,
                x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)};
      });
      const btns = Array.from(document.querySelectorAll('button')).map(b=>(b.innerText||'').trim()).filter(Boolean).slice(0,6);
      return JSON.stringify({title: document.title.slice(0,40), url: location.href.slice(0,60), inputs, btns, text: (document.body.innerText||'').slice(0,200)});
    })()`;
    const { result } = await client.Runtime.evaluate({ expression: expr, returnByValue: true });
    const v = JSON.parse(result.value);
    if (v.inputs.length || /auth|secret|token|sign/i.test(v.text)) {
      console.log('--- target:', t.url.slice(0, 70));
      console.log(JSON.stringify(v, null, 1).slice(0, 900));
    }
  } catch (e) {
    // target not inspectable, skip
  } finally {
    if (client) await client.close();
  }
}
