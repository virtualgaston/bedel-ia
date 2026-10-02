import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";

let llmEngine = null;
let indice = {};          // materia -> [{ texto, norm }]
let historialChat = [];   // solo user/assistant, sin system

const preguntaInput = document.getElementById("pregunta");
const enviarBtn = document.getElementById("enviar");
const selectorMateria = document.getElementById("selector-materia");
const chatDiv = document.getElementById("chat-container");
const loadingOverlay = document.getElementById("loading-overlay");
const loadingText = document.getElementById("loading-text");
const loadingProgress = document.getElementById("loading-progress");
const progressBarFill = document.getElementById("progress-bar-fill");

const MSG_RECHAZO = "Lo siento, solo puedo responder consultas académicas relacionadas con el programa de esta asignatura.";
const K_FRAGMENTOS = 4;
const MAX_CHARS_CONTEXTO = 3500;
const MAX_MENSAJES_HISTORIAL = 4;
const GENERICAS = /unidad|programa|bibliograf|evaluaci|aprob|cursad|objetivo|contenido|docente|materia|asignatura|carga|horari|regularidad|examen/;

const frasesDivertidas = [
    "Buscando en los papeles...",
    "Leyendo los programas de las materias...",
    "Ordenando la bibliografía...",
    "Revisando el plan de estudios..."
];

function normalizar(t) {
    return t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Raíz simple para que "unidades" coincida con "unidad"
function raices(t) {
    return normalizar(t)
        .split(/[^a-z0-9ñ]+/)
        .filter(p => p.length > 3)
        .map(p => (p.length > 5 ? p.slice(0, 5) : p));
}

function buscarContexto(pregunta, fragmentos) {
    const claves = raices(pregunta);
    const norm = normalizar(pregunta);
    let elegidos = [];

    if (claves.length) {
        elegidos = fragmentos
            .map(f => ({ f, puntaje: claves.reduce((s, c) => s + (f.norm.includes(c) ? 1 : 0), 0) }))
            .filter(x => x.puntaje > 0)
            .sort((a, b) => b.puntaje - a.puntaje)
            .slice(0, K_FRAGMENTOS)
            .map(x => x.f);
    }

    if (!elegidos.length) {
        if (!GENERICAS.test(norm)) return null; // sin relación con el programa
        elegidos = fragmentos.slice(0, K_FRAGMENTOS);
    }

    let ctx = elegidos.map(f => f.texto).join("\n\n");
    if (ctx.length > MAX_CHARS_CONTEXTO) ctx = ctx.slice(0, MAX_CHARS_CONTEXTO);
    return ctx;
}

function agregarMensaje(clase, texto) {
    const div = document.createElement("div");
    div.className = `mensaje ${clase}`;
    div.style.whiteSpace = "pre-wrap";
    div.textContent = texto;
    chatDiv.appendChild(div);
    chatDiv.scrollTop = chatDiv.scrollHeight;
    return div;
}

function setUI(habilitado) {
    preguntaInput.disabled = !habilitado;
    enviarBtn.disabled = !habilitado;
    selectorMateria.disabled = !habilitado;
    if (habilitado) preguntaInput.focus();
}

function mostrarError(titulo, detalle) {
    document.querySelector(".loader-spinner").style.display = "none";
    document.querySelector(".progress-container").style.display = "none";
    loadingText.textContent = titulo;
    loadingText.style.color = "#f07070";
    loadingProgress.textContent = detalle;
}

async function inicializarApp() {
    let fraseInterval;

    let adapter = null;
    try {
        adapter = navigator.gpu ? await navigator.gpu.requestAdapter({ powerPreference: "high-performance" }) : null;
    } catch (_) {}
    if (!adapter) {
        mostrarError("❌ No se encontró una GPU compatible.",
            "Use Chrome/Edge actualizado, active la aceleración por hardware y reinicie el navegador.");
        return;
    }

    try {
        let i = 0;
        loadingText.textContent = frasesDivertidas[0];
        fraseInterval = setInterval(() => {
            i = (i + 1) % frasesDivertidas.length;
            loadingText.textContent = frasesDivertidas[i];
        }, 2500);

        loadingProgress.textContent = "[1/2] Sincronizando base de datos académica...";
        progressBarFill.style.width = "10%";

        // Elegir variante liviana según soporte de f16
        const f16 = adapter.features.has("shader-f16");
        const modeloLLM = f16
            ? "Llama-3.2-1B-Instruct-q4f16_1-MLC"
            : "Llama-3.2-1B-Instruct-q4f32_1-MLC";
        // Alternativa con mejor español (algo más pesada):
        // f16 ? "Qwen2.5-1.5B-Instruct-q4f16_1-MLC" : "Qwen2.5-1.5B-Instruct-q4f32_1-MLC"

        // Descarga de datos y del modelo en paralelo
        const datosPromise = fetch("datos.json").then(r => r.json());
        const enginePromise = CreateMLCEngine(
            modeloLLM,
            {
                initProgressCallback: (info) => {
                    const p = Math.round(info.progress * 100);
                    loadingProgress.textContent = `[2/2] Cargando modelo de IA: ${p}%`;
                    progressBarFill.style.width = `${10 + p * 0.9}%`;
                }
            },
            { context_window_size: 2048 }
        );

        const [datos, engine] = await Promise.all([datosPromise, enginePromise]);
        llmEngine = engine;

        // Pre-normalizar una sola vez cada fragmento
        for (const materia in datos) {
            indice[materia] = datos[materia].map(item => ({
                texto: item.texto,
                norm: normalizar(item.texto)
            }));
        }

        clearInterval(fraseInterval);
        loadingOverlay.classList.add("hidden");
        setUI(true);
    } catch (error) {
        console.error("Error crítico:", error);
        if (fraseInterval) clearInterval(fraseInterval);
        mostrarError("❌ Error de inicialización.",
            "Reinicie el navegador, verifique la memoria de video disponible o su conexión.");
    }
}

async function responderPregunta() {
    const pregunta = preguntaInput.value.trim();
    if (!pregunta) return;

    agregarMensaje("usuario", pregunta);
    preguntaInput.value = "";
    setUI(false);

    try {
        const contexto = buscarContexto(pregunta, indice[selectorMateria.value] || []);

        // Filtro en JS: no se usa la GPU para preguntas sin relación
        if (contexto === null) {
            agregarMensaje("asistente", MSG_RECHAZO);
            return;
        }

        const promptSistema =
`Eres el Asistente de Bedelía de la carrera de Historia. Responde en español, de forma breve y precisa, usando SOLO el texto del programa de abajo. Si la respuesta no está en el texto, di que no figura en el programa. No inventes datos.

PROGRAMA:
${contexto}`;

        historialChat.push({ role: "user", content: pregunta });
        historialChat = historialChat.slice(-MAX_MENSAJES_HISTORIAL);

        const mensajes = [{ role: "system", content: promptSistema }, ...historialChat];

        const caja = agregarMensaje("asistente", "Generando respuesta...");
        caja.style.color = "var(--muted)";

        const chunks = await llmEngine.chat.completions.create({
            messages: mensajes,
            stream: true,
            max_tokens: 300,
            temperature: 0.2
        });

        let texto = "";
        let pendiente = false;
        const pintar = () => {
            caja.textContent = texto;
            chatDiv.scrollTop = chatDiv.scrollHeight;
            pendiente = false;
        };

        for await (const chunk of chunks) {
            texto += chunk.choices[0]?.delta?.content || "";
            if (!pendiente) {            // un repintado por frame, no por token
                pendiente = true;
                requestAnimationFrame(pintar);
            }
        }
        pintar();
        caja.style.color = "";

        historialChat.push({ role: "assistant", content: texto });
        historialChat = historialChat.slice(-MAX_MENSAJES_HISTORIAL);
    } catch (error) {
        console.error(error);
        agregarMensaje("asistente", "Ocurrió un error al generar la respuesta. Si persiste, reinicie el navegador.");
    } finally {
        setUI(true);
    }
}

enviarBtn.addEventListener("click", responderPregunta);
preguntaInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !preguntaInput.disabled) responderPregunta();
});

selectorMateria.addEventListener("change", () => {
    historialChat = [];
    const aviso = agregarMensaje("asistente", "Cambio de asignatura detectado. El historial de conversación se ha reiniciado.");
    aviso.style.cssText = "background: var(--surface); color: var(--muted); text-align: center; font-style: italic; font-size: 0.85rem; border: 1px dashed var(--border);";
});

inicializarApp();