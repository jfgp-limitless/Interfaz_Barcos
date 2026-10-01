/* =====================================================================
   Gráficas SVG sin dependencias (funcionan sin internet).
   Se dibujan al ancho real del contenedor y se redibujan al cambiar de tamaño.
   ===================================================================== */
(function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const C = {
    texto: "#1d1d1f", texto2: "#6e6e73", texto3: "#86868b",
    rejilla: "#ececf0", eje: "#d2d2d7", superficie: "#ffffff",
  };

  function el(tag, attrs, padre) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (padre) padre.appendChild(n);
    return n;
  }
  function txt(padre, x, y, s, attrs) {
    const t = el("text", Object.assign({ x, y, "font-size": 11, fill: C.texto2 }, attrs || {}), padre);
    t.textContent = s;
    return t;
  }

  /* ---------------------------------------------------------- tooltip */
  const tt = () => document.getElementById("tooltip");
  function mostrarTooltip(html, ev) {
    const t = tt();
    t.innerHTML = html;
    t.hidden = false;
    const r = t.getBoundingClientRect();
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - 14;
    if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - 14;
    t.style.left = x + "px";
    t.style.top = y + "px";
  }
  function ocultarTooltip() { tt().hidden = true; }

  /* ---------------------------------------------------------- montaje con redibujo */
  const observados = new WeakMap();
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver((entradas) => {
    for (const e of entradas) {
      const info = observados.get(e.target);
      if (!info) continue;
      const w = Math.round(e.contentRect.width);
      if (w > 0 && w !== info.ancho) {
        info.ancho = w;
        clearTimeout(info.t);
        info.t = setTimeout(() => info.fn(), 60);
      }
    }
  }) : null;

  function montar(cont, dibujar) {
    const fn = () => {
      cont.innerHTML = "";
      const ancho = cont.clientWidth || 320;
      dibujar(ancho);
    };
    observados.set(cont, { fn, ancho: cont.clientWidth });
    if (ro) ro.observe(cont);
    fn();
  }

  function escala(d0, d1, r0, r1) {
    const k = (r1 - r0) / ((d1 - d0) || 1);
    return (v) => r0 + (v - d0) * k;
  }

  function ticksBonitos(min, max, n) {
    const paso0 = (max - min) / Math.max(n, 1);
    const mag = Math.pow(10, Math.floor(Math.log10(paso0)));
    const norm = paso0 / mag;
    const paso = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(min / paso) * paso; v <= max + paso * 1e-6; v += paso) out.push(+v.toFixed(10));
    return out;
  }

  function leyenda(cont, items) {
    const d = document.createElement("div");
    d.className = "leyenda";
    d.innerHTML = items.map((i) =>
      `<span><i class="${i.tipo || ""}" style="background:${i.tipo === "discontinua" ? "" : i.color}"></i>${i.nombre}</span>`).join("");
    cont.appendChild(d);
  }

  /* ---------------------------------------------------------- líneas */
  /**
   * opciones: { series: [{nombre, color, valores: [y...], discontinua}], xs: [x...],
   *             alto, yMin, yMax, formatoY, tituloX, marcas: [{x, texto}], etiquetaX }
   */
  function lineas(cont, op) {
    montar(cont, (W) => {
      if (op.series.length > 1) leyenda(cont, op.series.map((s) => ({ nombre: s.nombre, color: s.color, tipo: s.discontinua ? "discontinua" : "" })));
      const H = op.alto || 240;
      const m = { t: 12, r: 16, b: op.tituloX ? 40 : 26, l: 46 };
      const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": op.aria || "Gráfica de líneas" }, cont);
      const xs = op.xs;
      let yMin = op.yMin, yMax = op.yMax;
      const todos = op.series.flatMap((s) => s.valores.filter((v) => v != null));
      if (yMin == null) yMin = Math.min(...todos);
      if (yMax == null) yMax = Math.max(...todos);
      if (yMax === yMin) { yMax += 1; }
      const sx = escala(xs[0], xs[xs.length - 1], m.l, W - m.r);
      const sy = escala(yMin, yMax, H - m.b, m.t);
      const fy = op.formatoY || ((v) => v.toFixed(2));

      for (const t of ticksBonitos(yMin, yMax, 4)) {
        el("line", { x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t), stroke: C.rejilla, "stroke-width": 1 }, svg);
        txt(svg, m.l - 8, sy(t) + 4, fy(t), { "text-anchor": "end" });
      }
      const pasoX = Math.max(1, Math.ceil(xs.length / Math.max(2, Math.floor((W - m.l - m.r) / 48))));
      xs.forEach((x, i) => { if (i % pasoX === 0 || i === xs.length - 1) txt(svg, sx(x), H - m.b + 16, String(x), { "text-anchor": "middle" }); });
      if (op.tituloX) txt(svg, (m.l + W - m.r) / 2, H - 6, op.tituloX, { "text-anchor": "middle", fill: C.texto3 });

      for (const mk of op.marcas || []) {
        const x = sx(mk.x);
        el("line", { x1: x, x2: x, y1: m.t, y2: H - m.b, stroke: C.texto3, "stroke-width": 1, "stroke-dasharray": "3 3" }, svg);
        txt(svg, x + 5, op.marcaAbajo ? H - m.b - 6 : m.t + 10, mk.texto, { fill: C.texto2, "font-size": 11 });
      }

      for (const s of op.series) {
        const pts = s.valores.map((v, i) => (v == null ? null : [sx(xs[i]), sy(v)])).filter(Boolean);
        if (s.relleno) {
          const d = `M${pts[0][0]},${H - m.b} ` + pts.map((p) => `L${p[0]},${p[1]}`).join(" ") + ` L${pts[pts.length - 1][0]},${H - m.b} Z`;
          el("path", { d, fill: s.color, opacity: 0.1 }, svg);
        }
        el("path", {
          d: pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(""),
          fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round",
          "stroke-dasharray": s.discontinua ? "5 4" : "none",
        }, svg);
        const u = pts[pts.length - 1];
        el("circle", { cx: u[0], cy: u[1], r: 4, fill: s.color, stroke: C.superficie, "stroke-width": 2 }, svg);
      }

      // capa de interacción: cruz + tooltip
      const guia = el("line", { y1: m.t, y2: H - m.b, stroke: C.texto3, "stroke-width": 1, visibility: "hidden" }, svg);
      const puntos = op.series.map((s) => el("circle", { r: 4.5, fill: s.color, stroke: "#fff", "stroke-width": 2, visibility: "hidden" }, svg));
      const zona = el("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: "transparent" }, svg);
      zona.addEventListener("mousemove", (ev) => {
        const r = svg.getBoundingClientRect();
        const px = ev.clientX - r.left;
        let i = 0, mejor = Infinity;
        xs.forEach((x, k) => { const d = Math.abs(sx(x) - px); if (d < mejor) { mejor = d; i = k; } });
        guia.setAttribute("x1", sx(xs[i])); guia.setAttribute("x2", sx(xs[i])); guia.setAttribute("visibility", "visible");
        let html = `<b>${op.etiquetaX || "x"} ${xs[i]}</b>`;
        op.series.forEach((s, k) => {
          const v = s.valores[i];
          if (v == null) { puntos[k].setAttribute("visibility", "hidden"); return; }
          puntos[k].setAttribute("cx", sx(xs[i])); puntos[k].setAttribute("cy", sy(v)); puntos[k].setAttribute("visibility", "visible");
          html += `<div class="fila-tt"><i style="background:${s.color}"></i>${s.nombre}: <b>${(op.formatoTooltip || fy)(v)}</b></div>`;
        });
        mostrarTooltip(html, ev);
      });
      zona.addEventListener("mouseleave", () => { guia.setAttribute("visibility", "hidden"); puntos.forEach((p) => p.setAttribute("visibility", "hidden")); ocultarTooltip(); });
    });
  }

  /* ---------------------------------------------------------- ROC */
  function roc(cont, curvas, op) {
    op = op || {};
    montar(cont, (W) => {
      if (curvas.length > 1) leyenda(cont, curvas.map((c) => ({ nombre: `${c.nombre} (AUC ${c.auc != null ? c.auc.toFixed(3) : "—"})`, color: c.color })));
      const lado = Math.min(W, op.max || 340);
      const H = lado;
      const m = { t: 10, r: 12, b: 38, l: 44 };
      const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Curva ROC" }, cont);
      const ancho = Math.min(W - m.l - m.r, H - m.t - m.b);
      const ox = m.l + (W - m.l - m.r - ancho) / 2;
      const sx = escala(0, 1, ox, ox + ancho), sy = escala(0, 1, m.t + ancho, m.t);
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        el("line", { x1: sx(0), x2: sx(1), y1: sy(t), y2: sy(t), stroke: C.rejilla }, svg);
        el("line", { x1: sx(t), x2: sx(t), y1: sy(0), y2: sy(1), stroke: C.rejilla }, svg);
        txt(svg, sx(0) - 8, sy(t) + 4, t.toFixed(2), { "text-anchor": "end" });
        txt(svg, sx(t), sy(0) + 16, t.toFixed(2), { "text-anchor": "middle" });
      }
      txt(svg, sx(0.5), H - 4, "Tasa de falsos positivos", { "text-anchor": "middle", fill: C.texto3 });
      const ty = txt(svg, 0, 0, "Sensibilidad", { "text-anchor": "middle", fill: C.texto3 });
      ty.setAttribute("transform", `translate(${11},${sy(0.5)}) rotate(-90)`);
      el("line", { x1: sx(0), y1: sy(0), x2: sx(1), y2: sy(1), stroke: C.texto3, "stroke-dasharray": "4 4" }, svg);
      for (const c of curvas) {
        if (!c.puntos || !c.puntos.length) continue;
        const d = c.puntos.map((p, i) => (i ? "L" : "M") + sx(p[0]).toFixed(1) + "," + sy(p[1]).toFixed(1)).join("");
        el("path", { d: d + `L${sx(1)},${sy(0)}L${sx(0)},${sy(0)}Z`, fill: c.color, opacity: curvas.length > 1 ? 0.05 : 0.1 }, svg);
        el("path", { d, fill: "none", stroke: c.color, "stroke-width": 2, "stroke-linejoin": "round" }, svg);
      }
      if (curvas.length === 1 && curvas[0].auc != null) {
        txt(svg, sx(0.96), sy(0.08), `AUC = ${curvas[0].auc.toFixed(3)}`, { "text-anchor": "end", fill: C.texto, "font-size": 13, "font-weight": 600 });
      }
      const zona = el("rect", { x: sx(0), y: sy(1), width: ancho, height: ancho, fill: "transparent" }, svg);
      zona.addEventListener("mousemove", (ev) => {
        const r = svg.getBoundingClientRect();
        const fpr = Math.max(0, Math.min(1, (ev.clientX - r.left - sx(0)) / ancho));
        let html = `<b>FPR ${fpr.toFixed(2)}</b>`;
        for (const c of curvas) {
          let tpr = 0;
          for (const p of c.puntos) if (p[0] <= fpr + 1e-9) tpr = Math.max(tpr, p[1]);
          html += `<div class="fila-tt"><i style="background:${c.color}"></i>${c.nombre}: sensibilidad <b>${tpr.toFixed(3)}</b></div>`;
        }
        mostrarTooltip(html, ev);
      });
      zona.addEventListener("mouseleave", ocultarTooltip);
    });
  }

  /* ---------------------------------------------------------- histograma por clase (múltiplos pequeños) */
  function histograma(cont, op) {
    // op: { bordes:[...], filas:[{nombre, color, conteos}], umbral }
    montar(cont, (W) => {
      const altoFila = 64, sep = 14;
      const m = { t: 6, r: 12, b: 30, l: 74 };
      const H = m.t + op.filas.length * altoFila + (op.filas.length - 1) * sep + m.b;
      const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Distribución de probabilidades" }, cont);
      const sx = escala(0, 1, m.l, W - m.r);
      const maxC = Math.max(1, ...op.filas.flatMap((f) => f.conteos));
      const nb = op.bordes.length - 1;
      const anchoBin = (W - m.l - m.r) / nb;
      op.filas.forEach((f, k) => {
        const y0 = m.t + k * (altoFila + sep);
        const base = y0 + altoFila;
        el("line", { x1: m.l, x2: W - m.r, y1: base, y2: base, stroke: C.eje }, svg);
        txt(svg, m.l - 10, y0 + altoFila / 2 + 4, f.nombre, { "text-anchor": "end", fill: C.texto, "font-size": 12 });
        f.conteos.forEach((c, i) => {
          if (!c) return;
          const h = Math.max(2, (c / maxC) * (altoFila - 6));
          const x = m.l + i * anchoBin + 1, w = Math.max(1, anchoBin - 2);
          const r = Math.min(4, w / 2, h);
          const d = `M${x},${base} L${x},${base - h + r} Q${x},${base - h} ${x + r},${base - h} L${x + w - r},${base - h} Q${x + w},${base - h} ${x + w},${base - h + r} L${x + w},${base} Z`;
          const p = el("path", { d, fill: f.color }, svg);
          p.addEventListener("mousemove", (ev) => mostrarTooltip(
            `<b>${f.nombre}</b><div>P(barco) ${op.bordes[i].toFixed(2)}–${op.bordes[i + 1].toFixed(2)}</div><div>${c} imagen${c === 1 ? "" : "es"}</div>`, ev));
          p.addEventListener("mouseleave", ocultarTooltip);
        });
      });
      const yb = H - m.b;
      for (const t of [0, 0.25, 0.5, 0.75, 1]) txt(svg, sx(t), yb + 18, t.toFixed(2), { "text-anchor": "middle" });
      if (op.umbral != null) {
        const x = sx(op.umbral);
        el("line", { x1: x, x2: x, y1: m.t - 2, y2: yb + 4, stroke: C.texto, "stroke-width": 1.5, "stroke-dasharray": "4 3" }, svg);
      }
    });
  }

  /* ---------------------------------------------------------- gráfica de puntos (comparación) */
  function puntos(cont, op) {
    // op: { filas:[{nombre, valores:{id: v}}], series:[{id, nombre, color}], min, max, formato }
    montar(cont, (W) => {
      leyenda(cont, op.series.map((s) => ({ nombre: s.nombre, color: s.color, tipo: "punto" })));
      const altoFila = 40;
      const m = { t: 8, r: 20, b: 28, l: 110 };
      const H = m.t + op.filas.length * altoFila + m.b;
      const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": op.aria || "Comparación de métricas" }, cont);
      const sx = escala(op.min, op.max, m.l, W - m.r);
      const f = op.formato || ((v) => (v * 100).toFixed(1) + " %");
      for (const t of ticksBonitos(op.min, op.max, 4)) {
        el("line", { x1: sx(t), x2: sx(t), y1: m.t, y2: H - m.b, stroke: C.rejilla }, svg);
        txt(svg, sx(t), H - m.b + 18, f(t), { "text-anchor": "middle" });
      }
      op.filas.forEach((fila, k) => {
        const y = m.t + k * altoFila + altoFila / 2;
        txt(svg, m.l - 12, y + 4, fila.nombre, { "text-anchor": "end", fill: C.texto, "font-size": 12 });
        const vals = op.series.map((s) => fila.valores[s.id]).filter((v) => v != null);
        if (vals.length > 1) el("line", { x1: sx(Math.min(...vals)), x2: sx(Math.max(...vals)), y1: y, y2: y, stroke: C.eje, "stroke-width": 2, "stroke-linecap": "round" }, svg);
        const empate = vals.length > 1 && Math.max(...vals) - Math.min(...vals) < (op.max - op.min) / 200;
        op.series.forEach((s, k) => {
          const v = fila.valores[s.id];
          if (v == null) return;
          const yy = empate ? y + (k - (op.series.length - 1) / 2) * 9 : y;
          const c = el("circle", { cx: sx(Math.max(op.min, v)), cy: yy, r: 6, fill: s.color, stroke: "#fff", "stroke-width": 2 }, svg);
          const hit = el("circle", { cx: sx(Math.max(op.min, v)), cy: yy, r: 12, fill: "transparent" }, svg);
          hit.addEventListener("mousemove", (ev) => {
            const html = `<b>${fila.nombre}</b>` + op.series.map((z) => `<div class="fila-tt"><i style="background:${z.color}"></i>${z.nombre}: <b>${fila.valores[z.id] != null ? f(fila.valores[z.id]) : "—"}</b></div>`).join("");
            mostrarTooltip(html, ev); c.setAttribute("r", 7);
          });
          hit.addEventListener("mouseleave", () => { ocultarTooltip(); c.setAttribute("r", 6); });
        });
      });
    });
  }

  /* ---------------------------------------------------------- matriz de confusión */
  function matriz(cont, cm, op) {
    op = op || {};
    const total = cm.tn + cm.fp + cm.fn + cm.tp || 1;
    const celdas = [
      { v: cm.tn, nombre: "Verdaderos negativos", corto: "VN", real: "No barco", pred: "No barco", ok: true },
      { v: cm.fp, nombre: "Falsos positivos", corto: "FP", real: "No barco", pred: "Barco", ok: false },
      { v: cm.fn, nombre: "Falsos negativos", corto: "FN", real: "Barco", pred: "No barco", ok: false },
      { v: cm.tp, nombre: "Verdaderos positivos", corto: "VP", real: "Barco", pred: "Barco", ok: true },
    ];
    const maxV = Math.max(...celdas.map((c) => c.v), 1);
    const color = (v) => {
      // rampa secuencial azul: de #f2f7fe (0) a #1c5cab (máximo)
      const t = Math.sqrt(v / maxV);
      const a = [242, 247, 254], b = [28, 92, 171];
      return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(",")})`;
    };
    const tinta = (v) => (Math.sqrt(v / maxV) > 0.5 ? "#fff" : "#1d1d1f");
    const mini = op.mini ? " mini" : "";
    cont.innerHTML = (op.titulo ? `<div class="matriz-titulo">${op.titulo}</div>` : "") +
      `<div class="matriz">
        <div></div><div class="eje">Pred. no barco</div><div class="eje">Pred. barco</div>
        <div class="eje fila">Real no barco</div>${celda(celdas[0])}${celda(celdas[1])}
        <div class="eje fila">Real barco</div>${celda(celdas[2])}${celda(celdas[3])}
      </div>`;
    function celda(c) {
      return `<div class="celda${mini}" style="background:${color(c.v)};color:${tinta(c.v)}" data-tt="${c.nombre}|${c.v}|${(100 * c.v / total).toFixed(1)}|${c.real}|${c.pred}">
        <b>${c.v}</b><span>${c.corto} · ${(100 * c.v / total).toFixed(1)} %</span></div>`;
    }
    cont.querySelectorAll(".celda").forEach((n) => {
      n.addEventListener("mousemove", (ev) => {
        const [nombre, v, p, real, pred] = n.dataset.tt.split("|");
        mostrarTooltip(`<b>${nombre}</b><div>${v} imágenes (${p} %)</div><div>Real: ${real} · Predicción: ${pred}</div>`, ev);
      });
      n.addEventListener("mouseleave", ocultarTooltip);
    });
  }

  window.G = { lineas, roc, histograma, puntos, matriz, mostrarTooltip, ocultarTooltip, montar, el, txt, C };
})();
