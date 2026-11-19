import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Endereço e chave pública do Supabase para os apps abertos fora do HUB (ex.: app Carteira de Clientes em
// /apps/carteira/). A chave anônima é pública por natureza (já vai no código do HUB); o acesso depende do login
// e das regras do banco.
function hubPublicConfig(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const source = () => JSON.stringify({ url: (env.VITE_SUPABASE_URL || "").trim(), anonKey: (env.VITE_SUPABASE_ANON_KEY || "").trim() });
  return {
    name: "hub-public-config",
    configureServer(server) {
      server.middlewares.use("/apps/hub-config.json", (_req, res) => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(source());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "apps/hub-config.json", source: source() });
    }
  };
}

export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react(), hubPublicConfig(mode)],
  build: {
    rollupOptions: {
      output: {
        // Bibliotecas estáveis em arquivos próprios: continuam no cache do navegador após cada publicação.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "vendor-react";
          if (/node_modules[\\/]@supabase[\\/]/.test(id)) return "vendor-supabase";
          if (/node_modules[\\/]lucide-react[\\/]/.test(id)) return "vendor-icones";
          return undefined;
        }
      }
    }
  },
  server: {
    port: 5173,
    strictPort: false
  }
}));
