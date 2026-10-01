"""
Interfaz de evaluación en vivo — Clasificador de barcos en imágenes satelitales.
Proyecto 2 · Inteligencia Artificial · Universidad Militar Nueva Granada

Ejecutar:
    python app.py
y abrir http://127.0.0.1:5000 (se abre solo en el navegador).
"""

import io
import json
import os
import subprocess
import sys
import threading
import uuid
import webbrowser

import cv2
import numpy as np
from flask import Flask, abort, jsonify, request, send_file, send_from_directory

import motor

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024 * 1024  # 1 GB por petición

gestor = motor.GestorModelos()

# Carpetas locales abiertas por ruta: token -> {"raiz": str, "archivos": [rutas relativas]}
_carpetas = {}


def _info_modelos():
    info = {}
    for m in gestor.catalogo["modelos"]:
        ruta = os.path.join(motor.CARPETA_INFO, f"{m['id']}.json")
        if os.path.exists(ruta):
            with open(ruta, encoding="utf-8") as f:
                info[m["id"]] = json.load(f)
    return info


# ---------------------------------------------------------------------------
# Páginas y archivos estáticos
# ---------------------------------------------------------------------------

@app.route("/")
def inicio():
    return send_from_directory(os.path.join(motor.RAIZ, "templates"), "index.html")


@app.route("/info/figuras/<path:archivo>")
def figuras(archivo):
    return send_from_directory(os.path.join(motor.CARPETA_INFO, "figuras"), archivo)


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

@app.route("/api/config")
def config():
    return jsonify({"catalogo": gestor.catalogo, "info": _info_modelos(), "estado": gestor.estado()})


@app.route("/api/estado")
def estado():
    return jsonify(gestor.estado())


def _inferir(ids, X):
    probs, tiempos = {}, {}
    for i in ids:
        p, ms = gestor.predecir(i, X)
        probs[i] = p
        tiempos[i] = ms
    return probs, tiempos


def _ids_validos(texto):
    ids = [s for s in (texto or "").split(",") if s]
    validos = {m["id"] for m in gestor.catalogo["modelos"]}
    ids = [i for i in ids if i in validos]
    if not ids:
        abort(400, "No se indicó un modelo válido")
    return ids


@app.route("/api/evaluar", methods=["POST"])
def evaluar_subidos():
    """Recibe un lote de imágenes subidas desde el navegador (selector de carpeta)."""
    ids = _ids_validos(request.form.get("modelos"))
    archivos = request.files.getlist("archivos")
    rutas = request.form.getlist("rutas")
    items, X = [], []
    for k, f in enumerate(archivos):
        rel = rutas[k] if k < len(rutas) else f.filename
        img, ajustada = motor.cargar_desde_bytes(f.read())
        item = {"ruta": rel, "etiqueta": motor.etiqueta_desde_ruta(rel), "ajustada": ajustada, "valida": img is not None}
        items.append(item)
        if img is not None:
            X.append(img)
    return _responder(ids, items, X)


@app.route("/api/carpeta", methods=["POST"])
def abrir_carpeta():
    """Registra una carpeta local (ruta escrita o elegida) y devuelve cuántas imágenes tiene."""
    ruta = (request.json or {}).get("ruta", "").strip().strip('"')
    if not ruta or not os.path.isdir(ruta):
        return jsonify({"error": "La ruta no existe o no es una carpeta."}), 400
    archivos = motor.listar_imagenes(ruta)
    if not archivos:
        return jsonify({"error": "No se encontraron imágenes en esa carpeta."}), 400
    token = uuid.uuid4().hex
    _carpetas[token] = {"raiz": ruta, "archivos": archivos}
    return jsonify({"token": token, "total": len(archivos), "nombre": os.path.basename(os.path.normpath(ruta))})


@app.route("/api/evaluar_carpeta", methods=["POST"])
def evaluar_carpeta():
    datos = request.json or {}
    carpeta = _carpetas.get(datos.get("token"))
    if not carpeta:
        abort(404, "Carpeta no registrada")
    ids = _ids_validos(datos.get("modelos"))
    inicio, cantidad = int(datos.get("inicio", 0)), int(datos.get("cantidad", 64))
    items, X = [], []
    for idx in range(inicio, min(inicio + cantidad, len(carpeta["archivos"]))):
        rel = carpeta["archivos"][idx]
        img, ajustada = motor.cargar_desde_ruta(os.path.join(carpeta["raiz"], rel))
        items.append({
            "ruta": rel.replace("\\", "/"),
            "etiqueta": motor.etiqueta_desde_ruta(rel),
            "ajustada": ajustada,
            "valida": img is not None,
            "miniatura": f"/api/miniatura/{datos['token']}/{idx}",
        })
        if img is not None:
            X.append(img)
    return _responder(ids, items, X)


def _responder(ids, items, X):
    if X:
        probs, tiempos = _inferir(ids, np.array(X, dtype="float32"))
    else:
        probs, tiempos = {i: [] for i in ids}, {i: 0.0 for i in ids}
    k = 0
    for item in items:
        if item["valida"]:
            item["prob"] = {i: float(probs[i][k]) for i in ids}
            k += 1
    return jsonify({"items": items, "tiempos_ms": tiempos, "n_validas": len(X)})


@app.route("/api/miniatura/<token>/<int:idx>")
def miniatura(token, idx):
    carpeta = _carpetas.get(token)
    if not carpeta or idx >= len(carpeta["archivos"]):
        abort(404)
    img, _ = motor.cargar_desde_ruta(os.path.join(carpeta["raiz"], carpeta["archivos"][idx]))
    if img is None:
        abort(404)
    ok, buf = cv2.imencode(".png", cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
    return send_file(io.BytesIO(buf.tobytes()), mimetype="image/png", max_age=3600)


@app.route("/api/elegir_carpeta", methods=["POST"])
def elegir_carpeta():
    """Abre el diálogo nativo del sistema para elegir una carpeta (en un proceso aparte)."""
    codigo = (
        "import tkinter as tk; from tkinter import filedialog;"
        "r = tk.Tk(); r.withdraw(); r.attributes('-topmost', True);"
        "print(filedialog.askdirectory(title='Selecciona la carpeta de imágenes de prueba') or '')"
    )
    try:
        salida = subprocess.run([sys.executable, "-c", codigo], capture_output=True, text=True, timeout=600)
        return jsonify({"ruta": salida.stdout.strip()})
    except Exception as e:  # noqa: BLE001
        return jsonify({"ruta": "", "error": str(e)})


# ---------------------------------------------------------------------------

def main():
    puerto = int(os.environ.get("PORT", 5000))
    url = f"http://127.0.0.1:{puerto}"
    print("=" * 64)
    print(" Clasificador de barcos — interfaz de evaluación en vivo")
    print(f" Abre en el navegador: {url}")
    print(" Cargando modelos en segundo plano...")
    print("=" * 64)
    gestor.cargar_en_segundo_plano()
    if os.environ.get("NO_BROWSER") != "1":
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    app.run(host="127.0.0.1", port=puerto, debug=False, threaded=True)


if __name__ == "__main__":
    main()
