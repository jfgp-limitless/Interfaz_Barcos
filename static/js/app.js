/* =====================================================================
   Interfaz de evaluación en vivo · Detección de barcos
   ===================================================================== */
(function () {
  "use strict";

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const EXT = /\.(png|jpe?g|bmp|tiff?|webp)$/i;
  const LOTE = 48;
  const COLOR = { resnet50: "#2a78d6", cnn: "#eb6834" };
  const ICONO_OK = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor" opacity=".15"/><path d="M4.5 8.2l2.2 2.2 4.8-4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICONO_MAL = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor" opacity=".15"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const ICONO_INFO = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor" opacity=".15"/><path d="M8 7.2v4M8 4.8v.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  const S = {
    catalogo: null, info: {}, estado: null,
    seleccion: "resnet50", ficha: "resnet50",
    eval: null, vistaRes: null,
    umbral: 0.5, filtro: "todas", orden: "nombre", limite: 120,
  };

  /* ------------------------------------------------------------ utilidades */
  const pct = (v, d = 1) => (v == null || isNaN(v) ? "—" : (v * 100).toFixed(d));
  const num = (v, d = 4) => (v == null || isNaN(v) ? "—" : v.toFixed(d));
  const miles = (n) => Number(n).toLocaleString("en-US").replace(/,/g, "\u2009");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const modelo = (id) => S.catalogo.modelos.find((m) => m.id === id);
  const nombreModelo = (id) => (modelo(id) || {}).nombre || id;
  const meta = () => S.catalogo.proyecto.meta_accuracy || 0.98;

  function segmentado(cont, opciones, activo, alCambiar) {
    cont.innerHTML = "";
    opciones.forEach((o) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "seg" + (o.id === activo ? " activo" : "");
      b.setAttribute("role", "radio"); b.setAttribute("aria-checked", o.id === activo);
      b.innerHTML = o.html || esc(o.texto);
      b.addEventListener("click", () => {
        $$(".seg", cont).forEach((x) => { x.classList.remove("activo"); x.setAttribute("aria-checked", "false"); });
        b.classList.add("activo"); b.setAttribute("aria-checked", "true");
        alCambiar(o.id);
      });
      cont.appendChild(b);
    });
  }

  /* ------------------------------------------------------------ métricas (en vivo) */
  function calcular(items, id, umbral) {
    const et = items.filter((i) => i.valida && i.real != null && i.prob && i.prob[id] != null);
    const r = { n: items.filter((i) => i.valida).length, nEt: et.length, tp: 0, tn: 0, fp: 0, fn: 0 };
    r.predBarco = items.filter((i) => i.valida && i.prob && i.prob[id] > umbral).length;
    for (const i of et) {
      const p = i.prob[id] > umbral ? 1 : 0;
      if (p === 1 && i.real === 1) r.tp++; else if (p === 0 && i.real === 0) r.tn++;
      else if (p === 1) r.fp++; else r.fn++;
    }
    const d = (a, b) => (b ? a / b : null);
    r.pos = r.tp + r.fn; r.neg = r.tn + r.fp;
    r.accuracy = d(r.tp + r.tn, r.nEt);
    r.precision = d(r.tp, r.tp + r.fp);
    r.recall = d(r.tp, r.tp + r.fn);
    r.especificidad = d(r.tn, r.tn + r.fp);
    r.f1 = r.precision != null && r.recall != null && r.precision + r.recall > 0 ? (2 * r.precision * r.recall) / (r.precision + r.recall) : null;
    const pos = et.filter((i) => i.real === 1).map((i) => i.prob[id]);
    const neg = et.filter((i) => i.real === 0).map((i) => i.prob[id]);
    r.auc = null; r.roc = [];
    if (pos.length && neg.length) {
      let s = 0;
      for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0;
      r.auc = s / (pos.length * neg.length);
      const orden = et.map((i) => [i.prob[id], i.real]).sort((a, b) => b[0] - a[0]);
      let tp = 0, fp = 0;
      r.roc.push([0, 0]);
      for (let k = 0; k < orden.length; k++) {
        if (orden[k][1] === 1) tp++; else fp++;
        if (k === orden.length - 1 || orden[k + 1][0] !== orden[k][0]) r.roc.push([fp / neg.length, tp / pos.length]);
      }
    }
    const bordes = Array.from({ length: 21 }, (_, k) => k / 20);
    const bin = (p) => Math.min(19, Math.floor(p * 20));
    r.hist = { bordes, barcos: Array(20).fill(0), noBarcos: Array(20).fill(0), sinEt: Array(20).fill(0) };
    for (const i of items) {
      if (!i.valida || !i.prob) continue;
      const k = bin(i.prob[id]);
      if (i.real === 1) r.hist.barcos[k]++; else if (i.real === 0) r.hist.noBarcos[k]++; else r.hist.sinEt[k]++;
    }
    return r;
  }

  /* ------------------------------------------------------------ arranque */
  async function iniciar() {
    const r = await fetch("/api/config");
    const cfg = await r.json();
    S.catalogo = cfg.catalogo; S.info = cfg.info; S.estado = cfg.estado;
    S.umbral = modelo("resnet50").umbral;
    pintarIdentidad();
    pintarEstado();
    if (!S.estado.listo) sondearEstado();
    configurarPestanas();
    configurarCarga();
    segmentado($("#selector-modelo"), opcionesModelo(true), S.seleccion, (id) => { S.seleccion = id; ayudaModelo(); });
    ayudaModelo();
    segmentado($("#selector-ficha"), opcionesModelo(false), S.ficha, (id) => { S.ficha = id; pintarFicha(); });
    pintarFicha();
    pintarComparacion();
    configurarResultados();
  }

  function opcionesModelo(conAmbos) {
    const ops = S.catalogo.modelos.map((m) => {
      const t = S.info[m.id] && S.info[m.id].conjuntos ? S.info[m.id].conjuntos.test.accuracy : null;
      return { id: m.id, html: `${esc(m.nombre)}<small>${t != null ? "test " + pct(t) + " %" : m.tipo}</small>` };
    });
    if (conAmbos) ops.push({ id: "ambos", html: "Ambos<small>comparar en vivo</small>" });
    return ops;
  }

  function ayudaModelo() {
    const t = S.seleccion === "ambos"
      ? "Se evalúan los dos modelos sobre las mismas imágenes; la pestaña Comparación mostrará el resultado lado a lado."
      : modelo(S.seleccion).descripcion;
    $("#ayuda-modelo").textContent = t;
  }

  function pintarIdentidad() {
    const p = S.catalogo.proyecto;
    $("#autor-nombre").textContent = p.estudiante;
    $("#autor-detalle").textContent = `Código ${p.codigo} · ${p.programa}`;
    $("#pie-nombre").textContent = p.estudiante;
    $("#pie-codigo").textContent = p.codigo;
    $("#pie-programa").textContent = `${p.programa} · ${p.universidad}`;
    const ini = p.estudiante.split(" ").filter(Boolean).slice(0, 2).map((x) => x[0]).join("");
    $(".autor-avatar").textContent = ini.toUpperCase();
  }

  function pintarEstado() {
    const e = S.estado, n = $("#estado");
    n.classList.remove("cargando", "listo", "error");
    const errores = Object.keys(e.errores || {});
    if (!e.listo) { n.classList.add("cargando"); n.querySelector(".estado-texto").textContent = "Cargando modelos"; }
    else if (errores.length) { n.classList.add("error"); n.querySelector(".estado-texto").textContent = "Error al cargar: " + errores.join(", "); n.title = JSON.stringify(e.errores); }
    else { n.classList.add("listo"); n.querySelector(".estado-texto").textContent = `Modelos listos · TensorFlow ${e.tensorflow}`; }
  }

  async function sondearEstado() {
    while (!S.estado.listo) {
      await new Promise((r) => setTimeout(r, 1200));
      try { S.estado = await (await fetch("/api/estado")).json(); } catch (_) { /* reintenta */ }
      pintarEstado();
    }
  }

  function configurarPestanas() {
    $$(".pestana").forEach((b) => b.addEventListener("click", () => {
      $$(".pestana").forEach((x) => { x.classList.remove("activa"); x.setAttribute("aria-selected", "false"); });
      b.classList.add("activa"); b.setAttribute("aria-selected", "true");
      $$(".vista").forEach((v) => v.classList.remove("activa"));
      $("#vista-" + b.dataset.vista).classList.add("activa");
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (b.dataset.vista === "comparacion") pintarComparacion();
    }));
  }

  /* ------------------------------------------------------------ carga de carpetas */
  function configurarCarga() {
    const input = $("#input-carpeta");
    $("#btn-carpeta").addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      const archivos = Array.from(input.files).filter((f) => EXT.test(f.name) && !f.name.startsWith("."));
      const lista = archivos.map((f) => ({ file: f, ruta: f.webkitRelativePath || f.name }));
      input.value = "";
      evaluarArchivos(lista);
    });

    const zona = $("#zona");
    ["dragenter", "dragover"].forEach((t) => zona.addEventListener(t, (e) => { e.preventDefault(); zona.classList.add("sobre"); }));
    ["dragleave", "drop"].forEach((t) => zona.addEventListener(t, (e) => { e.preventDefault(); zona.classList.remove("sobre"); }));
    zona.addEventListener("drop", async (e) => {
      const entradas = Array.from(e.dataTransfer.items || []).map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
      const lista = [];
      for (const en of entradas) await recorrer(en, lista);
      evaluarArchivos(lista.filter((x) => EXT.test(x.file.name)));
    });

    $("#btn-ruta").addEventListener("click", () => evaluarRuta($("#input-ruta").value));
    $("#input-ruta").addEventListener("keydown", (e) => { if (e.key === "Enter") evaluarRuta(e.target.value); });
    $("#btn-explorar").addEventListener("click", async () => {
      const b = $("#btn-explorar"); b.disabled = true; b.textContent = "Abriendo…";
      try {
        const r = await (await fetch("/api/elegir_carpeta", { method: "POST" })).json();
        if (r.ruta) { $("#input-ruta").value = r.ruta; evaluarRuta(r.ruta); }
        else if (r.error) avisar("No se pudo abrir el explorador. Escribe la ruta manualmente.");
      } finally { b.disabled = false; b.textContent = "Explorar"; }
    });
  }

  function recorrer(entrada, lista, prefijo = "") {
    return new Promise((ok) => {
      if (entrada.isFile) {
        entrada.file((f) => { lista.push({ file: f, ruta: prefijo + f.name }); ok(); }, () => ok());
      } else if (entrada.isDirectory) {
        const lector = entrada.createReader();
        const todas = [];
        const leer = () => lector.readEntries(async (lote) => {
          if (!lote.length) {
            for (const e of todas) await recorrer(e, lista, prefijo + entrada.name + "/");
            ok();
          } else { todas.push(...lote); leer(); }
        }, () => ok());
        leer();
      } else ok();
    });
  }

  function avisar(texto) { const a = $("#aviso-carga"); a.textContent = texto; a.hidden = !texto; }

  function idsSeleccion() { return S.seleccion === "ambos" ? S.catalogo.modelos.map((m) => m.id) : [S.seleccion]; }

  function progreso(titulo, hecho, total) {
    $("#panel-progreso").hidden = false;
    $("#progreso-titulo").textContent = titulo;
    $("#progreso-texto").textContent = `${miles(hecho)} / ${miles(total)} imágenes`;
    $("#progreso-relleno").style.width = (total ? (100 * hecho) / total : 0) + "%";
  }

  function nuevaEvaluacion(carpeta, ids) {
    if (S.eval) S.eval.items.forEach((i) => i.url && i.url.startsWith("blob:") && URL.revokeObjectURL(i.url));
    S.eval = { carpeta, modelos: ids, items: [], tiempos: Object.fromEntries(ids.map((i) => [i, 0])), nInferidas: 0 };
    S.vistaRes = ids[0]; S.filtro = "todas"; S.limite = 120;
  }

  function agregarRespuesta(resp, extra) {
    resp.items.forEach((it, k) => {
      const e = extra ? extra[k] : {};
      S.eval.items.push({
        idx: S.eval.items.length, ruta: it.ruta, nombre: it.ruta.split("/").pop(),
        etiquetaOriginal: it.etiqueta, real: it.etiqueta, ajustada: it.ajustada, valida: it.valida,
        prob: it.prob || null, url: it.miniatura || e.url || "",
      });
    });
    for (const id in resp.tiempos_ms) S.eval.tiempos[id] += resp.tiempos_ms[id];
    S.eval.nInferidas += resp.n_validas;
  }

  async function evaluarArchivos(lista) {
    avisar("");
    if (!lista.length) { avisar("La carpeta no contiene imágenes compatibles (png, jpg, bmp, tif, webp)."); return; }
    lista.sort((a, b) => a.ruta.localeCompare(b.ruta, "es", { numeric: true }));
    const ids = idsSeleccion();
    const raiz = lista[0].ruta.includes("/") ? lista[0].ruta.split("/")[0] : "Archivos seleccionados";
    nuevaEvaluacion(raiz, ids);
    bloquear(true);
    try {
      for (let i = 0; i < lista.length; i += LOTE) {
        progreso(S.estado.listo ? `Evaluando con ${ids.map(nombreModelo).join(" y ")}` : "Esperando a que carguen los modelos", i, lista.length);
        const lote = lista.slice(i, i + LOTE);
        const fd = new FormData();
        fd.append("modelos", ids.join(","));
        lote.forEach((x) => { fd.append("archivos", x.file, x.file.name); fd.append("rutas", x.ruta); });
        const r = await fetch("/api/evaluar", { method: "POST", body: fd });
        if (!r.ok) throw new Error(await r.text());
        agregarRespuesta(await r.json(), lote.map((x) => ({ url: URL.createObjectURL(x.file) })));
      }
      progreso("Evaluación terminada", lista.length, lista.length);
      mostrarResultados();
    } catch (e) {
      avisar("Error durante la evaluación: " + e.message);
    } finally { bloquear(false); setTimeout(() => ($("#panel-progreso").hidden = true), 700); }
  }

  async function evaluarRuta(ruta) {
    avisar("");
    ruta = (ruta || "").trim();
    if (!ruta) { avisar("Escribe la ruta de una carpeta de este equipo."); return; }
    bloquear(true);
    try {
      const r = await fetch("/api/carpeta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ruta }) });
      const d = await r.json();
      if (!r.ok) { avisar(d.error || "No se pudo abrir la carpeta."); return; }
      const ids = idsSeleccion();
      nuevaEvaluacion(d.nombre, ids);
      for (let i = 0; i < d.total; i += LOTE) {
        progreso(S.estado.listo ? `Evaluando con ${ids.map(nombreModelo).join(" y ")}` : "Esperando a que carguen los modelos", i, d.total);
        const rr = await fetch("/api/evaluar_carpeta", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: d.token, modelos: ids.join(","), inicio: i, cantidad: LOTE }),
        });
        if (!rr.ok) throw new Error(await rr.text());
        agregarRespuesta(await rr.json());
      }
      progreso("Evaluación terminada", d.total, d.total);
      mostrarResultados();
    } catch (e) {
      avisar("Error durante la evaluación: " + e.message);
    } finally { bloquear(false); setTimeout(() => ($("#panel-progreso").hidden = true), 700); }
  }

  function bloquear(si) { ["#btn-carpeta", "#btn-ruta", "#btn-explorar"].forEach((s) => ($(s).disabled = si)); }

  /* ------------------------------------------------------------ resultados */
  function configurarResultados() {
    $("#umbral").addEventListener("input", (e) => { S.umbral = +e.target.value; $("#umbral-valor").textContent = S.umbral.toFixed(2); pintarResultados(); });
    $("#umbral-reset").addEventListener("click", () => {
      S.umbral = modelo(S.vistaRes || "resnet50").umbral; $("#umbral").value = S.umbral; $("#umbral-valor").textContent = S.umbral.toFixed(2); pintarResultados();
    });
    segmentado($("#filtro-galeria"), [
      { id: "todas", texto: "Todas" }, { id: "errores", texto: "Errores" }, { id: "correctas", texto: "Correctas" }, { id: "sin", texto: "Sin etiqueta" },
    ], S.filtro, (f) => { S.filtro = f; S.limite = 120; pintarGaleria(); });
    $("#orden-galeria").addEventListener("change", (e) => { S.orden = e.target.value; pintarGaleria(); });
    $("#btn-nueva").addEventListener("click", () => { $("#resultados").hidden = true; $("#panel-configurar").scrollIntoView({ behavior: "smooth" }); });
    $("#btn-csv").addEventListener("click", exportarCSV);
    $$("#etiquetado-masivo [data-masivo]").forEach((b) => b.addEventListener("click", () => {
      const v = b.dataset.masivo;
      S.eval.items.forEach((i) => {
        if (!i.valida || i.real != null) return;
        i.real = v === "pred" ? (i.prob[S.vistaRes] > S.umbral ? 1 : 0) : +v;
      });
      pintarResultados();
    }));
    $("#galeria").addEventListener("click", (e) => {
      const chip = e.target.closest("[data-chip]");
      if (chip) {
        const it = S.eval.items[+chip.dataset.chip];
        it.real = it.real === 1 ? 0 : it.real === 0 ? null : 1;
        pintarResultados();
        return;
      }
      if (e.target.closest("[data-mas]")) { S.limite += 240; pintarGaleria(); }
    });
  }

  function mostrarResultados() {
    $("#resultados").hidden = false;
    const ids = S.eval.modelos;
    $("#res-selector").hidden = ids.length < 2;
    if (ids.length > 1) segmentado($("#res-selector"), ids.map((i) => ({ id: i, texto: nombreModelo(i) })), S.vistaRes, (id) => { S.vistaRes = id; pintarResultados(); });
    S.umbral = modelo(S.vistaRes).umbral; $("#umbral").value = S.umbral; $("#umbral-valor").textContent = S.umbral.toFixed(2);
    pintarResultados();
    setTimeout(() => $("#resultados").scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  function pintarResultados() {
    if (!S.eval) return;
    const id = S.vistaRes, it = S.eval.items;
    const r = calcular(it, id, S.umbral);
    const sinEt = it.filter((i) => i.valida && i.real == null).length;
    const invalidas = it.filter((i) => !i.valida).length;
    const ajustadas = it.filter((i) => i.ajustada).length;
    $("#res-carpeta").textContent = `${S.eval.carpeta} · ${miles(r.n)} imágenes · ${nombreModelo(id)}`;

    // hero
    const hero = $("#res-hero");
    if (r.nEt) {
      const ok = r.accuracy > meta() || Math.abs(r.accuracy - meta()) < 1e-9;
      const penal = r.accuracy < meta() ? (((meta() - r.accuracy) * 100) / 2) * 0.5 : 0;
      hero.innerHTML = `
        <div>
          <div class="hero-etiqueta">Accuracy en vivo · ${esc(nombreModelo(id))}</div>
          <div class="hero-valor">${pct(r.accuracy)}<small>%</small></div>
          <div class="hero-sub">${miles(r.tp + r.tn)} de ${miles(r.nEt)} imágenes etiquetadas clasificadas correctamente</div>
        </div>
        <div>
          <div class="barra-meta" aria-hidden="true"><span style="width:${Math.max(0, (r.accuracy - 0.5) / 0.5) * 100}%"></span><i style="left:${((meta() - 0.5) / 0.5) * 100}%"></i></div>
          <div class="barra-meta-leyenda"><span>50 %</span><span>meta ${pct(meta(), 0)} %</span><span>100 %</span></div>
        </div>
        <span class="meta ${ok ? "bien" : "mal"}">${ok ? ICONO_OK : ICONO_MAL}${ok ? `Meta cumplida: accuracy ≥ ${pct(meta(), 0)} %` : `Por debajo de la meta · penalización estimada −${penal.toFixed(2)}`}</span>`;
    } else {
      hero.innerHTML = `
        <div>
          <div class="hero-etiqueta">Predicciones · ${esc(nombreModelo(id))}</div>
          <div class="hero-valor">${miles(r.predBarco)}<small> barcos</small></div>
          <div class="hero-sub">${miles(r.n - r.predBarco)} imágenes clasificadas como no barco</div>
        </div>
        <span class="meta neutro">${ICONO_INFO}Sin etiquetas reales: etiqueta las imágenes para calcular métricas</span>`;
    }

    // KPIs
    const msImg = S.eval.nInferidas ? S.eval.tiempos[id] / S.eval.nInferidas : null;
    const kpis = [
      ["Precisión", r.precision, "de lo marcado como barco, cuánto lo era"],
      ["Recall (sensibilidad)", r.recall, `barcos detectados: ${r.tp} de ${r.pos}`],
      ["F1-score", r.f1, "equilibrio precisión / recall"],
      ["Especificidad", r.especificidad, `no barcos bien descartados: ${r.tn} de ${r.neg}`],
      ["AUC ROC", r.auc, "capacidad de separar las clases", true],
    ];
    $("#res-kpis").innerHTML = kpis.map(([t, v, n, crudo]) => `
      <div class="kpi"><div class="kpi-etiqueta">${t}</div>
      <div class="kpi-valor">${v == null ? "—" : crudo ? num(v, 3) : pct(v)}${v != null && !crudo ? "<small>%</small>" : ""}</div>
      <div class="kpi-nota">${n}</div></div>`).join("") + `
      <div class="kpi"><div class="kpi-etiqueta">Tiempo por imagen</div>
      <div class="kpi-valor">${msImg == null ? "—" : msImg.toFixed(1)}<small>ms</small></div>
      <div class="kpi-nota">inferencia en este equipo${ajustadas ? ` · ${ajustadas} ajustadas a 80×80` : ""}</div></div>`;

    // matriz, ROC, histograma
    if (r.nEt) G.matriz($("#res-matriz"), { tn: r.tn, fp: r.fp, fn: r.fn, tp: r.tp });
    else $("#res-matriz").innerHTML = '<p class="nota">Sin imágenes etiquetadas.</p>';
    if (r.roc.length) { G.roc($("#res-roc"), [{ nombre: nombreModelo(id), color: COLOR[id], puntos: r.roc, auc: r.auc }]); $("#res-auc-nota").textContent = "Sensibilidad frente a tasa de falsos positivos."; }
    else { $("#res-roc").innerHTML = ""; $("#res-auc-nota").textContent = "Se necesita al menos una imagen etiquetada de cada clase."; }
    const filas = [{ nombre: "Barcos", color: COLOR.resnet50, conteos: r.hist.barcos }, { nombre: "No barcos", color: COLOR.cnn, conteos: r.hist.noBarcos }];
    if (sinEt) filas.push({ nombre: "Sin etiqueta", color: "#aeaeb2", conteos: r.hist.sinEt });
    G.histograma($("#res-hist"), { bordes: r.hist.bordes, filas, umbral: S.umbral });

    // etiquetado masivo
    $("#etiquetado-masivo").hidden = !sinEt;
    $("#etiquetado-texto").textContent = `${sinEt} imagen${sinEt === 1 ? "" : "es"} sin etiqueta real`;
    $("#galeria-resumen").textContent = `${miles(r.n)} imágenes · ${miles(it.filter((i) => i.real === 1).length)} barcos · ${miles(it.filter((i) => i.real === 0).length)} no barcos · ${miles(sinEt)} sin etiqueta`
      + (invalidas ? ` · ${invalidas} no se pudieron leer` : "") + (r.nEt ? ` · ${r.fp + r.fn} errores` : "");
    pintarGaleria();
  }

  function pintarGaleria() {
    const id = S.vistaRes, u = S.umbral;
    let lista = S.eval.items.filter((i) => i.valida);
    const pred = (i) => (i.prob[id] > u ? 1 : 0);
    if (S.filtro === "errores") lista = lista.filter((i) => i.real != null && pred(i) !== i.real);
    if (S.filtro === "correctas") lista = lista.filter((i) => i.real != null && pred(i) === i.real);
    if (S.filtro === "sin") lista = lista.filter((i) => i.real == null);
    const cmp = {
      nombre: (a, b) => a.ruta.localeCompare(b.ruta, "es", { numeric: true }),
      duda: (a, b) => Math.abs(a.prob[id] - u) - Math.abs(b.prob[id] - u),
      "prob-desc": (a, b) => b.prob[id] - a.prob[id],
      "prob-asc": (a, b) => a.prob[id] - b.prob[id],
    }[S.orden];
    lista = lista.slice().sort(cmp);
    const total = lista.length;
    lista = lista.slice(0, S.limite);
    const otros = S.eval.modelos.filter((m) => m !== id);
    $("#galeria").innerHTML = !total ? '<div class="galeria-vacia">No hay imágenes en este filtro.</div>' : lista.map((i) => {
      const p = i.prob[id], pr = pred(i);
      const ok = i.real == null ? null : pr === i.real;
      const realTxt = i.real === 1 ? "Barco" : i.real === 0 ? "No barco" : "Sin etiqueta";
      const extra = otros.map((o) => `${esc(nombreModelo(o))}: ${pct(i.prob[o])} %`).join(" · ");
      return `<article class="foto${ok === false ? " error" : ""}">
        <img src="${esc(i.url)}" alt="${esc(i.nombre)}" loading="lazy">
        <div class="foto-cuerpo">
          <div class="foto-nombre" title="${esc(i.ruta)}">${esc(i.nombre)}</div>
          <div class="foto-pred">${pr ? "Barco" : "No barco"}<span>${pct(p)} %</span></div>
          <div class="prob" title="P(barco)"><span style="width:${(p * 100).toFixed(1)}%"></span></div>
          ${extra ? `<div class="foto-nombre">${extra}</div>` : ""}
          <div class="foto-pie">
            <button class="chip${i.real == null ? " vacio" : ""}" data-chip="${i.idx}" type="button" title="Etiqueta real (clic para cambiar)">Real: ${realTxt}</button>
            ${ok == null ? "" : `<span class="marca-estado ${ok ? "bien" : "mal"}">${ok ? ICONO_OK + "Acierto" : ICONO_MAL + "Error"}</span>`}
          </div>
        </div></article>`;
    }).join("") + (total > S.limite ? `<div class="mas"><button class="boton" data-mas type="button">Mostrar más (${miles(total - S.limite)} restantes)</button></div>` : "");
  }

  function exportarCSV() {
    const ids = S.eval.modelos;
    const cab = ["archivo", "ruta", "etiqueta_real"].concat(...ids.map((i) => [`prob_barco_${i}`, `prediccion_${i}`, `correcto_${i}`]));
    const filas = S.eval.items.filter((i) => i.valida).map((i) => {
      const f = [i.nombre, i.ruta, i.real == null ? "" : i.real === 1 ? "Barco" : "No barco"];
      ids.forEach((id) => {
        const pr = i.prob[id] > S.umbral ? 1 : 0;
        f.push(i.prob[id].toFixed(6), pr ? "Barco" : "No barco", i.real == null ? "" : pr === i.real ? "si" : "no");
      });
      return f;
    });
    const csv = [cab].concat(filas).map((f) => f.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `resultados_${S.eval.carpeta}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  /* ------------------------------------------------------------ ficha del modelo */
  function pintarFicha() {
    const id = S.ficha, m = modelo(id), info = S.info[id];
    const cont = $("#ficha");
    if (!info) { cont.innerHTML = `<div class="tarjeta">No se encontró info_modelos/${id}.json. Ejecuta tools/generar_info_modelos.py.</div>`; return; }
    const arq = info.arquitectura, cj = info.conjuntos, ds = S.catalogo.dataset;
    const capasTotales = arq.subred ? `${arq.capas.length} capas (ResNet50 interna: ${arq.subred.capas_totales})` : `${arq.capas.length} capas`;

    cont.innerHTML = `
      <div class="tarjeta ficha-cab">
        <div>
          <span class="etiqueta-tipo">${esc(m.tipo)}</span>
          <h2>${esc(m.nombre_largo)}</h2>
          <p class="ficha-desc">${esc(m.descripcion)}</p>
        </div>
        <div class="datos">
          <div class="dato"><span>Parámetros totales</span><b>${miles(arq.total)}</b></div>
          <div class="dato"><span>Parámetros entrenados</span><b>${miles(arq.entrenables)}</b></div>
          <div class="dato"><span>Accuracy en test</span><b>${pct(cj.test.accuracy)} %</b></div>
          <div class="dato"><span>AUC en test</span><b>${num(cj.test.auc, 4)}</b></div>
          <div class="dato"><span>Épocas (mejor)</span><b>${info.epocas_entrenadas || "—"} (${info.mejor_epoca || "—"})</b></div>
          <div class="dato"><span>Tamaño del archivo</span><b>${info.tamano_mb} MB</b></div>
        </div>
      </div>

      <div class="seccion">
        <div class="seccion-cab"><h2>Arquitectura</h2>
          <p>Recorrido de una imagen de 80×80 px por la red. Cada bloque representa el mapa de características que sale de esa etapa: su altura es proporcional al tamaño espacial y su grosor al número de canales. ${capasTotales}.</p></div>
        <div class="tarjeta">
          <div class="diagrama" id="diagrama-${id}"></div>
          <div class="leyenda-arq">
            <span><i style="background:#d6e6fa;border:1px solid #2a78d6"></i>Capas que se entrenaron</span>
            ${arq.subred ? '<span><i style="background:#e5e5ea;border:1px solid #aeaeb2"></i>Capas congeladas (pesos ImageNet)</span>' : ""}
            <span><i style="background:#fbfbfd;border:1px dashed #d2d2d7"></i>Operación sin pesos o solo en entrenamiento</span>
          </div>
        </div>
        <div class="rejilla-2">
          <div class="tarjeta">
            <h3>${arq.subred ? "Bloque residual (cuello de botella)" : "Dentro de cada bloque convolucional"}</h3>
            <div class="explicacion" style="grid-template-columns:1fr">
              <div id="explica-${id}"></div>
              <div>${arq.subred ? `
                <p><strong>ResNet50</strong> apila 16 bloques como este en cuatro etapas (3, 4, 6 y 3 bloques). El <strong>atajo</strong> suma la entrada del bloque a su salida, lo que permite entrenar redes muy profundas sin que el gradiente se desvanezca.</p>
                <p>Las etapas conv1 a conv4 quedaron congeladas con los pesos de ImageNet. Se descongelaron las últimas 30 capas, todas dentro de conv5: ${arq.subred.capas_con_pesos_entrenables} convoluciones se reentrenaron (desde <code>${esc(arq.subred.primera_capa_entrenable || "")}</code>) y sus BatchNorm se mantuvieron fijas. Así se adaptan los filtros más abstractos a barcos vistos desde arriba.</p>`
                : `
                <p>Cada bloque aplica <strong>dos convoluciones 3×3</strong> seguidas: la primera detecta patrones simples y la segunda los combina. <strong>BatchNorm</strong> estabiliza el entrenamiento y <strong>ReLU</strong> introduce la no linealidad.</p>
                <p>Al final, <strong>MaxPool 2×2</strong> reduce el mapa a la mitad. Tras cuatro bloques la imagen pasa de 80×80×3 a 5×5×256: menos resolución espacial pero muchos más canales que describen el contenido.</p>`}
              </div>
            </div>
          </div>
          <div class="tarjeta">
            <h3>¿Dónde están los parámetros?</h3>
            <p class="nota">Parámetros por etapa. ${arq.subred ? "Gris: congelados; azul: reentrenados." : "Todos se entrenaron desde cero."}</p>
            <div id="params-${id}" class="grafica"></div>
          </div>
        </div>
        <div class="tarjeta">
          <details class="salida">
            <summary>Ver todas las capas (${arq.capas.length})<small>nombre · tipo · forma de salida · parámetros</small></summary>
            <div class="tabla-wrap"><table class="tabla">
              <thead><tr><th>#</th><th>Capa</th><th>Tipo</th><th>Forma de salida</th><th class="num">Parámetros</th><th class="num">Entrenables</th></tr></thead>
              <tbody>${arq.capas.map((c, k) => `<tr><td class="num">${k + 1}</td><td class="mono">${esc(c.nombre)}</td><td>${esc(c.tipo)}</td>
                <td class="mono">(${c.salida.map((d) => (d == null ? "None" : d)).join(", ")})</td><td class="num">${miles(c.parametros)}</td><td class="num">${miles(c.entrenables)}</td></tr>`).join("")}
                <tr class="grupo"><td></td><td colspan="3">Total</td><td class="num">${miles(arq.total)}</td><td class="num">${miles(arq.entrenables)}</td></tr>
              </tbody></table></div>
            ${arq.subred ? `<h3 style="margin:22px 0 8px">Etapas internas de ResNet50</h3>
            <div class="tabla-wrap"><table class="tabla">
              <thead><tr><th>Etapa</th><th class="num">Bloques</th><th class="num">Capas</th><th class="num">Convoluciones</th><th>Salida</th><th class="num">Parámetros</th><th>Estado</th></tr></thead>
              <tbody>${arq.subred.etapas.map((e) => `<tr><td class="mono">${esc(e.nombre)}</td><td class="num">${e.bloques || "—"}</td><td class="num">${e.capas}</td><td class="num">${e.conv}</td>
                <td class="mono">${e.salida.slice(1).join(" × ")}</td><td class="num">${miles(e.parametros)}</td>
                <td>${e.parametros === 0 ? "—" : `<span class="estado-capa"><i style="background:${e.entrenables ? "#2a78d6" : "#c7c7cc"}"></i>${e.entrenables ? (e.entrenables < e.parametros ? "Reentrenada (parcial)" : "Reentrenada") : "Congelada"}</span>`}</td></tr>`).join("")}
              </tbody></table></div>` : ""}
          </details>
        </div>
      </div>

      <div class="seccion">
        <div class="seccion-cab"><h2>Datos y división</h2><p>${esc(ds.formato)}. ${esc(ds.balanceo)} ${esc(ds.metodo_split)}</p></div>
        <div class="tarjeta">
          ${splitHTML(ds)}
          <p class="nota" style="margin:14px 0 0">Dataset original: ${miles(ds.original.Barcos)} barcos y ${miles(ds.original.No_Barcos)} no barcos (<a href="${esc(ds.url)}" target="_blank" rel="noopener">${esc(ds.nombre)}</a>). ${esc(ds.nota_train || "")}</p>
        </div>
      </div>

      <div class="seccion">
        <div class="seccion-cab"><h2>Preprocesamiento e hiperparámetros</h2><p>Los mismos pasos se aplican en el entrenamiento, en la evaluación y en esta interfaz.</p></div>
        <div class="rejilla-2">
          <div class="tarjeta">
            <h3>Preprocesamiento</h3>
            <ol class="lista" style="margin-top:8px">${m.preprocesamiento.map((p) => `<li>${esc(p)}</li>`).join("")}</ol>
            <h3 style="margin-top:22px">Decisiones de diseño</h3>
            <ol class="lista" style="margin-top:8px">${m.decisiones.map((p) => `<li>${esc(p)}</li>`).join("")}</ol>
          </div>
          <div class="tarjeta">
            <h3>Hiperparámetros</h3>
            <div class="tabla-wrap"><table class="tabla" style="margin-top:8px"><tbody>
              ${m.hiperparametros.map(([k, v]) => `<tr><td style="color:var(--texto-2);white-space:nowrap">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}
            </tbody></table></div>
          </div>
        </div>
      </div>

      <div class="seccion">
        <div class="seccion-cab"><h2>Entrenamiento</h2>
          <p>${info.epocas_entrenadas} épocas entrenadas. El early stopping restauró los pesos de la época ${info.mejor_epoca}, la de menor pérdida en validación (línea punteada).</p></div>
        <div class="rejilla-2">
          <div class="tarjeta"><h3>Pérdida (binary cross-entropy)</h3><p class="nota">Train frente a validación por época.</p><div id="g-loss-${id}" class="grafica"></div></div>
          <div class="tarjeta"><h3>Accuracy</h3><p class="nota">Train frente a validación por época.</p><div id="g-acc-${id}" class="grafica"></div></div>
        </div>
        <div class="tarjeta"><h3>Learning rate</h3><p class="nota">ReduceLROnPlateau lo reduce a la mitad cuando la validación se estanca.</p><div id="g-lr-${id}" class="grafica"></div></div>
      </div>

      <div class="seccion">
        <div class="seccion-cab"><h2>Resultados en train, validación y test</h2><p>Recalculados con el modelo guardado y el mismo preprocesamiento; coinciden con las salidas del notebook en Colab.</p></div>
        <div class="tarjeta">
          <div class="tabla-wrap"><table class="tabla">
            <thead><tr><th>Conjunto</th><th class="num">Imágenes</th><th class="num">Loss</th><th class="num">Accuracy</th><th class="num">Precisión</th><th class="num">Recall</th><th class="num">F1</th><th class="num">Especificidad</th><th class="num">AUC</th><th class="num">FP</th><th class="num">FN</th></tr></thead>
            <tbody>${[["Train", cj.train], ["Validación", cj.val], ["Test", cj.test]].concat(info.externa ? [["Externa (" + info.externa.carpeta + ")", info.externa]] : []).map(([n, r]) => `
              <tr><td>${esc(n)}</td><td class="num">${miles(r.n)}</td><td class="num">${num(r.loss)}</td><td class="num">${pct(r.accuracy, 2)} %</td><td class="num">${pct(r.precision, 2)} %</td>
              <td class="num">${pct(r.recall, 2)} %</td><td class="num">${pct(r.f1, 2)} %</td><td class="num">${pct(r.especificidad, 2)} %</td><td class="num">${num(r.auc)}</td><td class="num">${r.cm.fp}</td><td class="num">${r.cm.fn}</td></tr>`).join("")}
            </tbody></table></div>
          <div class="analisis">
            <div><span>Diferencia train − validación</span><b>${pct(Math.abs(cj.train.accuracy - cj.val.accuracy), 2)} %</b></div>
            <div><span>Diferencia validación − test</span><b>${pct(Math.abs(cj.val.accuracy - cj.test.accuracy), 2)} %</b></div>
            <div><span>Diferencia train − test</span><b>${pct(Math.abs(cj.train.accuracy - cj.test.accuracy), 2)} %</b></div>
          </div>
          <p class="nota" style="margin:12px 0 0">${generalizacion(cj)}</p>
        </div>
        <div class="rejilla-3">
          <div class="tarjeta" id="cm-train-${id}"></div>
          <div class="tarjeta" id="cm-val-${id}"></div>
          <div class="tarjeta" id="cm-test-${id}"></div>
        </div>
        <div class="rejilla-2">
          <div class="tarjeta"><h3>Curva ROC en test</h3><p class="nota">${miles(cj.test.n)} imágenes nunca vistas en el entrenamiento.</p><div id="roc-${id}" class="grafica"></div></div>
          <div class="tarjeta"><h3>Distribución de probabilidades en test</h3><p class="nota">P(barco) por clase real. La línea marca el umbral ${m.umbral}.</p><div id="hist-${id}" class="grafica"></div>
            ${cj.test.errores.length ? `<h3 style="margin-top:18px">Errores en test</h3><div class="tabla-wrap"><table class="tabla"><thead><tr><th>Archivo</th><th>Real</th><th class="num">P(barco)</th></tr></thead><tbody>
              ${cj.test.errores.map((e) => `<tr><td class="mono" style="word-break:break-all">${esc(e.archivo)}</td><td>${e.real ? "Barco" : "No barco"}</td><td class="num">${e.prob.toFixed(4)}</td></tr>`).join("")}</tbody></table></div>` : ""}
          </div>
        </div>
      </div>

      ${info.externa ? `
      <div class="seccion">
        <div class="seccion-cab"><h2>Prueba con imágenes externas</h2><p>${miles(info.externa.n)} imágenes de la carpeta <code>${esc(info.externa.carpeta)}</code> que no forman parte del dataset de entrenamiento.</p></div>
        <div class="rejilla-2">
          <div class="tarjeta" id="cm-ext-${id}"></div>
          <div class="tarjeta">
            <h3>Resumen</h3>
            <div class="datos" style="margin-top:10px">
              <div class="dato"><span>Accuracy</span><b>${pct(info.externa.accuracy)} %</b></div>
              <div class="dato"><span>F1</span><b>${pct(info.externa.f1)} %</b></div>
              <div class="dato"><span>Precisión</span><b>${pct(info.externa.precision)} %</b></div>
              <div class="dato"><span>Recall</span><b>${pct(info.externa.recall)} %</b></div>
            </div>
            ${info.externa.errores.length ? `<p class="nota" style="margin:14px 0 6px">Imágenes mal clasificadas:</p><div class="tabla-wrap"><table class="tabla"><tbody>
              ${info.externa.errores.map((e) => `<tr><td class="mono">${esc(e.archivo)}</td><td>Real: ${e.real ? "Barco" : "No barco"}</td><td class="num">P(barco) ${e.prob.toFixed(4)}</td></tr>`).join("")}</tbody></table></div>` : ""}
          </div>
        </div>
      </div>` : ""}

      <div class="seccion">
        <div class="seccion-cab"><h2>Salidas del notebook en Colab</h2><p>Lo que imprimió cada celda de <code>${esc(m.notebook)}</code> al entrenar, con sus gráficas originales.</p></div>
        <div class="tarjeta">${notebookHTML(info.notebook || [])}</div>
      </div>`;

    ARQ.diagrama($(`#diagrama-${id}`), id, arq);
    if (arq.subred) ARQ.bloqueResidual($(`#explica-${id}`)); else ARQ.bloqueCNN($(`#explica-${id}`));
    ARQ.distribucionParametros($(`#params-${id}`), id, arq);
    pintarCurvas(id, info);
    G.matriz($(`#cm-train-${id}`), cj.train.cm, { titulo: `Train · ${miles(cj.train.n)} imágenes`, mini: true });
    G.matriz($(`#cm-val-${id}`), cj.val.cm, { titulo: `Validación · ${miles(cj.val.n)} imágenes`, mini: true });
    G.matriz($(`#cm-test-${id}`), cj.test.cm, { titulo: `Test · ${miles(cj.test.n)} imágenes`, mini: true });
    if (info.externa) G.matriz($(`#cm-ext-${id}`), info.externa.cm, { titulo: `Externa · ${miles(info.externa.n)} imágenes` });
    G.roc($(`#roc-${id}`), [{ nombre: m.nombre, color: COLOR[id], puntos: cj.test.roc, auc: cj.test.auc }]);
    G.histograma($(`#hist-${id}`), { bordes: cj.test.histograma.bordes, umbral: m.umbral, filas: [
      { nombre: "Barcos", color: COLOR.resnet50, conteos: cj.test.histograma.barcos },
      { nombre: "No barcos", color: COLOR.cnn, conteos: cj.test.histograma.no_barcos }] });
  }

  function generalizacion(cj) {
    const d = Math.abs(cj.val.accuracy - cj.test.accuracy);
    const t = Math.abs(cj.train.accuracy - cj.test.accuracy);
    let s = d < 0.03 ? "Validación y test difieren menos de 3 %: el modelo generaliza de forma consistente." : d < 0.05 ? "Validación y test difieren menos de 5 %: generalización aceptable." : "Validación y test difieren más de 5 %: posible sobreajuste o conjuntos poco representativos.";
    if (t > 0.03) s += " La brecha entre train y test supera el 3 %, señal de cierto sobreajuste.";
    return s;
  }

  function splitHTML(ds) {
    const c = ["train", "val", "test"].map((k) => ({ k, n: ds.split[k].Barcos + ds.split[k].No_Barcos, b: ds.split[k].Barcos, nb: ds.split[k].No_Barcos }));
    const tot = c.reduce((a, x) => a + x.n, 0);
    const nombres = { train: "Entrenamiento", val: "Validación", test: "Test" };
    const colores = { train: "#1c5cab", val: "#2a78d6", test: "#86b6ef" };
    return `<div class="split" role="img" aria-label="División del dataset">${c.map((x) => `<div style="flex:${x.n};background:${colores[x.k]};${x.k === "test" ? "color:#0d366b" : ""}" title="${nombres[x.k]}: ${x.n}">${(100 * x.n / tot).toFixed(0)} %</div>`).join("")}</div>
      <div class="split-leyenda">${c.map((x) => `<div><span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${colores[x.k]};margin-right:6px"></i>${nombres[x.k]}</span><b>${miles(x.n)}</b><span>${miles(x.b)} barcos · ${miles(x.nb)} no barcos</span></div>`).join("")}</div>`;
  }

  function notebookHTML(celdas) {
    const vistos = new Set();
    return celdas.filter((c) => { const k = c.titulo + c.texto; if (vistos.has(k)) return false; vistos.add(k); return true; }).map((c, k) => `
      <details class="salida"${k === 0 ? "" : ""}>
        <summary>${esc(c.titulo)}<small>${c.figuras.length ? c.figuras.length + " gráfica" + (c.figuras.length > 1 ? "s" : "") : ""}${c.figuras.length && c.texto ? " · " : ""}${c.texto ? (c.texto.split("\n").length === 1 ? "1 línea" : c.texto.split("\n").length + " líneas") : ""}</small></summary>
        ${c.texto ? `<pre class="consola">${esc(c.texto)}</pre>` : ""}
        ${c.figuras.length ? `<div class="figuras">${c.figuras.map((f) => `<img src="${esc(f)}" alt="Gráfica: ${esc(c.titulo)}" loading="lazy">`).join("")}</div>` : ""}
      </details>`).join("");
  }

  function pintarCurvas(id, info) {
    const h = info.historial || [];
    if (!h.length) return;
    const xs = h.map((e) => e.epoca);
    const marcas = info.mejor_epoca ? [{ x: info.mejor_epoca, texto: `mejor época (${info.mejor_epoca})` }] : [];
    G.lineas($(`#g-loss-${id}`), {
      xs, etiquetaX: "Época", tituloX: "Época", marcas, yMin: 0,
      series: [{ nombre: "Train", color: COLOR.resnet50, valores: h.map((e) => e.loss) }, { nombre: "Validación", color: COLOR.cnn, valores: h.map((e) => e.val_loss) }],
      formatoY: (v) => v.toFixed(2), formatoTooltip: (v) => v.toFixed(4),
    });
    const accMin = Math.min(...h.map((e) => Math.min(e.accuracy, e.val_accuracy)));
    G.lineas($(`#g-acc-${id}`), {
      xs, etiquetaX: "Época", tituloX: "Época", marcas, marcaAbajo: true, yMin: Math.floor(accMin * 20) / 20, yMax: 1,
      series: [{ nombre: "Train", color: COLOR.resnet50, valores: h.map((e) => e.accuracy) }, { nombre: "Validación", color: COLOR.cnn, valores: h.map((e) => e.val_accuracy) }],
      formatoY: (v) => (v * 100).toFixed(0) + " %", formatoTooltip: (v) => (v * 100).toFixed(2) + " %",
    });
    G.lineas($(`#g-lr-${id}`), {
      xs, etiquetaX: "Época", tituloX: "Época", alto: 170, yMin: 0,
      series: [{ nombre: "Learning rate", color: COLOR.resnet50, valores: h.map((e) => e.learning_rate) }],
      formatoY: (v) => (v === 0 ? "0" : v.toExponential(0)), formatoTooltip: (v) => v.toExponential(2),
    });
  }

  /* ------------------------------------------------------------ comparación */
  function pintarComparacion() {
    const ids = S.catalogo.modelos.map((m) => m.id);
    if (!ids.every((i) => S.info[i])) { $("#comparacion").innerHTML = '<div class="tarjeta">Falta la información de algún modelo.</div>'; return; }
    const [a, b] = ids;
    const I = S.info;
    const filasMet = [["Accuracy", "accuracy"], ["Precisión", "precision"], ["Recall", "recall"], ["F1", "f1"], ["Especificidad", "especificidad"], ["AUC", "auc"]];

    const vivo = S.eval && S.eval.modelos.length > 1 ? ids.map((i) => calcular(S.eval.items, i, S.umbral)) : null;
    const tarjetaModelo = (id, clase) => {
      const m = modelo(id), inf = I[id];
      return `<div class="tarjeta ${clase}">
        <span class="etiqueta-tipo" style="color:${COLOR[id]};background:${id === "cnn" ? "#fdf0ea" : "#e8f2fd"}">${esc(m.tipo)}</span>
        <h2 style="font-size:24px">${esc(m.nombre)}</h2>
        <div class="datos" style="margin-top:14px">
          <div class="dato"><span>Accuracy en test</span><b>${pct(inf.conjuntos.test.accuracy)} %</b></div>
          <div class="dato"><span>Accuracy externa</span><b>${inf.externa ? pct(inf.externa.accuracy) + " %" : "—"}</b></div>
          <div class="dato"><span>Parámetros</span><b>${ARQ.fmtParam(inf.arquitectura.total)}</b></div>
          <div class="dato"><span>Tamaño</span><b>${inf.tamano_mb} MB</b></div>
        </div></div>`;
    };

    const mejor = (va, vb, menor) => (va == null || vb == null || va === vb ? [false, false] : menor ? [va < vb, vb < va] : [va > vb, vb > va]);
    const fila = (titulo, va, vb, f, menor) => {
      const [ma, mb] = mejor(va, vb, menor);
      return `<tr><td>${titulo}</td><td class="num${ma ? " mejor" : ""}">${f(va)}</td><td class="num${mb ? " mejor" : ""}">${f(vb)}</td></tr>`;
    };
    const P = (v) => (v == null ? "—" : pct(v, 2) + " %");
    const tiempo = (id) => S.eval && S.eval.nInferidas && S.eval.modelos.includes(id) ? S.eval.tiempos[id] / S.eval.nInferidas : I[id].conjuntos.test.ms_por_imagen;

    let html = `<div class="versus">${tarjetaModelo(a, "")}${tarjetaModelo(b, "b")}</div>`;

    if (vivo) {
      const [ra, rb] = vivo;
      const concuerdan = S.eval.items.filter((i) => i.valida && (i.prob[a] > S.umbral) === (i.prob[b] > S.umbral)).length;
      const nVal = S.eval.items.filter((i) => i.valida).length;
      html += `<div class="seccion" style="margin-top:8px"><div class="seccion-cab"><h2>Evaluación en vivo</h2><p>Carpeta <code>${esc(S.eval.carpeta)}</code> · ${miles(nVal)} imágenes · umbral ${S.umbral.toFixed(2)}. Los dos modelos coinciden en ${miles(concuerdan)} de ${miles(nVal)} predicciones (${pct(concuerdan / nVal)} %).</p></div>
        <div class="rejilla-2">
          <div class="tarjeta"><h3>Métricas en vivo</h3><p class="nota">Cuanto más a la derecha, mejor.</p><div id="comp-vivo" class="grafica"></div></div>
          <div class="tarjeta"><h3>Detalle</h3><div class="tabla-wrap"><table class="tabla"><thead><tr><th></th><th class="num">${esc(nombreModelo(a))}</th><th class="num">${esc(nombreModelo(b))}</th></tr></thead><tbody>
            ${filasMet.map(([t, k]) => fila(t, ra[k], rb[k], k === "auc" ? (v) => num(v, 4) : P)).join("")}
            ${fila("Falsos positivos", ra.nEt ? ra.fp : null, rb.nEt ? rb.fp : null, (v) => (v == null ? "—" : v), true)}
            ${fila("Falsos negativos", ra.nEt ? ra.fn : null, rb.nEt ? rb.fn : null, (v) => (v == null ? "—" : v), true)}
            ${fila("Tiempo por imagen", tiempo(a), tiempo(b), (v) => (v == null ? "—" : v.toFixed(1) + " ms"), true)}
          </tbody></table></div></div>
        </div></div>`;
    } else {
      html += `<div class="tarjeta vacio-comp">Para comparar los dos modelos en vivo, elige <strong>Ambos</strong> en la pestaña Evaluación en vivo y carga una carpeta. Mientras tanto se muestran los resultados del entrenamiento.</div>`;
    }

    html += `<div class="seccion"><div class="seccion-cab"><h2>Resultados del entrenamiento</h2><p>Métricas sobre el conjunto de test (200 imágenes) y sobre las imágenes externas, con umbral 0.5.</p></div>
      <div class="rejilla-2">
        <div class="tarjeta"><h3>Test</h3><p class="nota">Cuanto más a la derecha, mejor.</p><div id="comp-test" class="grafica"></div></div>
        <div class="tarjeta"><h3>Imágenes externas</h3><p class="nota">Cuanto más a la derecha, mejor.</p><div id="comp-ext" class="grafica"></div></div>
      </div>
      <div class="tarjeta"><h3>Tabla comparativa</h3><p class="nota">En negrita, el mejor valor de cada fila.</p><div class="tabla-wrap"><table class="tabla">
        <thead><tr><th></th><th class="num">${esc(nombreModelo(a))}</th><th class="num">${esc(nombreModelo(b))}</th></tr></thead><tbody>
        <tr class="grupo"><td colspan="3">Modelo</td></tr>
        <tr><td>Tipo</td><td class="num">${esc(modelo(a).tipo)}</td><td class="num">${esc(modelo(b).tipo)}</td></tr>
        ${fila("Parámetros totales", I[a].arquitectura.total, I[b].arquitectura.total, miles, true)}
        ${fila("Parámetros entrenados", I[a].arquitectura.entrenables, I[b].arquitectura.entrenables, miles, true)}
        ${fila("Tamaño del archivo", I[a].tamano_mb, I[b].tamano_mb, (v) => v + " MB", true)}
        ${fila("Tiempo por imagen", tiempo(a), tiempo(b), (v) => v.toFixed(1) + " ms", true)}
        ${fila("Épocas entrenadas", I[a].epocas_entrenadas, I[b].epocas_entrenadas, (v) => v, true)}
        ${["train", "val", "test"].map((s) => `<tr class="grupo"><td colspan="3">${{ train: "Train", val: "Validación", test: "Test" }[s]}</td></tr>
          ${fila("Accuracy", I[a].conjuntos[s].accuracy, I[b].conjuntos[s].accuracy, P)}
          ${fila("F1", I[a].conjuntos[s].f1, I[b].conjuntos[s].f1, P)}
          ${fila("Loss", I[a].conjuntos[s].loss, I[b].conjuntos[s].loss, (v) => num(v), true)}
          ${s === "test" ? fila("AUC", I[a].conjuntos[s].auc, I[b].conjuntos[s].auc, (v) => num(v)) + fila("Falsos positivos", I[a].conjuntos[s].cm.fp, I[b].conjuntos[s].cm.fp, (v) => v, true) + fila("Falsos negativos", I[a].conjuntos[s].cm.fn, I[b].conjuntos[s].cm.fn, (v) => v, true) : ""}`).join("")}
        ${I[a].externa && I[b].externa ? `<tr class="grupo"><td colspan="3">Imágenes externas (${miles(I[a].externa.n)})</td></tr>
          ${fila("Accuracy", I[a].externa.accuracy, I[b].externa.accuracy, P)}
          ${fila("F1", I[a].externa.f1, I[b].externa.f1, P)}
          ${fila("AUC", I[a].externa.auc, I[b].externa.auc, (v) => num(v))}
          ${fila("Errores", I[a].externa.cm.fp + I[a].externa.cm.fn, I[b].externa.cm.fp + I[b].externa.cm.fn, (v) => v, true)}` : ""}
        </tbody></table></div></div>
      <div class="rejilla-2">
        <div class="tarjeta"><h3>Pérdida en validación</h3><p class="nota">Por época de entrenamiento.</p><div id="comp-vloss" class="grafica"></div></div>
        <div class="tarjeta"><h3>Accuracy en validación</h3><p class="nota">Por época de entrenamiento.</p><div id="comp-vacc" class="grafica"></div></div>
      </div>
      <div class="tarjeta"><h3>Lectura de la comparación</h3><div id="comp-conclusion" class="ficha-desc" style="font-size:15px"></div></div>
      </div>`;

    $("#comparacion").innerHTML = html;

    const series = ids.map((i) => ({ id: i, nombre: nombreModelo(i), color: COLOR[i] }));
    const dominio = (vals) => [Math.max(0, Math.floor((Math.min(...vals.filter((v) => v != null)) - 0.005) * 20) / 20), 1];
    const filasDe = (fuente) => filasMet.map(([t, k]) => ({ nombre: t, valores: Object.fromEntries(ids.map((i) => [i, fuente(i) ? fuente(i)[k] : null])) }));
    const dib = (sel, fuente) => {
      const f = filasDe(fuente);
      const [mn, mx] = dominio(f.flatMap((x) => Object.values(x.valores)));
      G.puntos($(sel), { filas: f, series, min: mn, max: mx, formato: (v) => (v * 100).toFixed(1) + " %" });
    };
    if (vivo) dib("#comp-vivo", (i) => vivo[ids.indexOf(i)]);
    dib("#comp-test", (i) => I[i].conjuntos.test);
    if (I[a].externa) dib("#comp-ext", (i) => I[i].externa);
    const maxEp = Math.max(...ids.map((i) => I[i].historial.length));
    const xs = Array.from({ length: maxEp }, (_, k) => k + 1);
    const serieHist = (k) => ids.map((i) => ({ nombre: nombreModelo(i), color: COLOR[i], valores: xs.map((x) => { const e = I[i].historial.find((h) => h.epoca === x); return e ? e[k] : null; }) }));
    G.lineas($("#comp-vloss"), { xs, etiquetaX: "Época", tituloX: "Época", yMin: 0, series: serieHist("val_loss"), formatoY: (v) => v.toFixed(2), formatoTooltip: (v) => v.toFixed(4) });
    const vmin = Math.min(...ids.flatMap((i) => I[i].historial.map((h) => h.val_accuracy)));
    G.lineas($("#comp-vacc"), { xs, etiquetaX: "Época", tituloX: "Época", yMin: Math.floor(vmin * 10) / 10, yMax: 1, series: serieHist("val_accuracy"), formatoY: (v) => (v * 100).toFixed(0) + " %", formatoTooltip: (v) => (v * 100).toFixed(2) + " %" });
    $("#comp-conclusion").innerHTML = conclusion(a, b);
  }

  function conclusion(a, b) {
    const I = S.info, na = nombreModelo(a), nb = nombreModelo(b);
    const ta = I[a].conjuntos.test, tb = I[b].conjuntos.test;
    const p = [];
    if (Math.abs(ta.accuracy - tb.accuracy) < 1e-9) p.push(`En test ambos modelos alcanzan ${pct(ta.accuracy)} % de accuracy (${ta.cm.fp + ta.cm.fn} errores cada uno en ${ta.n} imágenes), pero se equivocan de forma distinta: ${na} tiene ${ta.cm.fp} falsos positivos y ${ta.cm.fn} falsos negativos; ${nb}, ${tb.cm.fp} y ${tb.cm.fn}.`);
    else p.push(`En test, ${ta.accuracy > tb.accuracy ? na : nb} obtiene mejor accuracy (${pct(Math.max(ta.accuracy, tb.accuracy))} % frente a ${pct(Math.min(ta.accuracy, tb.accuracy))} %).`);
    if (I[a].externa && I[b].externa) {
      const ea = I[a].externa, eb = I[b].externa;
      const mej = ea.accuracy >= eb.accuracy ? [na, ea, nb, eb] : [nb, eb, na, ea];
      p.push(`Con imágenes externas, que se parecen más a la prueba en vivo, ${mej[0]} generaliza mejor: ${pct(mej[1].accuracy)} % frente a ${pct(mej[3].accuracy)} %, con AUC ${num(mej[1].auc, 3)} frente a ${num(mej[3].auc, 3)}.`);
    }
    const pa = I[a].arquitectura.total, pb = I[b].arquitectura.total;
    p.push(`${pa > pb ? nb : na} es ${(Math.max(pa, pb) / Math.min(pa, pb)).toFixed(0)} veces más pequeño en parámetros (${ARQ.fmtParam(Math.min(pa, pb))} frente a ${ARQ.fmtParam(Math.max(pa, pb))}) y más rápido en inferencia, una ventaja para un sistema embarcado en dron. ${pa > pb ? na : nb} aporta la robustez de los filtros preentrenados en ImageNet.`);
    return p.map((x) => `<p style="margin-bottom:10px">${esc(x)}</p>`).join("");
  }

  document.addEventListener("DOMContentLoaded", () => iniciar().catch((e) => {
    document.querySelector("main").insertAdjacentHTML("afterbegin", `<div class="tarjeta aviso" style="margin-top:24px">No se pudo iniciar la interfaz: ${esc(e.message)}</div>`);
  }));
})();
