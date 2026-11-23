// HUB Tributário para Windows — janela própria do HUB (WebView2, motor do Edge que já vem no Windows),
// com ícone na bandeja, segundo plano, início com o Windows, "chamar atenção" por cima dos outros
// programas e atualização automática. O conteúdo é sempre o site publicado do HUB.
//
// Compilado com o csc do .NET Framework 4.8 (C# 5): sem interpolação de texto, sem "?.", sem "=>" em membros.
// Para compilar: desktop\build.ps1 (gera public\desktop\HUB-Tributario-Instalador.exe).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("HUB Tributário")]
[assembly: AssemblyProduct("HUB Tributário")]
[assembly: AssemblyCompany("H. Teixeira Contabilidade")]
[assembly: AssemblyVersion(HubTributario.Constantes.Versao)]
[assembly: AssemblyFileVersion(HubTributario.Constantes.Versao)]

namespace HubTributario
{
    public static class Constantes
    {
        public const string Versao = "1.0.0";
        public const string Nome = "HUB Tributário";
        public const string Origem = "https://hub-depto-tributario-ht.netlify.app";
        public const string UrlVersao = Origem + "/desktop/versao.json";
        public const string NomeExe = "HUB Tributario.exe";
        public const string ChaveRun = @"Software\Microsoft\Windows\CurrentVersion\Run";
        public const string ChaveDesinstalar = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\HUBTributario";
        public const string ValorRun = "HUB Tributario";
        public const string Mutex = "HUBTributario.Instancia";
        public const string EventoMostrar = "HUBTributario.Mostrar";
        public const string EventoSair = "HUBTributario.Sair";

        public static string PastaInstalacao
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "HUB Tributario"); }
        }
        public static string PastaDados
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "HUB Tributario"); }
        }
        public static string ExeInstalado
        {
            get { return Path.Combine(PastaInstalacao, NomeExe); }
        }
    }

    // ---------------------------------------------------------------- Configuração (arquivo simples chave=valor)
    public static class Config
    {
        static string Arquivo { get { return Path.Combine(Constantes.PastaDados, "config.ini"); } }

        public static string Ler(string chave, string padrao)
        {
            try
            {
                if (!File.Exists(Arquivo)) return padrao;
                foreach (string linha in File.ReadAllLines(Arquivo))
                {
                    int i = linha.IndexOf('=');
                    if (i > 0 && linha.Substring(0, i).Trim() == chave) return linha.Substring(i + 1).Trim();
                }
            }
            catch { }
            return padrao;
        }

        public static void Gravar(string chave, string valor)
        {
            try
            {
                Directory.CreateDirectory(Constantes.PastaDados);
                List<string> linhas = new List<string>();
                bool achou = false;
                if (File.Exists(Arquivo))
                {
                    foreach (string linha in File.ReadAllLines(Arquivo))
                    {
                        int i = linha.IndexOf('=');
                        if (i > 0 && linha.Substring(0, i).Trim() == chave) { linhas.Add(chave + "=" + valor); achou = true; }
                        else linhas.Add(linha);
                    }
                }
                if (!achou) linhas.Add(chave + "=" + valor);
                File.WriteAllLines(Arquivo, linhas.ToArray());
            }
            catch { }
        }
    }

    // ---------------------------------------------------------------- Início, instalação, atualização e remoção
    public static class Programa
    {
        [STAThread]
        public static int Main(string[] args)
        {
            AppDomain.CurrentDomain.AssemblyResolve += ResolverEmbutido;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            List<string> a = new List<string>(args);
            try
            {
                if (a.Contains("--desinstalar")) { Instalador.Desinstalar(a.Contains("--silencioso")); return 0; }

                string atual = Path.GetFullPath(Assembly.GetExecutingAssembly().Location);
                bool instalado = string.Equals(atual, Path.GetFullPath(Constantes.ExeInstalado), StringComparison.OrdinalIgnoreCase);
                if (!instalado)
                {
                    int esperar = 0;
                    int idx = a.IndexOf("--esperar");
                    if (idx >= 0 && idx + 1 < a.Count) int.TryParse(a[idx + 1], out esperar);
                    Instalador.Instalar(atual, esperar, a.Contains("--atualizacao"), a.Contains("--bandeja"));
                    return 0;
                }

                bool novo;
                using (Mutex m = new Mutex(true, Constantes.Mutex, out novo))
                {
                    if (!novo)
                    {
                        // Já está aberto: só traz a janela para a frente.
                        try { EventWaitHandle.OpenExisting(Constantes.EventoMostrar).Set(); } catch { }
                        return 0;
                    }
                    Rodar(a.Contains("--bandeja"));
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Não foi possível abrir o " + Constantes.Nome + ".\n\n" + ex.Message, Constantes.Nome, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            return 0;
        }

        // Separado do Main: os tipos do WebView2 só são carregados quando a janela é criada.
        [MethodImpl(MethodImplOptions.NoInlining)]
        static void Rodar(bool naBandeja)
        {
            Application.Run(new JanelaPrincipal(naBandeja));
        }

        static Assembly ResolverEmbutido(object sender, ResolveEventArgs e)
        {
            string nome = new AssemblyName(e.Name).Name + ".dll";
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(nome))
            {
                if (s == null) return null;
                byte[] b = new byte[s.Length];
                s.Read(b, 0, b.Length);
                return Assembly.Load(b);
            }
        }

        public static Icon Icone()
        {
            try { return Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); }
            catch { return SystemIcons.Application; }
        }
    }

    public static class Instalador
    {
        static readonly string[] Recursos = { "Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll" };

        public static void Instalar(string origem, int esperarPid, bool atualizacao, bool bandeja)
        {
            if (esperarPid > 0)
            {
                try { Process p = Process.GetProcessById(esperarPid); p.WaitForExit(15000); } catch { }
            }
            else
            {
                // Reinstalação manual com o HUB aberto: pede para a cópia aberta sair.
                try { EventWaitHandle.OpenExisting(Constantes.EventoSair).Set(); Thread.Sleep(1500); } catch { }
            }

            string pasta = Constantes.PastaInstalacao;
            Directory.CreateDirectory(pasta);
            CopiarComTentativas(origem, Constantes.ExeInstalado);
            foreach (string r in Recursos) ExtrairRecurso(r, Path.Combine(pasta, r));

            string exe = Constantes.ExeInstalado;
            Atalho(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Constantes.Nome + ".lnk"), exe, "");
            Atalho(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Constantes.Nome + ".lnk"), exe, "");

            // Início com o Windows: ligado por padrão na primeira instalação; depois vale a escolha do usuário.
            if (Config.Ler("iniciar_com_windows", "sim") == "sim") InicioComWindows(true);

            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(Constantes.ChaveDesinstalar))
            {
                k.SetValue("DisplayName", Constantes.Nome);
                k.SetValue("DisplayVersion", Constantes.Versao);
                k.SetValue("Publisher", "H. Teixeira Contabilidade");
                k.SetValue("DisplayIcon", exe);
                k.SetValue("InstallLocation", pasta);
                k.SetValue("UninstallString", "\"" + exe + "\" --desinstalar");
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }

            Process.Start(new ProcessStartInfo(exe, bandeja ? "--bandeja" : "") { UseShellExecute = true });
        }

        public static void Desinstalar(bool silencioso)
        {
            if (!silencioso && MessageBox.Show("Remover o " + Constantes.Nome + " deste computador?\n\nO HUB continua disponível pelo navegador.", Constantes.Nome, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            try { EventWaitHandle.OpenExisting(Constantes.EventoSair).Set(); Thread.Sleep(1500); } catch { }
            InicioComWindows(false);
            try { File.Delete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Constantes.Nome + ".lnk")); } catch { }
            try { File.Delete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Constantes.Nome + ".lnk")); } catch { }
            try { Registry.CurrentUser.DeleteSubKeyTree(Constantes.ChaveDesinstalar, false); } catch { }
            // Apaga as pastas depois que este processo terminar.
            string cmd = "/c timeout /t 2 /nobreak >nul & rmdir /s /q \"" + Constantes.PastaInstalacao + "\" & rmdir /s /q \"" + Constantes.PastaDados + "\"";
            Process.Start(new ProcessStartInfo("cmd.exe", cmd) { CreateNoWindow = true, UseShellExecute = false });
            if (!silencioso) MessageBox.Show(Constantes.Nome + " removido.", Constantes.Nome, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        public static bool InicioComWindowsLigado()
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(Constantes.ChaveRun, false))
            {
                return k != null && k.GetValue(Constantes.ValorRun) != null;
            }
        }

        public static void InicioComWindows(bool ligar)
        {
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(Constantes.ChaveRun))
            {
                if (ligar) k.SetValue(Constantes.ValorRun, "\"" + Constantes.ExeInstalado + "\" --bandeja");
                else if (k.GetValue(Constantes.ValorRun) != null) k.DeleteValue(Constantes.ValorRun, false);
            }
            Config.Gravar("iniciar_com_windows", ligar ? "sim" : "nao");
        }

        static void CopiarComTentativas(string de, string para)
        {
            if (string.Equals(Path.GetFullPath(de), Path.GetFullPath(para), StringComparison.OrdinalIgnoreCase)) return;
            for (int i = 0; ; i++)
            {
                try { File.Copy(de, para, true); return; }
                catch (IOException) { if (i >= 20) throw; Thread.Sleep(500); }
            }
        }

        static void ExtrairRecurso(string nome, string destino)
        {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(nome))
            {
                if (s == null) throw new InvalidOperationException("Instalador incompleto: falta " + nome);
                for (int i = 0; ; i++)
                {
                    try
                    {
                        using (FileStream f = File.Create(destino)) { s.Position = 0; s.CopyTo(f); }
                        return;
                    }
                    catch (IOException) { if (i >= 20) throw; Thread.Sleep(500); }
                }
            }
        }

        static void Atalho(string caminho, string alvo, string argumentos)
        {
            try
            {
                Type t = Type.GetTypeFromProgID("WScript.Shell");
                object shell = Activator.CreateInstance(t);
                object lnk = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { caminho });
                Type tl = lnk.GetType();
                tl.InvokeMember("TargetPath", BindingFlags.SetProperty, null, lnk, new object[] { alvo });
                tl.InvokeMember("Arguments", BindingFlags.SetProperty, null, lnk, new object[] { argumentos });
                tl.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, lnk, new object[] { Path.GetDirectoryName(alvo) });
                tl.InvokeMember("IconLocation", BindingFlags.SetProperty, null, lnk, new object[] { alvo + ",0" });
                tl.InvokeMember("Description", BindingFlags.SetProperty, null, lnk, new object[] { Constantes.Nome });
                tl.InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
                Marshal.FinalReleaseComObject(lnk);
                Marshal.FinalReleaseComObject(shell);
            }
            catch { }
        }
    }

    // ---------------------------------------------------------------- Janela principal
    public class JanelaPrincipal : Form
    {
        [DllImport("user32.dll")] static extern bool FlashWindowEx(ref FLASHWINFO pwfi);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
        [StructLayout(LayoutKind.Sequential)]
        struct FLASHWINFO { public uint cbSize; public IntPtr hwnd; public uint dwFlags; public uint uCount; public uint dwTimeout; }

        readonly WebView2 web = new WebView2();
        readonly NotifyIcon bandeja = new NotifyIcon();
        readonly Icon iconeBase;
        readonly bool iniciarNaBandeja;
        bool saindo;
        int naoLidas;
        DateTime ultimaAtencao = DateTime.MinValue;
        CoreWebView2Environment ambiente;
        EventWaitHandle eventoMostrar, eventoSair;
        ToolStripMenuItem itemIniciar, itemPerguntar, itemSegundoPlano, itemFecharDeVez;
        System.Windows.Forms.Timer timerAtualizacao;

        public JanelaPrincipal(bool naBandeja)
        {
            iniciarNaBandeja = naBandeja;
            iconeBase = Programa.Icone();
            Text = Constantes.Nome;
            Icon = iconeBase;
            StartPosition = FormStartPosition.Manual;
            MinimumSize = new Size(900, 600);
            RestaurarPosicao();
            BackColor = Color.FromArgb(243, 246, 249);

            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = Color.FromArgb(243, 246, 249);
            Controls.Add(web);

            MontarBandeja();
            OuvirOutrasInstancias();

            permitirMostrar = !iniciarNaBandeja;
            Load += delegate { IniciarWebUmaVez(); };
            FormClosing += AoFechar;

            timerAtualizacao = new System.Windows.Forms.Timer();
            timerAtualizacao.Interval = 6 * 60 * 60 * 1000; // a cada 6 horas
            timerAtualizacao.Tick += delegate { VerificarAtualizacao(false); };
            timerAtualizacao.Start();
            Task.Delay(60000).ContinueWith(delegate { BeginInvoke((Action)delegate { VerificarAtualizacao(false); }); });
        }

        bool permitirMostrar, webIniciada;

        // Início pela bandeja (com o Windows): a janela existe, mas só aparece quando o usuário abrir.
        protected override void SetVisibleCore(bool value)
        {
            if (!permitirMostrar)
            {
                value = false;
                if (!IsHandleCreated) { CreateHandle(); IniciarWebUmaVez(); }
            }
            base.SetVisibleCore(value);
        }

        async void IniciarWebUmaVez()
        {
            if (webIniciada) return;
            webIniciada = true;
            await IniciarWeb();
        }

        async Task IniciarWeb()
        {
            try
            {
                CoreWebView2EnvironmentOptions op = new CoreWebView2EnvironmentOptions();
                // Mantém chat e avisos chegando com a janela escondida na bandeja.
                op.AdditionalBrowserArguments = "--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows";
                ambiente = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Constantes.PastaDados, "WebView2"), op);
                await web.EnsureCoreWebView2Async(ambiente);
                ConfigurarWeb(web.CoreWebView2);
                web.CoreWebView2.Navigate(Constantes.Origem + "/");
            }
            catch (WebView2RuntimeNotFoundException)
            {
                MessageBox.Show("Este computador não tem o componente WebView2 do Microsoft Edge.\nInstale pelo site da Microsoft (\"WebView2 Runtime\") e abra o HUB de novo.", Constantes.Nome, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                Sair();
            }
        }

        public void ConfigurarWeb(CoreWebView2 core)
        {
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.UserAgent = core.Settings.UserAgent + " HUBTributarioDesktop/" + Constantes.Versao;
            core.AddScriptToExecuteOnDocumentCreatedAsync(ScriptPonte());
            core.WebMessageReceived += AoReceberMensagem;
            core.NewWindowRequested += AoPedirNovaJanela;
            core.NavigationStarting += AoNavegar;
            core.PermissionRequested += delegate (object s, CoreWebView2PermissionRequestedEventArgs e)
            {
                if (e.PermissionKind == CoreWebView2PermissionKind.Notifications && EhDoHub(e.Uri)) e.State = CoreWebView2PermissionState.Allow;
            };
            core.DocumentTitleChanged += delegate { AtualizarTitulo(); };
        }

        static string ScriptPonte()
        {
            return "(function(){if(location.origin!=='" + Constantes.Origem + "'||window.hubDesktop)return;" +
                "var p=function(o){try{window.chrome.webview.postMessage(JSON.stringify(o));}catch(e){}};" +
                "window.hubDesktop={desktop:true,versao:'" + Constantes.Versao + "'," +
                "chamarAtencao:function(t,x){p({tipo:'atencao',titulo:String(t||''),texto:String(x||'')});}," +
                "naoLidas:function(n){p({tipo:'naoLidas',n:Number(n)||0});}," +
                "notificar:function(t,x){p({tipo:'notificar',titulo:String(t||''),texto:String(x||'')});}};})();";
        }

        static bool EhDoHub(string url)
        {
            return url != null && (url == Constantes.Origem || url.StartsWith(Constantes.Origem + "/", StringComparison.OrdinalIgnoreCase));
        }

        void AoNavegar(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            // Fora do HUB (gov.br, Receita etc.): abre no navegador do computador.
            if (!EhDoHub(e.Uri) && !e.Uri.StartsWith("about:") && !e.Uri.StartsWith("data:") && !e.Uri.StartsWith("blob:"))
            {
                e.Cancel = true;
                AbrirNoNavegador(e.Uri);
            }
        }

        void AoPedirNovaJanela(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            if (EhDoHub(e.Uri))
            {
                // Chat em janela separada e outras janelas do próprio HUB: janela do aplicativo.
                e.Handled = true;
                JanelaSecundaria j = new JanelaSecundaria(this, ambiente, e.Uri);
                j.Show();
            }
            else if (!e.Uri.StartsWith("blob:") && !e.Uri.StartsWith("data:"))
            {
                e.Handled = true;
                AbrirNoNavegador(e.Uri);
            }
        }

        static void AbrirNoNavegador(string url)
        {
            if (!(url.StartsWith("https://") || url.StartsWith("http://") || url.StartsWith("mailto:"))) return;
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
        }

        public void AoReceberMensagem(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            if (!EhDoHub(e.Source)) return;
            Dictionary<string, object> m;
            try { m = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(e.TryGetWebMessageAsString()); }
            catch { return; }
            if (m == null || !m.ContainsKey("tipo")) return;
            string tipo = Convert.ToString(m["tipo"]);
            string titulo = m.ContainsKey("titulo") ? Convert.ToString(m["titulo"]) : "";
            string texto = m.ContainsKey("texto") ? Convert.ToString(m["texto"]) : "";
            if (tipo == "atencao") ChamarAtencao(titulo, texto);
            else if (tipo == "notificar") Notificar(titulo, texto);
            else if (tipo == "naoLidas")
            {
                int n = 0;
                try { n = Convert.ToInt32(m["n"]); } catch { }
                DefinirNaoLidas(n);
            }
        }

        // ------------------------------------------------ Chamar atenção: por cima de tudo, chacoalha e pisca
        void ChamarAtencao(string titulo, string texto)
        {
            if ((DateTime.Now - ultimaAtencao).TotalSeconds < 2) return; // a mesma chamada pode chegar por duas janelas
            ultimaAtencao = DateTime.Now;
            MostrarJanela();
            TopMost = true;
            Activate();
            SetForegroundWindow(Handle);
            Piscar();
            Chacoalhar();
            if (titulo.Length > 0) bandeja.ShowBalloonTip(8000, titulo, texto.Length > 0 ? texto : " ", ToolTipIcon.Warning);
            System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
            t.Interval = 4000;
            t.Tick += delegate { t.Stop(); t.Dispose(); TopMost = false; };
            t.Start();
        }

        void Chacoalhar()
        {
            if (WindowState == FormWindowState.Maximized) return; // janela maximizada não se move
            Point origem = Location;
            int passo = 0;
            int[] dx = { 14, -14, 12, -12, 9, -9, 6, -6, 3, -3, 0 };
            System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
            t.Interval = 35;
            t.Tick += delegate
            {
                if (passo >= dx.Length) { t.Stop(); t.Dispose(); Location = origem; return; }
                Location = new Point(origem.X + dx[passo], origem.Y + (passo % 2 == 0 ? 4 : -4));
                passo++;
            };
            t.Start();
        }

        void Piscar()
        {
            FLASHWINFO f = new FLASHWINFO();
            f.cbSize = (uint)Marshal.SizeOf(typeof(FLASHWINFO));
            f.hwnd = Handle;
            f.dwFlags = 3 | 12; // FLASHW_ALL | FLASHW_TIMERNOFG: pisca até a janela receber foco
            f.uCount = 0;
            f.dwTimeout = 0;
            FlashWindowEx(ref f);
        }

        void Notificar(string titulo, string texto)
        {
            if (ContainsFocus && Visible && WindowState != FormWindowState.Minimized) return;
            bandeja.ShowBalloonTip(6000, titulo.Length > 0 ? titulo : Constantes.Nome, texto.Length > 0 ? texto : " ", ToolTipIcon.Info);
        }

        void DefinirNaoLidas(int n)
        {
            if (n == naoLidas) return;
            naoLidas = n;
            AtualizarTitulo();
            Icon novo = n > 0 ? IconeComMarca(iconeBase) : iconeBase;
            bandeja.Icon = novo;
            Icon = novo;
            bandeja.Text = n > 0 ? (Constantes.Nome + " — " + n + (n == 1 ? " mensagem nova" : " mensagens novas")) : Constantes.Nome;
        }

        void AtualizarTitulo()
        {
            string t = Constantes.Nome;
            Text = naoLidas > 0 ? "(" + naoLidas + ") " + t : t;
        }

        static Icon IconeComMarca(Icon baseIcon)
        {
            using (Bitmap b = new Bitmap(32, 32))
            {
                using (Graphics g = Graphics.FromImage(b))
                {
                    g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                    g.DrawIcon(new Icon(baseIcon, 32, 32), new Rectangle(0, 0, 32, 32));
                    g.FillEllipse(Brushes.White, 17, 0, 15, 15);
                    using (SolidBrush vermelho = new SolidBrush(Color.FromArgb(214, 48, 49))) g.FillEllipse(vermelho, 18, 1, 13, 13);
                }
                return Icon.FromHandle(b.GetHicon());
            }
        }

        // ------------------------------------------------ Bandeja (ícone perto do relógio)
        void MontarBandeja()
        {
            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("Abrir o HUB", null, delegate { MostrarJanela(); });
            menu.Items.Add(new ToolStripSeparator());
            itemIniciar = new ToolStripMenuItem("Iniciar com o Windows");
            itemIniciar.Click += delegate { Instalador.InicioComWindows(!Instalador.InicioComWindowsLigado()); itemIniciar.Checked = Instalador.InicioComWindowsLigado(); };
            menu.Items.Add(itemIniciar);
            ToolStripMenuItem aoFechar = new ToolStripMenuItem("Ao clicar no X");
            itemPerguntar = new ToolStripMenuItem("Perguntar", null, delegate { Config.Gravar("ao_fechar", "perguntar"); MarcarAoFechar(); });
            itemSegundoPlano = new ToolStripMenuItem("Manter em segundo plano", null, delegate { Config.Gravar("ao_fechar", "segundo_plano"); MarcarAoFechar(); });
            itemFecharDeVez = new ToolStripMenuItem("Fechar o aplicativo", null, delegate { Config.Gravar("ao_fechar", "fechar"); MarcarAoFechar(); });
            aoFechar.DropDownItems.Add(itemPerguntar);
            aoFechar.DropDownItems.Add(itemSegundoPlano);
            aoFechar.DropDownItems.Add(itemFecharDeVez);
            menu.Items.Add(aoFechar);
            menu.Items.Add("Procurar atualização", null, delegate { VerificarAtualizacao(true); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Sair", null, delegate { Sair(); });
            menu.Opening += delegate { itemIniciar.Checked = Instalador.InicioComWindowsLigado(); MarcarAoFechar(); };

            bandeja.Icon = iconeBase;
            bandeja.Text = Constantes.Nome;
            bandeja.ContextMenuStrip = menu;
            bandeja.Visible = true;
            bandeja.MouseClick += delegate (object s, MouseEventArgs e) { if (e.Button == MouseButtons.Left) MostrarJanela(); };
            bandeja.BalloonTipClicked += delegate { MostrarJanela(); };
        }

        void MarcarAoFechar()
        {
            string v = Config.Ler("ao_fechar", "perguntar");
            itemPerguntar.Checked = v == "perguntar";
            itemSegundoPlano.Checked = v == "segundo_plano";
            itemFecharDeVez.Checked = v == "fechar";
        }

        public void MostrarJanela()
        {
            permitirMostrar = true;
            if (!Visible) Show();
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Activate();
            SetForegroundWindow(Handle);
        }

        void AoFechar(object sender, FormClosingEventArgs e)
        {
            if (saindo || e.CloseReason != CloseReason.UserClosing) { GuardarPosicao(); return; }
            string escolha = Config.Ler("ao_fechar", "perguntar");
            if (escolha == "perguntar")
            {
                bool lembrar;
                escolha = DialogoFechar.Perguntar(this, out lembrar);
                if (escolha == null) { e.Cancel = true; return; }
                if (lembrar) Config.Gravar("ao_fechar", escolha);
            }
            if (escolha == "segundo_plano")
            {
                e.Cancel = true;
                GuardarPosicao();
                Hide();
                if (Config.Ler("aviso_bandeja", "") != "visto")
                {
                    bandeja.ShowBalloonTip(5000, Constantes.Nome, "O HUB continua aberto aqui, perto do relógio. Clique no ícone para voltar.", ToolTipIcon.Info);
                    Config.Gravar("aviso_bandeja", "visto");
                }
                return;
            }
            saindo = true;
            GuardarPosicao();
            bandeja.Visible = false;
        }

        public void Sair()
        {
            saindo = true;
            bandeja.Visible = false;
            GuardarPosicao();
            Application.Exit();
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            bandeja.Visible = false;
            bandeja.Dispose();
            base.OnFormClosed(e);
            Application.Exit();
        }

        void GuardarPosicao()
        {
            if (WindowState == FormWindowState.Normal && Visible)
                Config.Gravar("janela", Left + "," + Top + "," + Width + "," + Height);
            Config.Gravar("maximizada", WindowState == FormWindowState.Maximized ? "sim" : "nao");
        }

        void RestaurarPosicao()
        {
            Rectangle area = Screen.PrimaryScreen.WorkingArea;
            Rectangle r = new Rectangle(area.Left + 40, area.Top + 30, Math.Min(1440, area.Width - 80), Math.Min(920, area.Height - 60));
            string[] p = Config.Ler("janela", "").Split(',');
            if (p.Length == 4)
            {
                int x, y, w, h;
                if (int.TryParse(p[0], out x) && int.TryParse(p[1], out y) && int.TryParse(p[2], out w) && int.TryParse(p[3], out h))
                {
                    Rectangle salvo = new Rectangle(x, y, w, h);
                    foreach (Screen s in Screen.AllScreens) if (s.WorkingArea.IntersectsWith(salvo)) { r = salvo; break; }
                }
            }
            Bounds = r;
            if (Config.Ler("maximizada", "sim") == "sim" && !iniciarNaBandeja) WindowState = FormWindowState.Maximized;
        }

        // ------------------------------------------------ Outra cópia aberta: mostrar ou sair
        void OuvirOutrasInstancias()
        {
            eventoMostrar = new EventWaitHandle(false, EventResetMode.AutoReset, Constantes.EventoMostrar);
            eventoSair = new EventWaitHandle(false, EventResetMode.AutoReset, Constantes.EventoSair);
            Thread t = new Thread(delegate ()
            {
                WaitHandle[] h = { eventoMostrar, eventoSair };
                while (true)
                {
                    int i = WaitHandle.WaitAny(h);
                    try
                    {
                        if (i == 0) BeginInvoke((Action)MostrarJanela);
                        else { BeginInvoke((Action)Sair); return; }
                    }
                    catch { return; }
                }
            });
            t.IsBackground = true;
            t.Start();
        }

        // ------------------------------------------------ Atualização automática do aplicativo
        void VerificarAtualizacao(bool avisarSemNovidade)
        {
            Task.Run(delegate
            {
                try
                {
                    ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
                    string json;
                    using (WebClient c = new WebClient())
                    {
                        c.Encoding = System.Text.Encoding.UTF8;
                        json = c.DownloadString(Constantes.UrlVersao + "?t=" + DateTime.Now.Ticks);
                    }
                    Dictionary<string, object> v = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
                    Version remota = new Version(Convert.ToString(v["versao"]));
                    if (remota <= new Version(Constantes.Versao))
                    {
                        if (avisarSemNovidade) BeginInvoke((Action)delegate { MessageBox.Show(this, "O " + Constantes.Nome + " já está na versão mais recente (" + Constantes.Versao + ").", Constantes.Nome); });
                        return;
                    }
                    string url = Convert.ToString(v["url"]);
                    if (!url.StartsWith("http")) url = Constantes.Origem + url;
                    if (!EhDoHub(url)) return;
                    string tmp = Path.Combine(Path.GetTempPath(), "HUB-Tributario-" + remota + ".exe");
                    using (WebClient c = new WebClient()) c.DownloadFile(url, tmp);
                    BeginInvoke((Action)delegate
                    {
                        bandeja.ShowBalloonTip(5000, Constantes.Nome, "Atualizando para a versão " + remota + "…", ToolTipIcon.Info);
                        string extra = Visible ? "" : " --bandeja";
                        Process.Start(new ProcessStartInfo(tmp, "--atualizacao --esperar " + Process.GetCurrentProcess().Id + extra) { UseShellExecute = true });
                        Sair();
                    });
                }
                catch (Exception ex)
                {
                    if (avisarSemNovidade) BeginInvoke((Action)delegate { MessageBox.Show(this, "Não foi possível procurar atualização agora.\n\n" + ex.Message, Constantes.Nome); });
                }
            });
        }
    }

    // ---------------------------------------------------------------- Janelas do próprio HUB (ex.: chat separado)
    public class JanelaSecundaria : Form
    {
        readonly WebView2 web = new WebView2();

        public JanelaSecundaria(JanelaPrincipal principal, CoreWebView2Environment ambiente, string url)
        {
            Text = Constantes.Nome;
            Icon = principal.Icon;
            Size = new Size(460, 700);
            StartPosition = FormStartPosition.CenterScreen;
            web.Dock = DockStyle.Fill;
            Controls.Add(web);
            Load += async delegate
            {
                await web.EnsureCoreWebView2Async(ambiente);
                principal.ConfigurarWeb(web.CoreWebView2);
                web.CoreWebView2.DocumentTitleChanged += delegate { Text = web.CoreWebView2.DocumentTitle; };
                web.CoreWebView2.Navigate(url);
            };
        }
    }

    // ---------------------------------------------------------------- Pergunta ao clicar no X
    public static class DialogoFechar
    {
        public static string Perguntar(IWin32Window dono, out bool lembrar)
        {
            Form f = new Form();
            f.Text = Constantes.Nome;
            f.FormBorderStyle = FormBorderStyle.FixedDialog;
            f.MaximizeBox = false;
            f.MinimizeBox = false;
            f.StartPosition = FormStartPosition.CenterParent;
            f.ClientSize = new Size(460, 178);
            f.Font = new Font("Segoe UI", 9.5f);
            f.BackColor = Color.White;
            f.ShowInTaskbar = false;

            Label l = new Label();
            l.Text = "Fechar o HUB ou deixá-lo aberto em segundo plano?\nEm segundo plano, o chat e os avisos continuam chegando.";
            l.Location = new Point(20, 18);
            l.Size = new Size(420, 44);
            l.ForeColor = Color.FromArgb(20, 36, 58);
            f.Controls.Add(l);

            CheckBox c = new CheckBox();
            c.Text = "Lembrar minha escolha (dá para mudar no ícone perto do relógio)";
            c.Location = new Point(20, 72);
            c.Size = new Size(420, 24);
            c.ForeColor = Color.FromArgb(95, 111, 130);
            f.Controls.Add(c);

            string resposta = null;
            Button segundo = new Button();
            segundo.Text = "Fechar, mas manter em segundo plano";
            segundo.Location = new Point(20, 118);
            segundo.Size = new Size(250, 36);
            segundo.FlatStyle = FlatStyle.Flat;
            segundo.BackColor = Color.FromArgb(18, 58, 99);
            segundo.ForeColor = Color.White;
            segundo.Click += delegate { resposta = "segundo_plano"; f.Close(); };
            f.Controls.Add(segundo);

            Button fechar = new Button();
            fechar.Text = "Fechar";
            fechar.Location = new Point(282, 118);
            fechar.Size = new Size(158, 36);
            fechar.FlatStyle = FlatStyle.Flat;
            fechar.ForeColor = Color.FromArgb(18, 58, 99);
            fechar.Click += delegate { resposta = "fechar"; f.Close(); };
            f.Controls.Add(fechar);

            f.AcceptButton = segundo;
            f.ShowDialog(dono);
            lembrar = c.Checked;
            return resposta;
        }
    }
}
