// Ponte com o HUB instalado no Windows (pasta desktop/). No navegador, tudo aqui é ignorado.
export interface HubDesktop {
  desktop: true;
  versao: string;
  chamarAtencao(titulo: string, texto: string): void;
  naoLidas(total: number): void;
  notificar(titulo: string, texto: string): void;
}

export const INSTALADOR_DESKTOP_URL = "/desktop/HUB-Tributario-Instalador.exe";

export function hubDesktop(): HubDesktop | null {
  if (typeof window === "undefined") return null;
  const ponte = (window as unknown as { hubDesktop?: HubDesktop }).hubDesktop;
  return ponte && ponte.desktop ? ponte : null;
}

export function ehDesktop() {
  return hubDesktop() !== null;
}
