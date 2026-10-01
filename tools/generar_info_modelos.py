"""
Genera la información que muestra la pestaña "Modelo" de la interfaz.

Para cada modelo del catálogo:
  1. Evalúa train / val / test leyendo la carpeta DataSet_Split con el MISMO preprocesamiento
     del entrenamiento (métricas, matrices de confusión, curva ROC, distribución de probabilidades).
  2. Evalúa opcionalmente una carpeta externa (las imágenes de prueba que nunca vio).
  3. Extrae del notebook ejecutado en Colab: historial de entrenamiento, textos impresos de cada
     celda y las gráficas (se guardan como PNG).
  4. Describe la arquitectura capa por capa (para ResNet50, además, por etapas y bloques residuales).

Uso (desde la carpeta del proyecto):
    python tools/generar_info_modelos.py --dataset RUTA/DataSet_Split --externa RUTA/DataSetv2
"""

import argparse
import base64
import json
import os
import re
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import motor  # noqa: E402


# ---------------------------------------------------------------------------
# Métricas
# ---------------------------------------------------------------------------

def metricas(y, prob, umbral):
    y = np.asarray(y).astype(int)
    prob = np.asarray(prob, dtype=float)
    pred = (prob > umbral).astype(int)
    tp = int(((pred == 1) & (y == 1)).sum()); tn = int(((pred == 0) & (y == 0)).sum())
    fp = int(((pred == 1) & (y == 0)).sum()); fn = int(((pred == 0) & (y == 1)).sum())
    n = len(y)
    acc = (tp + tn) / n if n else 0.0
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    esp = tn / (tn + fp) if tn + fp else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    p = np.clip(prob, 1e-7, 1 - 1e-7)
    loss = float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))) if n else 0.0
    return {
        "n": n, "positivos": int(y.sum()), "negativos": int((y == 0).sum()),
        "accuracy": acc, "precision": prec, "recall": rec, "especificidad": esp, "f1": f1,
        "loss": loss, "auc": auc_roc(y, prob),
        "cm": {"tn": tn, "fp": fp, "fn": fn, "tp": tp},
    }


def auc_roc(y, prob):
    y = np.asarray(y); prob = np.asarray(prob)
    pos = prob[y == 1]; neg = prob[y == 0]
    if len(pos) == 0 or len(neg) == 0:
        return None
    # Probabilidad de que un positivo puntúe más que un negativo (empates cuentan 0.5)
    orden = np.argsort(np.concatenate([pos, neg]), kind="mergesort")
    valores = np.concatenate([pos, neg])[orden]
    rangos = np.empty(len(valores)); i = 0
    while i < len(valores):
        j = i
        while j + 1 < len(valores) and valores[j + 1] == valores[i]:
            j += 1
        rangos[i:j + 1] = (i + j) / 2 + 1
        i = j + 1
    r = np.empty(len(valores)); r[orden] = rangos
    suma_pos = r[:len(pos)].sum()
    return float((suma_pos - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def curva_roc(y, prob):
    y = np.asarray(y); prob = np.asarray(prob)
    P = int((y == 1).sum()); N = int((y == 0).sum())
    if P == 0 or N == 0:
        return []
    umbrales = np.unique(np.concatenate([[np.inf], prob, [-np.inf]]))[::-1]
    puntos = []
    for u in umbrales:
        pred = prob >= u
        puntos.append([round(float((pred & (y == 0)).sum() / N), 5), round(float((pred & (y == 1)).sum() / P), 5)])
    # quitar puntos colineales repetidos
    limpio = []
    for p in puntos:
        if not limpio or p != limpio[-1]:
            limpio.append(p)
    return limpio


# ---------------------------------------------------------------------------
# Lectura del notebook ejecutado
# ---------------------------------------------------------------------------

def titulo_celda(fuente):
    for linea in fuente.split("\n"):
        t = linea.strip().strip("#").strip("=").strip()
        if t:
            return t
    return "Celda"


def limpiar_texto(t):
    t = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", t)
    t = "\n".join(l.split("\r")[-1] for l in t.split("\n"))
    t = re.sub(r"<IPython\.core\.display\.Javascript object>", "", t)
    return t.strip("\n")


def leer_notebook(ruta, carpeta_figuras, prefijo_url):
    with open(ruta, encoding="utf-8") as f:
        nb = json.load(f)
    os.makedirs(carpeta_figuras, exist_ok=True)
    celdas, n_fig = [], 0
    for c in nb["cells"]:
        if c["cell_type"] != "code":
            continue
        fuente = "".join(c["source"])
        texto, figuras = [], []
        for o in c.get("outputs", []):
            if o["output_type"] == "stream":
                texto.append("".join(o["text"]))
            elif o["output_type"] in ("execute_result", "display_data"):
                d = o.get("data", {})
                if "image/png" in d:
                    n_fig += 1
                    nombre = f"figura_{n_fig:02d}.png"
                    png = d["image/png"]
                    png = "".join(png) if isinstance(png, list) else png
                    with open(os.path.join(carpeta_figuras, nombre), "wb") as fh:
                        fh.write(base64.b64decode(png))
                    figuras.append(prefijo_url + nombre)
                elif "text/html" in d and "text/plain" in d:
                    texto.append("".join(d["text/plain"]))
                elif "text/plain" in d:
                    texto.append("".join(d["text/plain"]))
            elif o["output_type"] == "error":
                texto.append(f"{o['ename']}: {o['evalue']}")
        t = limpiar_texto("".join(texto))
        if t or figuras:
            celdas.append({"titulo": titulo_celda(fuente), "codigo": fuente, "texto": t, "figuras": figuras})
    return celdas


def historial_desde_texto(texto):
    epocas = []
    actual = None
    for linea in texto.split("\n"):
        m = re.match(r"\s*Epoch (\d+)/(\d+)", linea)
        if m:
            actual = int(m.group(1))
            continue
        if actual is not None and "val_loss" in linea:
            vals = dict(re.findall(r"(\w+): ([0-9.]+(?:e[-+]?\d+)?)", linea))
            fila = {"epoca": actual}
            for k, v in vals.items():
                fila[k] = float(v)
            epocas.append(fila)
            actual = None
    return epocas


# ---------------------------------------------------------------------------
# Arquitectura
# ---------------------------------------------------------------------------

def forma(s):
    return [None if d is None else int(d) for d in s]


def params_entrenables(capa):
    return int(sum(np.prod(w.shape) for w in capa.trainable_weights))


def describir_arquitectura(modelo):
    capas = []
    for capa in modelo.layers:
        capas.append({
            "nombre": capa.name,
            "tipo": type(capa).__name__,
            "salida": forma(capa.output.shape),
            "parametros": int(capa.count_params()),
            "entrenables": params_entrenables(capa),
        })
    info = {
        "capas": capas,
        "total": int(modelo.count_params()),
        "entrenables": int(sum(np.prod(w.shape) for w in modelo.trainable_weights)),
    }
    info["no_entrenables"] = info["total"] - info["entrenables"]

    # Desglose de una sub-red (ResNet50) por etapas
    for capa in modelo.layers:
        if hasattr(capa, "layers") and len(capa.layers) > 50:
            etapas = {}
            orden = []
            for sub in capa.layers:
                m = re.match(r"(conv\d)_(block\d+)?", sub.name)
                clave = m.group(1) if m else sub.name.split("_")[0]
                if clave not in etapas:
                    etapas[clave] = {"nombre": clave, "bloques": set(), "capas": 0, "parametros": 0,
                                     "entrenables": 0, "salida": None, "conv": 0}
                    orden.append(clave)
                e = etapas[clave]
                if m and m.group(2):
                    e["bloques"].add(m.group(2))
                e["capas"] += 1
                e["parametros"] += int(sub.count_params())
                e["entrenables"] += params_entrenables(sub)
                e["salida"] = forma(sub.output.shape)
                if type(sub).__name__ == "Conv2D":
                    e["conv"] += 1
            lista = []
            for k in orden:
                e = etapas[k]
                e["bloques"] = len(e["bloques"])
                lista.append(e)
            # capas entrenables de la sub-red (para indicar desde dónde se hizo fine-tuning)
            entrenables = [s.name for s in capa.layers if s.trainable_weights]
            info["subred"] = {
                "nombre": capa.name,
                "capas_totales": len(capa.layers),
                "etapas": lista,
                "primera_capa_entrenable": entrenables[0] if entrenables else None,
                "capas_con_pesos_entrenables": len(entrenables),
            }
    return info


# ---------------------------------------------------------------------------
# Programa principal
# ---------------------------------------------------------------------------

def cargar_carpeta(carpeta):
    X, y, nombres = [], [], []
    for rel in motor.listar_imagenes(carpeta):
        img, _ = motor.cargar_desde_ruta(os.path.join(carpeta, rel))
        if img is None:
            continue
        X.append(img); y.append(motor.etiqueta_desde_ruta(rel)); nombres.append(rel.replace("\\", "/"))
    return np.array(X, dtype="float32"), y, nombres


def histograma(prob, y, bins=20):
    prob = np.asarray(prob); y = np.asarray(y)
    bordes = np.linspace(0, 1, bins + 1)
    return {
        "bordes": [round(float(b), 3) for b in bordes],
        "barcos": np.histogram(prob[y == 1], bordes)[0].tolist(),
        "no_barcos": np.histogram(prob[y == 0], bordes)[0].tolist(),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True, help="Carpeta DataSet_Split (train/val/test)")
    ap.add_argument("--externa", default=None, help="Carpeta con imágenes externas de prueba (opcional)")
    args = ap.parse_args()

    import tensorflow as tf

    catalogo = motor.leer_catalogo()
    os.makedirs(motor.CARPETA_INFO, exist_ok=True)

    datos = {}
    for s in ["train", "val", "test"]:
        X, y, nombres = cargar_carpeta(os.path.join(args.dataset, s))
        datos[s] = (X, np.array(y, dtype=int), nombres)
        print(f"{s}: {len(X)} imágenes")
    externa = None
    if args.externa and os.path.isdir(args.externa):
        X, y, nombres = cargar_carpeta(args.externa)
        externa = (X, np.array([-1 if v is None else v for v in y]), nombres)
        print(f"externa: {len(X)} imágenes")

    for m in catalogo["modelos"]:
        print(f"\n=== {m['nombre']} ===")
        ruta_modelo = os.path.join(motor.CARPETA_MODELOS, m["archivo"])
        modelo = tf.keras.models.load_model(ruta_modelo, compile=False)
        umbral = m["umbral"]

        info = {"id": m["id"], "generado": time.strftime("%Y-%m-%d %H:%M"),
                "tensorflow_generacion": tf.__version__,
                "tamano_mb": round(os.path.getsize(ruta_modelo) / 1e6, 1)}
        info["arquitectura"] = describir_arquitectura(modelo)

        info["conjuntos"] = {}
        for s, (X, y, nombres) in datos.items():
            t0 = time.perf_counter()
            prob = modelo.predict(X, batch_size=64, verbose=0).ravel()
            ms = (time.perf_counter() - t0) * 1000
            r = metricas(y, prob, umbral)
            r["ms_por_imagen"] = ms / max(len(X), 1)
            if s == "test":
                r["roc"] = curva_roc(y, prob)
                r["histograma"] = histograma(prob, y)
                pred = (prob > umbral).astype(int)
                r["errores"] = [{"archivo": nombres[i], "real": int(y[i]), "prob": round(float(prob[i]), 4)}
                                for i in np.where(pred != y)[0]]
            info["conjuntos"][s] = r
            print(f"  {s:<5} acc={r['accuracy']:.4f} f1={r['f1']:.4f} cm={r['cm']}")

        if externa is not None and (externa[1] >= 0).all():
            X, y, nombres = externa
            prob = modelo.predict(X, batch_size=64, verbose=0).ravel()
            r = metricas(y, prob, umbral)
            r["roc"] = curva_roc(y, prob)
            pred = (prob > umbral).astype(int)
            r["errores"] = [{"archivo": nombres[i], "real": int(y[i]), "prob": round(float(prob[i]), 4)}
                            for i in np.where(pred != y)[0]]
            r["carpeta"] = os.path.basename(os.path.normpath(args.externa))
            info["externa"] = r
            print(f"  externa acc={r['accuracy']:.4f} cm={r['cm']}")

        # Notebook ejecutado: textos, figuras e historial
        ruta_nb = os.path.join(os.path.dirname(motor.CARPETA_MODELOS), "notebooks", m["notebook"])
        if os.path.exists(ruta_nb):
            carpeta_fig = os.path.join(motor.CARPETA_INFO, "figuras", m["id"])
            celdas = leer_notebook(ruta_nb, carpeta_fig, f"/info/figuras/{m['id']}/")
            info["notebook"] = celdas
            texto_entreno = "\n".join(c["texto"] for c in celdas if "ENTRENAMIENTO" in c["titulo"].upper())
            hist = historial_desde_texto(texto_entreno)
            info["historial"] = hist
            if hist:
                mejor = min(hist, key=lambda e: e.get("val_loss", 1e9))
                info["mejor_epoca"] = mejor["epoca"]
                info["epocas_entrenadas"] = len(hist)
            print(f"  notebook: {len(celdas)} celdas con salida, {len(hist)} épocas en el historial")

        with open(os.path.join(motor.CARPETA_INFO, f"{m['id']}.json"), "w", encoding="utf-8") as f:
            json.dump(info, f, ensure_ascii=False, indent=1)
        tf.keras.backend.clear_session()

    print("\nListo. Información guardada en", motor.CARPETA_INFO)


if __name__ == "__main__":
    main()
