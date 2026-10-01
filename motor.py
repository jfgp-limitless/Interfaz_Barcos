"""
Núcleo de inferencia del clasificador de barcos.

Contiene el MISMO preprocesamiento usado en el entrenamiento (Colab):
    lectura con OpenCV -> BGR a RGB -> validación 80x80 (padding solo si hace falta)
    -> float32 en rango 0-255 (cada modelo normaliza internamente).

Lo usan tanto la interfaz (app.py) como el script tools/generar_info_modelos.py.
"""

import os
import json
import time
import threading

import cv2
import numpy as np

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

RAIZ = os.path.dirname(os.path.abspath(__file__))
CARPETA_MODELOS = os.path.join(RAIZ, "modelos")
CARPETA_INFO = os.path.join(RAIZ, "info_modelos")

TAMANO_IMG = 80
EXT_VALIDAS = (".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp")

# Nombres de carpeta aceptados para cada clase (se comparan en minúsculas, sin espacios ni guiones)
NOMBRES_NEGATIVOS = {"nobarcos", "nobarco", "noship", "noships", "sinbarco", "sinbarcos", "negativo", "negativos", "0"}
NOMBRES_POSITIVOS = {"barcos", "barco", "ship", "ships", "conbarco", "positivo", "positivos", "1"}


# ---------------------------------------------------------------------------
# Preprocesamiento (idéntico al de los notebooks de entrenamiento)
# ---------------------------------------------------------------------------

def redimensionar_padding(img, size=TAMANO_IMG):
    h, w = img.shape[:2]
    max_lado = max(h, w)
    fondo = np.zeros((max_lado, max_lado, 3), dtype=np.uint8)
    x_off = (max_lado - w) // 2
    y_off = (max_lado - h) // 2
    fondo[y_off:y_off + h, x_off:x_off + w] = img
    return cv2.resize(fondo, (size, size), interpolation=cv2.INTER_AREA)


def preparar_bgr(img_bgr):
    """Recibe una imagen BGR (OpenCV) y devuelve (RGB uint8 80x80, fue_ajustada)."""
    img = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    ajustada = False
    if img.shape[:2] != (TAMANO_IMG, TAMANO_IMG):
        img = redimensionar_padding(img, TAMANO_IMG)
        ajustada = True
    return img, ajustada


def cargar_desde_ruta(ruta):
    img = cv2.imread(ruta, cv2.IMREAD_COLOR)
    if img is None:
        return None, False
    return preparar_bgr(img)


def cargar_desde_bytes(datos):
    arr = np.frombuffer(datos, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        return None, False
    return preparar_bgr(img)


def _normalizar_nombre(s):
    return s.lower().replace(" ", "").replace("_", "").replace("-", "")


def etiqueta_desde_ruta(ruta_relativa):
    """
    Deduce la etiqueta real a partir de la ruta:
      - una carpeta llamada Barcos / barco / ship ...         -> 1
      - una carpeta llamada No_Barcos / no_barco / no_ship ... -> 0
      - nombre de archivo que empieza por "1__" o "0__"         -> 1 / 0
      - si no hay pista -> None (sin etiqueta; se puede etiquetar en la interfaz)
    """
    partes = ruta_relativa.replace("\\", "/").split("/")
    for carpeta in reversed(partes[:-1]):
        n = _normalizar_nombre(carpeta)
        if n in NOMBRES_NEGATIVOS:
            return 0
        if n in NOMBRES_POSITIVOS:
            return 1
    nombre = partes[-1]
    if nombre.startswith("1__"):
        return 1
    if nombre.startswith("0__"):
        return 0
    return None


def listar_imagenes(carpeta):
    """Lista recursivamente las imágenes de una carpeta. Devuelve rutas relativas ordenadas."""
    salida = []
    for raiz, _, archivos in os.walk(carpeta):
        for f in archivos:
            if f.lower().endswith(EXT_VALIDAS) and not f.startswith("."):
                salida.append(os.path.relpath(os.path.join(raiz, f), carpeta))
    return sorted(salida, key=lambda r: r.replace("\\", "/").lower())


# ---------------------------------------------------------------------------
# Catálogo y gestión de modelos
# ---------------------------------------------------------------------------

def leer_catalogo():
    with open(os.path.join(CARPETA_MODELOS, "catalogo.json"), encoding="utf-8") as f:
        return json.load(f)


class GestorModelos:
    """Carga los modelos una sola vez (en segundo plano) y ejecuta la inferencia."""

    def __init__(self):
        self.catalogo = leer_catalogo()
        self.modelos = {}
        self.errores = {}
        self.listo = threading.Event()
        self._lock = threading.Lock()
        self.version_tf = None

    def cargar_todos(self):
        try:
            import tensorflow as tf
            self.version_tf = tf.__version__
            for m in self.catalogo["modelos"]:
                ruta = os.path.join(CARPETA_MODELOS, m["archivo"])
                try:
                    t0 = time.time()
                    modelo = tf.keras.models.load_model(ruta, compile=False)
                    # Calentamiento: la primera predicción siempre es más lenta
                    modelo.predict(np.zeros((1, TAMANO_IMG, TAMANO_IMG, 3), dtype="float32"), verbose=0)
                    self.modelos[m["id"]] = modelo
                    print(f"  Modelo '{m['id']}' cargado en {time.time() - t0:.1f} s")
                except Exception as e:  # noqa: BLE001
                    self.errores[m["id"]] = str(e)
                    print(f"  ERROR cargando '{m['id']}': {e}")
        except Exception as e:  # noqa: BLE001
            self.errores["tensorflow"] = str(e)
            print("  ERROR importando TensorFlow:", e)
        finally:
            self.listo.set()

    def cargar_en_segundo_plano(self):
        threading.Thread(target=self.cargar_todos, daemon=True).start()

    def estado(self):
        return {
            "listo": self.listo.is_set(),
            "cargados": sorted(self.modelos.keys()),
            "errores": self.errores,
            "tensorflow": self.version_tf,
        }

    def predecir(self, id_modelo, X, lote=64):
        """Devuelve (probabilidades, milisegundos totales)."""
        self.listo.wait()
        if id_modelo not in self.modelos:
            raise KeyError(f"Modelo '{id_modelo}' no disponible: {self.errores.get(id_modelo, 'no cargado')}")
        with self._lock:
            t0 = time.perf_counter()
            prob = self.modelos[id_modelo].predict(X, batch_size=lote, verbose=0).ravel()
            ms = (time.perf_counter() - t0) * 1000
        return prob.astype(float), ms
