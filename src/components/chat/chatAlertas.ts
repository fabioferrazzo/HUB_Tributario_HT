// Alertas do "chamar atenção" no navegador: bip, tremor da tela do HUB, título piscando e notificação do Windows.
// (O tremor da janela por cima de outros programas depende da versão instalada do HUB — etapa futura.)

let audio: AudioContext | null = null;

function contexto() {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audio) audio = new Ctor();
  return audio;
}

// O navegador só libera som depois de uma interação; destrava no primeiro clique/tecla.
if (typeof window !== "undefined") {
  const destravar = () => {
    const ctx = contexto();
    if (ctx && ctx.state === "suspended") void ctx.resume();
    window.removeEventListener("pointerdown", destravar);
    window.removeEventListener("keydown", destravar);
  };
  window.addEventListener("pointerdown", destravar);
  window.addEventListener("keydown", destravar);
}

export function alertaSonoro() {
  const ctx = contexto();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const inicio = ctx.currentTime + 0.02;
  // "bip bip" (duas vezes, repetido)
  [0, 0.22, 0.7, 0.92].forEach((atraso) => {
    const osc = ctx.createOscillator();
    const ganho = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 1046;
    ganho.gain.setValueAtTime(0.0001, inicio + atraso);
    ganho.gain.exponentialRampToValueAtTime(0.18, inicio + atraso + 0.01);
    ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + atraso + 0.16);
    osc.connect(ganho).connect(ctx.destination);
    osc.start(inicio + atraso);
    osc.stop(inicio + atraso + 0.18);
  });
}

export function tremerTela() {
  const alvo = document.querySelector(".app-shell") || document.body;
  alvo.classList.remove("hub-tremer");
  void (alvo as HTMLElement).offsetWidth;
  alvo.classList.add("hub-tremer");
  window.setTimeout(() => alvo.classList.remove("hub-tremer"), 900);
  if ("vibrate" in navigator) {
    try {
      navigator.vibrate([200, 100, 200]);
    } catch {
      // ignorado
    }
  }
}

let piscando: number | null = null;
export function piscarTitulo(texto: string) {
  if (piscando !== null) window.clearInterval(piscando);
  const original = document.title;
  let alterna = false;
  const parar = () => {
    if (piscando !== null) window.clearInterval(piscando);
    piscando = null;
    document.title = original;
    window.removeEventListener("focus", parar);
  };
  piscando = window.setInterval(() => {
    alterna = !alterna;
    document.title = alterna ? `🔔 ${texto}` : original;
  }, 900);
  window.addEventListener("focus", parar);
  if (document.hasFocus()) window.setTimeout(parar, 6000);
}

export function mostrarNotificacao(titulo: string, corpo: string, insistente: boolean) {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification(titulo, { body: corpo, requireInteraction: insistente, tag: insistente ? "hub-chat-atencao" : "hub-chat", icon: "/hub-icon.svg" });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // alguns navegadores só permitem notificações pelo service worker
  }
}
