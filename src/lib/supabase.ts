import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const configuredSupabaseUrl = supabaseUrl || "";
export const configuredSupabaseHost = (() => {
  if (!supabaseUrl) return "Não configurado";
  try {
    return new URL(supabaseUrl).host;
  } catch {
    return supabaseUrl;
  }
})();

// Endereço e chave pública do Supabase para os apps em public/apps (ex.: Controle de Apuração).
// A chave anônima é pública por natureza; o acesso aos dados depende do login e das regras do banco.
export const supabasePublicConfig = { url: supabaseUrl || "", anonKey: supabaseAnonKey || "" };
if (isSupabaseConfigured && typeof window !== "undefined") {
  try {
    window.localStorage.setItem("hub_supabase_public", JSON.stringify(supabasePublicConfig));
  } catch {
    // Navegador sem armazenamento local: os apps recebem a configuração pela moldura do HUB.
  }
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;
