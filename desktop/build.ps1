# Gera o instalador do HUB Tributário para Windows (public\desktop\HUB-Tributario-Instalador.exe).
# Uso, na raiz do repositório:  powershell -ExecutionPolicy Bypass -File desktop\build.ps1
# Requer só o que já vem no Windows 10/11 (.NET Framework 4.8 e PowerShell) e internet na primeira vez
# (baixa o pacote oficial do WebView2 da Microsoft no nuget.org e guarda em desktop\.cache).
$ErrorActionPreference = 'Stop'
$raiz   = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo   = Split-Path -Parent $raiz
$cache  = Join-Path $raiz '.cache'
$saida  = Join-Path $raiz 'dist'
$public = Join-Path $repo 'public\desktop'
New-Item -ItemType Directory -Force $cache, $saida, $public | Out-Null

# 1) Pacote do WebView2 (SDK) — versão estável mais recente.
$versaoSdk = $env:WEBVIEW2_SDK
if (-not $versaoSdk) {
  $idx = Invoke-RestMethod 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/index.json'
  $versaoSdk = ($idx.versions | Where-Object { $_ -notmatch '-' } | Select-Object -Last 1)
}
$pasta = Join-Path $cache "webview2.$versaoSdk"
if (-not (Test-Path (Join-Path $pasta 'lib\net462\Microsoft.Web.WebView2.Core.dll'))) {
  $zip = Join-Path $cache "webview2.$versaoSdk.zip"
  Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$versaoSdk/microsoft.web.webview2.$versaoSdk.nupkg" -OutFile $zip
  Expand-Archive -Force $zip -DestinationPath $pasta
}
$core   = Join-Path $pasta 'lib\net462\Microsoft.Web.WebView2.Core.dll'
$wf     = Join-Path $pasta 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'
$loader = Join-Path $pasta 'runtimes\win-x64\native\WebView2Loader.dll'

# 2) Versão do aplicativo (lida do código-fonte).
$fonte  = Join-Path $raiz 'HUBTributario.cs'
$versao = ([regex]::Match((Get-Content -Raw -Encoding UTF8 $fonte), 'Versao = "([0-9.]+)"')).Groups[1].Value

# 3) Compilação (csc do .NET Framework 4.8, já presente no Windows).
$fw  = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$csc = Join-Path $fw 'csc.exe'
$exe = Join-Path $saida 'HUB Tributario.exe'
& $csc /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 `
  "/out:$exe" "/win32icon:$(Join-Path $raiz 'hub.ico')" `
  "/r:$core" "/r:$wf" "/r:$(Join-Path $fw 'System.Web.Extensions.dll')" /r:System.Windows.Forms.dll /r:System.Drawing.dll `
  "/resource:$core,Microsoft.Web.WebView2.Core.dll" "/resource:$wf,Microsoft.Web.WebView2.WinForms.dll" "/resource:$loader,WebView2Loader.dll" `
  $fonte
if ($LASTEXITCODE -ne 0) { throw "Falha na compilação." }

# 4) Publicação no site do HUB (o próprio .exe é o instalador e o atualizador).
Copy-Item -Force $exe (Join-Path $public 'HUB-Tributario-Instalador.exe')
$tam = (Get-Item $exe).Length
$json = '{"versao":"' + $versao + '","url":"/desktop/HUB-Tributario-Instalador.exe","tamanho":' + $tam + ',"sdkWebView2":"' + $versaoSdk + '"}'
[IO.File]::WriteAllText((Join-Path $public 'versao.json'), $json, (New-Object Text.UTF8Encoding($false)))
"HUB Tributario $versao gerado ($([math]::Round($tam/1KB)) KB) com WebView2 SDK $versaoSdk"
