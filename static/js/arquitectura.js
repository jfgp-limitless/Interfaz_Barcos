/* =====================================================================
   Diagramas de arquitectura generados a partir de la estructura real
   de cada modelo (info_modelos/<id>.json).
   - Cada tensor se dibuja como un bloque 3D: alto proporcional al tamaño
     espacial (alto × ancho) y grosor proporcional al número de canales.
   - Las capas densas se dibujan como barras verticales.
   ===================================================================== */
(function () {
  "use strict";

  const PALETA = {
    entrada:    { frente: "#ffffff", arriba: "#f5f5f7", lado: "#e5e5ea", borde: "#aeaeb2" },
    entrenable: { frente: "#d6e6fa", arriba: "#e9f1fd", lado: "#a9c9f2", borde: "#2a78d6" },
    congelado:  { frente: "#e5e5ea", arriba: "#f0f0f3", lado: "#d1d1d6", borde: "#aeaeb2" },
    salida:     { frente: "#2a78d6", arriba: "#2a78d6", lado: "#2a78d6", borde: "#2a78d6" },
  };
  const fmt = (n) => Number(n).toLocaleString("en-US").replace(/,/g, "\u2009");
  const fmtParam = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + " M" : n >= 1e3 ? (n / 1e3).toFixed(1) + " k" : String(n));

  /* ------------------------------------------------------------ nodos por modelo */
  function nodosCNN(arq) {
    const capas = arq.capas;
    const nodos = [{ tipo: "tensor", h: 80, w: 80, c: 3, titulo: "Entrada", sub: "Imagen RGB", estado: "entrada" }];
    const aum = capas.filter((c) => /^Random/.test(c.tipo)).map((c) => c.tipo.replace("Random", ""));
    if (aum.length) nodos.push({ tipo: "op", titulo: "Aumento de datos", sub: "solo al entrenar", detalle: traducirAum(aum) });
    const resc = capas.find((c) => c.tipo === "Rescaling");
    if (resc) nodos.push({ tipo: "op", titulo: "Rescaling", sub: "÷ 255", detalle: "Lleva los píxeles de 0–255 a 0–1" });

    // bloques: conjuntos de capas entre MaxPooling
    let bloque = null, nb = 0;
    for (const c of capas) {
      if (c.tipo === "Conv2D") {
        if (!bloque) { bloque = { convs: 0, params: 0 }; nb++; }
        bloque.convs++; bloque.params += c.parametros; bloque.salida = c.salida; bloque.filtros = c.salida[3];
      } else if (bloque && (c.tipo === "BatchNormalization" || c.tipo === "Activation")) {
        bloque.params += c.parametros;
      } else if (bloque && c.tipo === "MaxPooling2D") {
        nodos.push({
          tipo: "tensor", h: bloque.salida[1], w: bloque.salida[2], c: bloque.filtros,
          titulo: `Bloque ${nb}`, sub: `${bloque.convs} × Conv 3×3 · BN · ReLU + MaxPool 2×2`, params: bloque.params, estado: "entrenable",
        });
        bloque = null;
        nodos.push({ tipo: "pool", h: c.salida[1], w: c.salida[2], c: c.salida[3] });
      }
    }
    // Quitar los "pool" intermedios: se representan como etiqueta de flecha; el último queda como mapa final
    const limpio = [];
    nodos.forEach((n, i) => {
      if (n.tipo !== "pool") { limpio.push(n); return; }
      const sig = nodos[i + 1];
      if (!sig || sig.tipo !== "tensor") limpio.push({ tipo: "tensor", h: n.h, w: n.w, c: n.c, titulo: "Mapa final", sub: "tras el último MaxPool", estado: "entrenable" });
    });
    const iUltimoPool = capas.map((c) => c.tipo).lastIndexOf("MaxPooling2D");
    for (const c of capas.slice(iUltimoPool + 1)) {
      if (c.tipo === "Dropout") limpio.push({ tipo: "op", titulo: "Dropout", sub: "50 %", detalle: "Apaga el 50 % de las activaciones al entrenar" });
      if (c.tipo === "GlobalAveragePooling2D") limpio.push({ tipo: "vector", n: c.salida[1], titulo: "Global Avg Pool", sub: `${c.salida[1]} valores`, estado: "entrenable", sinPesos: true });
      if (c.tipo === "Dense") {
        const n = c.salida[1];
        limpio.push({ tipo: "vector", n, titulo: n === 1 ? "Dense 1" : `Dense ${n}`, sub: n === 1 ? "sigmoide" : "ReLU", params: c.parametros, estado: "entrenable" });
      }
    }
    limpio.push({ tipo: "salida", titulo: "P(barco)", sub: "> 0.5 → Barco" });
    return limpio;
  }

  function nodosResNet(arq) {
    const capas = arq.capas;
    const sub = arq.subred;
    const nodos = [{ tipo: "tensor", h: 80, w: 80, c: 3, titulo: "Entrada", sub: "Imagen RGB", estado: "entrada" }];
    const aum = capas.filter((c) => /^Random/.test(c.tipo)).map((c) => c.tipo.replace("Random", ""));
    if (aum.length) nodos.push({ tipo: "op", titulo: "Aumento de datos", sub: "solo al entrenar", detalle: traducirAum(aum) });
    const rs = capas.find((c) => c.tipo === "Resizing");
    if (rs) nodos.push({ tipo: "op", titulo: "Resizing", sub: `${rs.salida[1]} px`, detalle: `Escala la imagen a ${rs.salida[1]}×${rs.salida[2]} px` });
    if (capas.find((c) => c.tipo === "Normalization")) nodos.push({ tipo: "op", titulo: "Normalización", sub: "ImageNet", detalle: "Resta la media de ImageNet por canal" });
    const nombres = { conv1: "conv1", conv2: "conv2_x", conv3: "conv3_x", conv4: "conv4_x", conv5: "conv5_x" };
    let flechaPend = null;
    for (const e of sub.etapas) {
      if (e.nombre === "pool1") continue;
      if (!nombres[e.nombre]) continue;
      const parcial = e.entrenables > 0 && e.entrenables < e.parametros;
      nodos.push({
        tipo: "tensor", h: e.salida[1], w: e.salida[2], c: e.salida[3],
        titulo: nombres[e.nombre],
        sub: e.nombre === "conv1" ? "Conv 7×7 · stride 2 + MaxPool 3×3" : `${e.bloques} bloques residuales`,
        params: e.parametros, estado: e.entrenables > 0 ? "entrenable" : "congelado",
        nota: e.entrenables > 0 ? (parcial ? "reentrenada (parcial)" : "reentrenada") : "congelada",
        flechaAntes: flechaPend,
      });
      flechaPend = null;
    }
    const iRes = capas.findIndex((c) => c.tipo === "Functional");
    for (const c of capas.slice(iRes + 1)) {
      if (c.tipo === "GlobalAveragePooling2D") nodos.push({ tipo: "vector", n: c.salida[1], titulo: "Global Avg Pool", sub: `${c.salida[1]} valores`, estado: "entrenable", sinPesos: true });
      if (c.tipo === "BatchNormalization") nodos.push({ tipo: "op", titulo: "BatchNorm", sub: "", detalle: "Normaliza el vector de 2048 valores" });
      if (c.tipo === "Dropout") nodos.push({ tipo: "op", titulo: "Dropout", sub: "50 %", detalle: "Apaga el 50 % de las activaciones al entrenar" });
      if (c.tipo === "Dense") {
        const n = c.salida[1];
        nodos.push({ tipo: "vector", n, titulo: `Dense ${n}`, sub: n === 1 ? "sigmoide" : "ReLU", params: c.parametros, estado: "entrenable" });
      }
    }
    nodos.push({ tipo: "salida", titulo: "P(barco)", sub: "> 0.5 → Barco" });
    // la flecha previa a un tensor se dibuja en el nodo anterior
    nodos.forEach((n, i) => { if (n.flechaAntes && i > 0) nodos[i - 1].flecha = n.flechaAntes; });
    return nodos;
  }

  function traducirAum(lista) {
    const t = { Flip: "flip", Rotation: "rotación", Zoom: "zoom", Contrast: "contraste" };
    const s = lista.map((x) => t[x] || x.toLowerCase()).join(" · ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /* ------------------------------------------------------------ dibujo */
  function envolver(texto, maxCar) {
    const palabras = String(texto || "").split(" ");
    const lineas = [];
    let actual = "";
    for (const p of palabras) {
      if (actual && (actual + " " + p).length > maxCar) { lineas.push(actual); actual = p; }
      else actual = actual ? actual + " " + p : p;
    }
    if (actual) lineas.push(actual);
    return lineas;
  }

  function dibujar(cont, nodos) {
    window.G.montar(cont, (anchoCont) => dibujarAncho(cont, nodos, anchoCont));
  }

  function dibujarAncho(cont, nodos, anchoCont) {
    const { el, txt } = window.G;
    const maxEsp = Math.max(...nodos.filter((n) => n.tipo === "tensor").map((n) => n.h));
    const geo = nodos.map((n) => {
      if (n.tipo === "tensor") {
        const s = 26 + 100 * Math.pow(n.h / maxEsp, 0.7);
        const t = 5 + 4.5 * Math.log2(Math.max(n.c, 2));
        const o = Math.max(8, s * 0.3);
        return { ancho: t + o, s, t, o, espacio: Math.max(t + o + 6, 80) };
      }
      if (n.tipo === "vector") {
        const s = Math.min(150, 34 + 11 * Math.log2(Math.max(n.n, 2)));
        return { ancho: 16, s, espacio: 58 };
      }
      if (n.tipo === "op") return { ancho: 26, espacio: 48 };
      return { ancho: 70, espacio: 72 };
    });
    const sep = () => 11;
    let natural = 12;
    nodos.forEach((n, i) => { natural += geo[i].espacio + (i < nodos.length - 1 ? sep(n) : 0); });
    natural += 12;
    const extra = Math.max(0, anchoCont - natural) / Math.max(1, nodos.length - 1);
    const W = Math.max(natural, anchoCont);
    let x = 12;
    const pos = nodos.map((n, i) => {
      const cx = x + geo[i].espacio / 2;
      x += geo[i].espacio + sep(n) + extra;
      return cx;
    });

    const H = 336, cy = 118, yTexto = 222;
    const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Diagrama de arquitectura" }, cont);
    const defs = el("defs", {}, svg);
    const idPunta = "punta-" + (cont.id || Math.random().toString(36).slice(2));
    const mk = el("marker", { id: idPunta, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto" }, defs);
    el("path", { d: "M0,1 L9,5 L0,9 z", fill: "#aeaeb2" }, mk);

    for (let i = 0; i < nodos.length - 1; i++) {
      const a = pos[i] + geo[i].ancho / 2 + 5, b = pos[i + 1] - geo[i + 1].ancho / 2 - 6;
      if (b - a < 6) continue;
      el("line", { x1: a, y1: cy, x2: b, y2: cy, stroke: "#aeaeb2", "stroke-width": 1.5, "marker-end": `url(#${idPunta})` }, svg);
      if (nodos[i].flecha) txt(svg, (a + b) / 2, cy - 9, nodos[i].flecha, { "text-anchor": "middle", "font-size": 10.5, fill: "#6e6e73" });
    }

    nodos.forEach((n, i) => {
      const g = geo[i], cx = pos[i];
      const grupo = el("g", { class: "nodo", style: "cursor:default" }, svg);
      if (n.tipo === "tensor") {
        const pal = PALETA[n.estado] || PALETA.entrenable;
        const x0 = cx - g.ancho / 2, y0 = cy - g.s / 2 + g.o / 2;
        const { s, t, o } = g;
        el("path", { d: `M${x0},${y0} L${x0 + o},${y0 - o} L${x0 + t + o},${y0 - o} L${x0 + t},${y0} Z`, fill: pal.arriba, stroke: pal.borde, "stroke-width": 1, "stroke-linejoin": "round" }, grupo);
        el("path", { d: `M${x0 + t},${y0} L${x0 + t + o},${y0 - o} L${x0 + t + o},${y0 + s - o} L${x0 + t},${y0 + s} Z`, fill: pal.lado, stroke: pal.borde, "stroke-width": 1, "stroke-linejoin": "round" }, grupo);
        el("rect", { x: x0, y: y0, width: t, height: s, fill: pal.frente, stroke: pal.borde, "stroke-width": 1 }, grupo);
      } else if (n.tipo === "vector") {
        const pal = n.sinPesos ? PALETA.entrada : PALETA[n.estado] || PALETA.entrenable;
        el("rect", { x: cx - 8, y: cy - g.s / 2, width: 16, height: g.s, rx: 5, fill: pal.frente, stroke: pal.borde, "stroke-width": 1 }, grupo);
      } else if (n.tipo === "op") {
        el("rect", { x: cx - 13, y: cy - 56, width: 26, height: 112, rx: 13, fill: "#fbfbfd", stroke: "#c7c7cc", "stroke-width": 1, "stroke-dasharray": "3 3" }, grupo);
        const t = txt(grupo, 0, 0, n.titulo, { "text-anchor": "middle", "font-size": 11, fill: "#3a3a3c", "font-weight": 600 });
        t.setAttribute("transform", `translate(${cx + 4},${cy}) rotate(-90)`);
      } else if (n.tipo === "salida") {
        el("rect", { x: cx - 35, y: cy - 20, width: 70, height: 40, rx: 20, fill: "#2a78d6" }, grupo);
        txt(grupo, cx, cy + 5, n.titulo, { "text-anchor": "middle", "font-size": 13, fill: "#fff", "font-weight": 600 });
      }

      // textos bajo el nodo (con salto de línea según el espacio disponible)
      const maxCar = Math.max(9, Math.floor((g.espacio + extra * 0.8) / 6.1));
      let ty = yTexto;
      const linea = (s, attrs) => { for (const l of envolver(s, maxCar)) { txt(grupo, cx, ty, l, Object.assign({ "text-anchor": "middle" }, attrs)); ty += 14; } };
      if (n.tipo !== "op") linea(n.titulo, { "font-size": 12.5, fill: "#1d1d1f", "font-weight": 600 });
      if (n.tipo === "tensor") linea(`${n.h}×${n.w}×${n.c}`, { "font-size": 11.5, fill: "#1d1d1f" });
      if (n.sub) linea(n.sub, { "font-size": 11, fill: "#6e6e73" });
      if (n.params) linea(fmtParam(n.params) + " parám.", { "font-size": 11, fill: "#86868b" });
      if (n.nota) linea(n.nota, { "font-size": 11, fill: n.estado === "entrenable" ? "#1c5cab" : "#86868b", "font-weight": 500 });

      grupo.addEventListener("mousemove", (ev) => {
        let html = `<b>${n.titulo}</b>`;
        if (n.tipo === "tensor") html += `<div>Salida: ${n.h} × ${n.w} × ${n.c}</div>`;
        if (n.tipo === "vector") html += `<div>Salida: ${n.n} valores</div>`;
        if (n.sub) html += `<div>${n.sub}</div>`;
        if (n.detalle) html += `<div>${n.detalle}</div>`;
        if (n.params) html += `<div>${fmt(n.params)} parámetros</div>`;
        if (n.nota) html += `<div>${n.nota}</div>`;
        window.G.mostrarTooltip(html, ev);
      });
      grupo.addEventListener("mouseleave", window.G.ocultarTooltip);
    });
  }

  /* ------------------------------------------------------------ explicativos */
  function bloqueCNN(cont) {
    const pasos = [["Conv 3×3", "detecta bordes y formas"], ["BatchNorm", "estabiliza"], ["ReLU", "no linealidad"],
      ["Conv 3×3", "combina patrones"], ["BatchNorm", "estabiliza"], ["ReLU", "no linealidad"], ["MaxPool 2×2", "reduce a la mitad"]];
    cadena(cont, pasos);
  }

  function cadena(cont, pasos) {
    const { el, txt } = window.G;
    cont.innerHTML = "";
    const W = 640, H = 92, w = 78, gap = (W - pasos.length * w) / (pasos.length - 1);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": "Capas de un bloque convolucional" }, cont);
    pasos.forEach((p, i) => {
      const x = i * (w + gap);
      const esPool = p[0].startsWith("MaxPool");
      el("rect", { x, y: 8, width: w, height: 38, rx: 10, fill: esPool ? "#fbfbfd" : "#e9f1fd", stroke: esPool ? "#d2d2d7" : "#2a78d6", "stroke-width": 1 }, svg);
      txt(svg, x + w / 2, 31, p[0], { "text-anchor": "middle", "font-size": 11.5, fill: "#1d1d1f", "font-weight": 600 });
      const partes = p[1].split(" ");
      const mitad = Math.ceil(partes.length / 2);
      txt(svg, x + w / 2, 64, partes.slice(0, mitad).join(" "), { "text-anchor": "middle", "font-size": 10.5, fill: "#6e6e73" });
      if (partes.length > 1) txt(svg, x + w / 2, 78, partes.slice(mitad).join(" "), { "text-anchor": "middle", "font-size": 10.5, fill: "#6e6e73" });
      if (i < pasos.length - 1) el("line", { x1: x + w + 3, y1: 27, x2: x + w + gap - 3, y2: 27, stroke: "#aeaeb2", "stroke-width": 1.5 }, svg);
    });
  }

  function bloqueResidual(cont) {
    const { el, txt } = window.G;
    cont.innerHTML = "";
    const W = 440, H = 330;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", style: "max-width:460px;display:block;margin:auto", role: "img", "aria-label": "Bloque residual tipo cuello de botella" }, cont);
    const cx = 150;
    const cajas = [["Entrada del bloque", 18, "#fbfbfd", "#d2d2d7"], ["Conv 1×1 · reduce canales", 78, "#e9f1fd", "#2a78d6"],
      ["Conv 3×3 · patrones espaciales", 138, "#e9f1fd", "#2a78d6"], ["Conv 1×1 · expande canales", 198, "#e9f1fd", "#2a78d6"]];
    cajas.forEach(([t, y, f, b], i) => {
      el("rect", { x: cx - 105, y, width: 210, height: 36, rx: 10, fill: f, stroke: b, "stroke-width": 1 }, svg);
      txt(svg, cx, y + 23, t, { "text-anchor": "middle", "font-size": 12, fill: "#1d1d1f", "font-weight": i ? 500 : 600 });
      if (i < cajas.length - 1) el("line", { x1: cx, y1: y + 36, x2: cx, y2: y + 60, stroke: "#aeaeb2", "stroke-width": 1.5 }, svg);
      if (i > 0) txt(svg, cx + 112, y + 23, "+ BN + ReLU", { "font-size": 10.5, fill: "#86868b" });
    });
    el("line", { x1: cx, y1: 234, x2: cx, y2: 262, stroke: "#aeaeb2", "stroke-width": 1.5 }, svg);
    el("circle", { cx, cy: 276, r: 14, fill: "#fff", stroke: "#1d1d1f", "stroke-width": 1.5 }, svg);
    txt(svg, cx, 281, "+", { "text-anchor": "middle", "font-size": 18, fill: "#1d1d1f", "font-weight": 600 });
    el("path", { d: `M${cx + 105},36 C${cx + 270},36 ${cx + 270},276 ${cx + 16},276`, fill: "none", stroke: "#eb6834", "stroke-width": 2 }, svg);
    txt(svg, cx + 226, 150, "atajo", { "font-size": 11.5, fill: "#1d1d1f", "font-weight": 600 });
    txt(svg, cx + 226, 165, "(identidad)", { "font-size": 10.5, fill: "#6e6e73" });
    el("line", { x1: cx, y1: 290, x2: cx, y2: 312, stroke: "#aeaeb2", "stroke-width": 1.5 }, svg);
    txt(svg, cx, 326, "ReLU → salida del bloque", { "text-anchor": "middle", "font-size": 11.5, fill: "#6e6e73" });
  }

  /* ------------------------------------------------------------ distribución de parámetros */
  function distribucionParametros(cont, id, arq) {
    let filas;
    if (id === "resnet50" && arq.subred) {
      filas = arq.subred.etapas.filter((e) => e.parametros > 0).map((e) => ({
        nombre: e.nombre === "conv1" ? "conv1" : e.nombre + "_x", total: e.parametros, entrenables: e.entrenables,
      }));
      const iRes = arq.capas.findIndex((c) => c.tipo === "Functional");
      const cabeza = arq.capas.slice(iRes + 1).reduce((a, c) => a + c.parametros, 0);
      const cabezaE = arq.capas.slice(iRes + 1).reduce((a, c) => a + c.entrenables, 0);
      filas.push({ nombre: "Clasificador", total: cabeza, entrenables: cabezaE });
    } else {
      filas = [];
      let b = null, n = 0;
      for (const c of arq.capas) {
        if (c.tipo === "Conv2D" && !b) { b = { nombre: `Bloque ${++n}`, total: 0, entrenables: 0 }; }
        if (b) { b.total += c.parametros; b.entrenables += c.parametros; }
        if (b && c.tipo === "MaxPooling2D") { filas.push(b); b = null; }
      }
      const cab = arq.capas.filter((c) => c.tipo === "Dense");
      filas.push({ nombre: "Clasificador", total: cab.reduce((a, c) => a + c.parametros, 0), entrenables: cab.reduce((a, c) => a + c.parametros, 0) });
    }
    const total = filas.reduce((a, f) => a + f.total, 0);
    window.G.montar(cont, (W) => {
      const { el, txt } = window.G;
      const alto = 34, m = { l: 96, r: 120, t: 4 };
      const H = m.t + filas.length * alto + 4;
      const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Distribución de parámetros" }, cont);
      const maxV = Math.max(...filas.map((f) => f.total));
      const sx = (v) => (v / maxV) * (W - m.l - m.r);
      filas.forEach((f, i) => {
        const y = m.t + i * alto + 7, h = 20;
        txt(svg, m.l - 12, y + 14, f.nombre, { "text-anchor": "end", fill: "#1d1d1f", "font-size": 12 });
        const wc = Math.max(2, sx(f.total - f.entrenables)), we = sx(f.entrenables);
        if (f.total - f.entrenables > 0) barra(svg, m.l, y, wc, h, "#d1d1d6", we < 1);
        if (f.entrenables > 0) barra(svg, m.l + (f.total - f.entrenables > 0 ? wc + 2 : 0), y, Math.max(2, we), h, "#2a78d6", true);
        txt(svg, m.l + sx(f.total) + 10, y + 14, `${fmtParam(f.total)} · ${(100 * f.total / total).toFixed(1)} %`, { fill: "#6e6e73", "font-size": 11.5 });
        const hit = el("rect", { x: m.l, y: y - 4, width: W - m.l - m.r + 100, height: h + 8, fill: "transparent" }, svg);
        hit.addEventListener("mousemove", (ev) => window.G.mostrarTooltip(
          `<b>${f.nombre}</b><div>${fmt(f.total)} parámetros (${(100 * f.total / total).toFixed(1)} %)</div><div>Entrenables: ${fmt(f.entrenables)}</div><div>Congelados: ${fmt(f.total - f.entrenables)}</div>`, ev));
        hit.addEventListener("mouseleave", window.G.ocultarTooltip);
      });
    });
    function barra(svg, x, y, w, h, color, redondeo) {
      const r = redondeo ? Math.min(4, w / 2) : 0;
      window.G.el("path", { d: `M${x},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x},${y + h} Z`, fill: color }, svg);
    }
  }

  window.ARQ = {
    diagrama(cont, id, arq) { dibujar(cont, id === "resnet50" ? nodosResNet(arq) : nodosCNN(arq)); },
    bloqueCNN, bloqueResidual, distribucionParametros, fmtParam,
  };
})();
