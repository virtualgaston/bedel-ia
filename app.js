import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";

let llmEngine = null;
let baseDeDatosCompleta = null; // Almacenará el JSON gigante
let historialChat = []; // Memoria de la conversación

const preguntaInput = document.getElementById("pregunta");
const enviarBtn = document.getElementById("enviar");
const selectorMateria = document.getElementById("selector-materia");
const chatDiv = document.getElementById("chat-container");

const loadingOverlay = document.getElementById("loading-overlay");
const loadingText = document.getElementById("loading-text");
const loadingProgress = document.getElementById("loading-progress");
const progressBarFill = document.getElementById("progress-bar-fill");

const frasesDivertidas = [
    "Buscando en los papeles...",
    "Leyendo los programas de las materias...",
    "Ordenando la bibliografía...",
    "Clasificando los textos obligatorios...",
    "Buscando los apuntes...",
    "Hojeando los libros...",
    "Revisando el plan de estudios..."
];

// Inicialización de los modelos en el navegador
async function inicializarApp() {
    let fraseInterval;

    if (!navigator.gpu) {
        loadingText.textContent = "❌ Su navegador no soporta WebGPU.";
        loadingText.style.color = "#f07070";
        loadingProgress.textContent = "Se requiere un equipo/navegador compatible (Chrome/Edge) para ejecutar este modelo localmente.";
        document.querySelector(".loader-spinner").style.display = "none";
        document.querySelector(".progress-container").style.display = "none";
        return;
    }

    try {
        let fraseIndex = 0;
        loadingText.textContent = frasesDivertidas[0]; // Mostrar la primera de inmediato
        fraseInterval = setInterval(() => {
            fraseIndex = (fraseIndex + 1) % frasesDivertidas.length;
            loadingText.textContent = frasesDivertidas[fraseIndex];
        }, 2500);

        loadingProgress.textContent = "[1/2] Sincronizando base de datos académica...";
        progressBarFill.style.width = "20%";
        const response = await fetch("datos.json");
        baseDeDatosCompleta = await response.json();

        // Volvemos al modelo 3B. El 1B era rápido pero carecía del razonamiento necesario
        // para seguir instrucciones complejas y no alucinar. Nota: el navegador lo cachea.
        const modeloLLM = "Llama-3.2-3B-Instruct-q4f32_1-MLC";
        llmEngine = await CreateMLCEngine(modeloLLM, {
            initProgressCallback: (info) => {
                const porcentaje = Math.round(info.progress * 100);
                loadingProgress.textContent = `[2/2] Descargando modelo de inteligencia artificial: ${porcentaje}%`;
                progressBarFill.style.width = `${20 + (porcentaje * 0.8)}%`;
            }
        });

        clearInterval(fraseInterval);
        loadingOverlay.classList.add("hidden");
        
        preguntaInput.disabled = false;
        enviarBtn.disabled = false;
        selectorMateria.disabled = false;
        preguntaInput.focus();

    } catch (error) {
        console.error("Error crítico:", error);
        if(fraseInterval) clearInterval(fraseInterval);
        document.querySelector(".loader-spinner").style.display = "none";
        loadingText.textContent = "❌ Error de inicialización.";
        loadingText.style.color = "#f07070";
        loadingProgress.textContent = "Verifique la disponibilidad de memoria o su conexión a internet.";
    }
}

// Lógica para procesar la pregunta y el contexto
async function responderPregunta() {
    const pregunta = preguntaInput.value.trim();
    const materiaElegida = selectorMateria.value;
    
    if (!pregunta) return;

    chatDiv.innerHTML += `<div class="mensaje usuario">${pregunta}</div>`;
    preguntaInput.value = "";
    preguntaInput.disabled = true;
    enviarBtn.disabled = true;
    selectorMateria.disabled = true;
    chatDiv.scrollTop = chatDiv.scrollHeight;

    const fragmentosMateria = baseDeDatosCompleta[materiaElegida];
    const contextoRelevante = fragmentosMateria.map(item => item.texto).join("\n\n");

    const promptSistema = `Eres el Asistente de Bedelía, un asistente académico profesional y estricto.
REGLAS OBLIGATORIAS:
1. Tu único propósito es responder dudas sobre el programa académico proporcionado.
2. Si el usuario escribe palabras sin sentido (ej: "falopa", "rompete", "if (bool)"), hace preguntas matemáticas (ej: "2+2", "3-2"), te saluda de forma extraña, o pregunta CUALQUIER COSA fuera del ámbito académico, DEBES responder ÚNICAMENTE: "Lo siento, solo puedo responder consultas académicas relacionadas con el programa de esta asignatura."
3. NUNCA inventes información, no alucines hechos históricos ni agregues unidades que no estén en el texto.
4. Si preguntan cuántas unidades tiene, cuéntalas con cuidado en el texto proporcionado y lístalas.

PROGRAMA DE LA ASIGNATURA:
${contextoRelevante}`;

    if (historialChat.length === 0) {
        historialChat.push({ role: "system", content: promptSistema });
    } else {
        // Actualizar el system prompt por si cambió de programa
        historialChat[0].content = promptSistema;
    }

    historialChat.push({ role: "user", content: pregunta });

    const idRespuesta = "resp-" + Date.now();
    chatDiv.innerHTML += `<div class="mensaje asistente" id="${idRespuesta}"><span style="color:var(--muted)">Generando respuesta...</span></div>`;
    const cajaRespuesta = document.getElementById(idRespuesta);

    // Generar respuesta con historial
    const chunks = await llmEngine.chat.completions.create({
        messages: historialChat,
        stream: true,
    });

    let textoFinal = "";
    for await (const chunk of chunks) {
        textoFinal += chunk.choices[0]?.delta?.content || "";
        cajaRespuesta.innerHTML = textoFinal.replace(/\n/g, '<br>');
        chatDiv.scrollTop = chatDiv.scrollHeight;
    }

    historialChat.push({ role: "assistant", content: textoFinal });

    preguntaInput.disabled = false;
    enviarBtn.disabled = false;
    selectorMateria.disabled = false;
    preguntaInput.focus();
}

enviarBtn.addEventListener("click", responderPregunta);
preguntaInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !preguntaInput.disabled) responderPregunta();
});

selectorMateria.addEventListener("change", () => {
    historialChat = [];
    chatDiv.innerHTML += `<div class="mensaje asistente" style="background: var(--surface); color: var(--muted); text-align: center; font-style: italic; font-size: 0.85rem; border: 1px dashed var(--border);">Cambio de asignatura detectado. El historial de conversación se ha reiniciado.</div>`;
    chatDiv.scrollTop = chatDiv.scrollHeight;
});

inicializarApp();