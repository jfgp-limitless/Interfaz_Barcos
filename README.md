# Detección de barcos en imágenes satelitales

Interfaz de evaluación en vivo para dos clasificadores binarios (barco / no barco) entrenados sobre imágenes satelitales RGB de 80 × 80 px. El clasificador está pensado para el sistema de percepción de un dron de inspección portuaria.

**Proyecto 2 · Inteligencia Artificial · 2026-2**
Juan Felipe Gonzalez Pardo · Código 7004086
Ingeniería Mecatrónica · Universidad Militar Nueva Granada

## Qué hace

La interfaz tiene tres pestañas.

**Evaluación en vivo.** Se elige el modelo (ResNet50, CNN desde cero o ambos) y se carga una carpeta de imágenes. La carpeta se puede seleccionar desde el navegador, arrastrar, o indicar por ruta local con el botón *Explorar*. La interfaz calcula en el momento:

- accuracy, precisión, recall, F1, especificidad y AUC;
- la matriz de confusión, la curva ROC y la distribución de probabilidades;
- el tiempo de inferencia por imagen;
- la comparación con la meta de 98 % y la penalización estimada.

En la galería se ve cada imagen con su predicción y su probabilidad. Se puede cambiar la etiqueta real con un clic y las métricas se recalculan al instante. El umbral de decisión se ajusta desde la misma pestaña, y los resultados se exportan a CSV.

**Modelo.** Ficha técnica de cada red:

- diagrama de la arquitectura generado desde el modelo real;
- explicación del bloque convolucional o residual y distribución de parámetros;
- tabla de todas las capas;
- datos y split, preprocesamiento e hiperparámetros;
- curvas de entrenamiento (loss, accuracy y learning rate);
- métricas de train, validación, test y prueba externa;
- todas las salidas de las celdas del notebook de Colab, con sus gráficas.

**Comparación.** Métricas lado a lado de los dos modelos. Si se evaluó con *Ambos*, incluye la comparación en vivo. Muestra además tamaño, parámetros, velocidad y curvas de validación superpuestas.

## Etiquetar a mano antes de evaluar

Si la carpeta de prueba llega mezclada y sin etiquetas, en el paso 2 se elige **Etiquetar yo primero**. La carpeta se carga sin ejecutar el modelo y se abre el panel de etiquetado manual: cada imagen se ve ampliada y se clasifica con los botones o con el teclado (`B` barco, `N` no barco, flechas para moverse, `Supr` para quitar la etiqueta). Al terminar, **Evaluar con el modelo** corre la inferencia y calcula las métricas con las etiquetas puestas a mano.

## Cómo se etiquetan las imágenes de prueba

La etiqueta real se deduce de la ruta de cada imagen:

- subcarpetas `Barcos` / `No_Barcos` (también `barco` / `no_barco`, `ship` / `no_ship`);
- o prefijo del archivo `1__` (barco) / `0__` (no barco), como en el dataset de Kaggle.

Si no hay pista, la imagen queda *sin etiqueta*. Se puede etiquetar en la galería, una por una o todas a la vez.

## Instalación (Windows)

Se necesita Python 3.10, 3.11 o 3.12 de 64 bits.

```bat
cd Interfaz_Barcos
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Uso

```bat
.venv\Scripts\activate
python app.py
```

El navegador se abre solo en <http://127.0.0.1:5000>. Los modelos tardan unos segundos en cargar; el indicador de la esquina superior derecha se pone en verde cuando están listos.

En Windows basta con hacer doble clic en `iniciar.bat`: la primera vez crea el entorno `.venv` e instala las dependencias (tarda varios minutos), y las siguientes abre la interfaz directamente.

La interfaz funciona sin conexión a internet: las gráficas están hechas en SVG propio, sin librerías externas.

## Estructura

```text
Interfaz_Barcos/
├── app.py                      servidor Flask (API + página)
├── motor.py                    preprocesamiento idéntico al del entrenamiento + carga de modelos
├── modelos/
│   ├── catalogo.json           datos del proyecto, del dataset e hiperparámetros de cada modelo
│   ├── modelo_barcos_resnet50.keras
│   └── modelo_barcos_cnn.keras
├── info_modelos/               métricas, historial, arquitectura y figuras (generado)
├── notebooks/                  notebooks de entrenamiento ejecutados en Colab
├── templates/index.html
├── static/css, static/js       interfaz (gráficas y diagramas en SVG propio)
└── tools/generar_info_modelos.py
```

## Preprocesamiento

Es el mismo en el entrenamiento, en la evaluación y en la interfaz:

1. Lectura con OpenCV y conversión de BGR a RGB.
2. Validación del tamaño 80 × 80. Si una imagen no lo cumple, se le aplica padding centrado y se redimensiona.
3. Se entrega al modelo como `float32` en el rango 0–255.

Cada modelo hace su normalización internamente. ResNet50 escala a 160 px y resta la media de ImageNet; la CNN aplica `Rescaling 1/255`.

## Regenerar la información de los modelos

Si se reentrena un modelo, copia el nuevo `.keras` en `modelos/` y el notebook ejecutado en `notebooks/`. Después ejecuta:

```bat
python tools/generar_info_modelos.py --dataset RUTA\DataSet_Split --externa RUTA\DataSetv2
```

El script recalcula las métricas de train, val, test y la carpeta externa. También extrae el historial y las gráficas del notebook y describe la arquitectura capa por capa.

## Resultados (umbral 0.5)

| Conjunto | ResNet50 | CNN desde cero |
|---|---|---|
| Train (1 506) | 99.93 % | 98.74 % |
| Validación (300) | 98.67 % | 97.33 % |
| Test (200) | 98.50 % | 98.50 % |
| Externa (40) | 97.50 % | 92.50 % |
| Parámetros | 23.9 M | 1.24 M |

El split se hizo **por escena satelital** (379 escenas): ninguna escena aparece en dos conjuntos.

## Notas para GitHub

`modelo_barcos_resnet50.keras` pesa unos 96 MB. Se guardó sin el estado del optimizador, así que queda por debajo del límite de 100 MB por archivo de GitHub. GitHub muestra una advertencia por superar 50 MB, pero lo acepta.

Si prefieres usar Git LFS:

```bash
git lfs install
git lfs track "*.keras"
```

## Dataset

[Ships in Satellite Imagery (Kaggle)](https://www.kaggle.com/datasets/rhammell/ships-in-satellite-imagery): 1 000 imágenes con barco y 3 000 sin barco, recortes de escenas Planet de la bahía de San Francisco.
